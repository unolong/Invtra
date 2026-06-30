import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Audio } from 'expo-av';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  LayoutAnimation,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { SafeAreaView } from 'react-native-safe-area-context';

import ItemDetailSheet from '@/components/ui/ItemDetailSheet';
import {
  daysUntil,
  type InventoryItem,
  type InventoryLocation,
  useInventory,
} from '@/context/inventory-context';
import { lookupShelfLife } from '@/constants/shelfLife';
import { calcInventoryMatch, matchBadgeColor } from '@/lib/recipe-match';
import { analyzeVoiceInventory, estimateShelfLife, getRecipeSuggestions, type RecipeSuggestion, type VoiceInventoryItem } from '@/services/anthropic';
import { searchBls, type BlsItem } from '@/services/bls-search';

// Runtime category cache — survives re-renders, resets on app restart
const runtimeCategoryCache = new Map<string, { category: string; idealStorage: string }>();

// Enable LayoutAnimation on Android
if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

const ACCENT = '#c8ff00';
const GREEN  = '#26de81';
const ORANGE = '#ff7a4d';

const CAT_COLOR: Record<string, string> = {
  protein:   '#4f8bff',
  carbs:     '#ffb547',
  gemüse:    '#26de81',
  obst:      '#ff7a4d',
  fett:      '#F74F4F',
  milch:     '#a78bff',
  sonstiges: 'rgba(255,255,255,0.45)',
};

// Used only for header row expiry preview while AI estimate loads
const AI_EXPIRY_FALLBACK: Record<string, number> = {
  protein:   4,
  milch:     10,
  gemüse:    6,
  obst:      7,
  carbs:     14,
  fett:      30,
  sonstiges: 7,
};

const EXPIRY_CHIPS = [
  { label: '1T',  days: 1  },
  { label: '3T',  days: 3  },
  { label: '7T',  days: 7  },
  { label: '14T', days: 14 },
  { label: '1M',  days: 30 },
] as const;

const LOCATIONS: InventoryLocation[] = ['Kühlschrank', 'Vorrat', 'Tiefkühler'];

// ─── Helpers ──────────────────────────────────────────────────

function expColor(days: number): string {
  if (days <= 1)  return '#ff5e5e';
  if (days <= 3)  return ORANGE;
  if (days <= 7)  return '#ffb547';
  if (days <= 14) return GREEN;
  return 'rgba(255,255,255,0.35)';
}

function expLabel(days: number): string {
  if (days >= 9999) return '';
  if (days < 0)  return 'abgelaufen';
  if (days <= 1) return '~morgen';
  if (days < 14) return `~${days} Tage`;
  if (days < 60) return `~${Math.round(days / 7)} Wochen`;
  return `~${Math.round(days / 30)} Monate`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return [
    String(d.getDate()).padStart(2, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    d.getFullYear(),
  ].join('.');
}

function makeExpiresAt(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function daysFromToday(iso: string | null): number | null {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function shelfCacheKey(name: string, location: InventoryLocation, opened: boolean | null): string {
  return `shelf_life_cache_${name}_${location}_${opened === true ? 'o' : 'c'}`;
}

// ─── Main Screen ──────────────────────────────────────────────

export default function InventarScreen() {
  const { items, removeItem, updateItem, addItems } = useInventory();
  const [activeTab, setActiveTab]     = useState<InventoryLocation>('Kühlschrank');
  const [viewMode, setViewMode]       = useState<'list' | 'grid'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const highlightTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [invRecipes, setInvRecipes]   = useState<RecipeSuggestion[]>([]);
  const [invLoading, setInvLoading]   = useState(false);
  const invLoadingRef = useRef(false);
  const invInitRef    = useRef(false);

  // Voice state
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'processing'>('idle');
  const voiceRecordingRef = useRef<Audio.Recording | null>(null);
  const voicePulseAnim = useRef(new Animated.Value(1)).current;
  const [voiceItems, setVoiceItems] = useState<VoiceInventoryItem[]>([]);
  const [voiceSelected, setVoiceSelected] = useState<Set<number>>(new Set());
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [voiceEmpty, setVoiceEmpty] = useState(false);
  const voiceStartTimeRef = useRef<number>(0);

  // Search modal state
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [blsQuery, setBlsQuery]               = useState('');
  const [blsResults, setBlsResults]           = useState<BlsItem[]>([]);
  const [blsSearching, setBlsSearching]       = useState(false);
  const [selectedBlsItem, setSelectedBlsItem] = useState<BlsItem | null>(null);

  const counts = useMemo(() => {
    const map: Record<InventoryLocation, number> = { Kühlschrank: 0, Vorrat: 0, Tiefkühler: 0 };
    for (const item of items) map[item.location]++;
    return map;
  }, [items]);

  const tabItems = useMemo(() => {
    const base = items.filter(i => i.location === activeTab);
    if (!searchQuery.trim()) return base;
    const q = searchQuery.trim().toLowerCase();
    return base.filter(i => i.name.toLowerCase().includes(q));
  }, [items, activeTab, searchQuery]);

  const expiring = useMemo(
    () => items.filter(i => daysUntil(i.expiresAt) <= 3),
    [items],
  );

  const toggleExpanded = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId(curr => curr === id ? null : id);
  };

  // Location change: update item, switch tab, highlight; pre-fetch new location shelf life
  const handleLocationChange = useCallback(async (id: string, newLoc: InventoryLocation, opened: boolean | null) => {
    const item = items.find(i => i.id === id);
    if (!item || item.location === newLoc) return;

    await updateItem(id, { location: newLoc });

    // Pre-fetch shelf life for new location in background
    const catData = runtimeCategoryCache.get(item.name);
    if (catData) {
      const { days, unsuitable } = lookupShelfLife(catData.category, newLoc, opened);
      const warning = unsuitable ? `Nicht zur Lagerung im ${newLoc} geeignet.` : null;
      AsyncStorage.setItem(shelfCacheKey(item.name, newLoc, opened), JSON.stringify({
        estimatedDays: days,
        estimatedDate: formatDate(makeExpiresAt(days > 0 ? days : 1)),
        storageLocation: newLoc,
        warning,
        idealStorage: catData.idealStorage,
        category: catData.category,
        opened,
        cachedAt: new Date().toISOString(),
      })).catch(() => {});
    } else {
      estimateShelfLife(item.name, newLoc, opened)
        .then(async result => {
          if (result.category && result.idealStorage) {
            runtimeCategoryCache.set(item.name, { category: result.category, idealStorage: result.idealStorage });
          }
          await AsyncStorage.setItem(shelfCacheKey(item.name, newLoc, opened), JSON.stringify({
            estimatedDays: result.days,
            estimatedDate: formatDate(makeExpiresAt(result.days > 0 ? result.days : 1)),
            storageLocation: newLoc,
            warning: result.warning ?? null,
            idealStorage: result.idealStorage ?? null,
            category: result.category ?? null,
            opened,
            cachedAt: new Date().toISOString(),
          }));
        })
        .catch(() => {});
    }

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId(null);
    setActiveTab(newLoc);
    setHighlightedId(id);
    if (highlightTimeout.current) clearTimeout(highlightTimeout.current);
    highlightTimeout.current = setTimeout(() => setHighlightedId(null), 1500);
  }, [items, updateItem]);

  const loadInvRecipes = useCallback(async (expiringItems: InventoryItem[], force = false) => {
    if (invLoadingRef.current) return;
    if (!force) {
      const [cachedRaw, loadedAtRaw, lastChangedRaw] = await Promise.all([
        AsyncStorage.getItem('cached_inventory_recipes'),
        AsyncStorage.getItem('inventory_recipes_loaded_at'),
        AsyncStorage.getItem('inventory_last_changed'),
      ]);
      if (cachedRaw) {
        setInvRecipes(JSON.parse(cachedRaw));
        const loadedAt = loadedAtRaw ? parseInt(loadedAtRaw, 10) : 0;
        const lastChanged = lastChangedRaw ? parseInt(lastChangedRaw, 10) : 0;
        if (lastChanged <= loadedAt) return;
      }
    }
    if (expiringItems.length === 0) return;
    invLoadingRef.current = true;
    setInvLoading(true);
    try {
      const result = await getRecipeSuggestions(
        expiringItems.map(i => ({ name: i.name, qty: i.qty })),
        { calories: 500, protein: 25, carbs: 50, fat: 15 },
      );
      setInvRecipes(result);
      await Promise.all([
        AsyncStorage.setItem('cached_inventory_recipes', JSON.stringify(result)),
        AsyncStorage.setItem('inventory_recipes_loaded_at', Date.now().toString()),
      ]);
    } catch {
      // keep cached data on error
    } finally {
      setInvLoading(false);
      invLoadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (expiring.length > 0 && !invInitRef.current) {
      invInitRef.current = true;
      loadInvRecipes(expiring);
    }
  }, [expiring, loadInvRecipes]);

  useEffect(() => {
    if (voiceState === 'recording') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(voicePulseAnim, { toValue: 1.5, duration: 500, useNativeDriver: true }),
          Animated.timing(voicePulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    } else {
      voicePulseAnim.setValue(1);
    }
  }, [voiceState, voicePulseAnim]);

  const handleVoiceInventoryPress = useCallback(async () => {
    if (voiceState === 'recording') {
      const rec = voiceRecordingRef.current;
      if (!rec) return;

      // Measure A: min 2 seconds
      if (Date.now() - voiceStartTimeRef.current < 2000) {
        await rec.stopAndUnloadAsync().catch(() => {});
        voiceRecordingRef.current = null;
        setVoiceState('idle');
        Alert.alert('Zu kurze Aufnahme', 'Halte den Button gedrückt und sprich deutlich.');
        return;
      }

      setVoiceState('processing');
      try {
        await rec.stopAndUnloadAsync();
        const uri = rec.getURI();
        voiceRecordingRef.current = null;
        if (!uri) { setVoiceState('idle'); return; }

        const result = await analyzeVoiceInventory(uri);
        setVoiceItems(result);
        setVoiceEmpty(result.length === 0);
        setVoiceSelected(new Set(result.map((_, i) => i)));
        setVoiceModalOpen(true);
      } catch {
        setVoiceItems([]);
        setVoiceEmpty(true);
        setVoiceModalOpen(true);
      } finally {
        setVoiceState('idle');
      }
    } else if (voiceState === 'idle') {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Mikrofon-Zugriff', 'Bitte Mikrofon-Zugriff in den Einstellungen erlauben.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      voiceRecordingRef.current = recording;
      voiceStartTimeRef.current = Date.now();
      setVoiceState('recording');
    }
  }, [voiceState]);

  const closeVoiceModal = useCallback(() => {
    setVoiceModalOpen(false);
    setVoiceItems([]);
    setVoiceSelected(new Set());
    setVoiceEmpty(false);
  }, []);

  const confirmVoiceItems = useCallback(async () => {
    const selected = voiceItems.filter((_, i) => voiceSelected.has(i));
    if (selected.length === 0) { closeVoiceModal(); return; }
    await addItems(selected.map(item => ({
      name: item.name,
      qty: `${item.amount}${item.unit}`,
      cat: 'sonstiges',
      location: item.idealStorage,
      expiresAt: null,
    })));
    closeVoiceModal();
  }, [voiceItems, voiceSelected, addItems, closeVoiceModal]);

  const handleBlsSearch = (q: string) => {
    setBlsQuery(q);
    if (!q.trim()) { setBlsResults([]); return; }
    setBlsSearching(true);
    setBlsResults(searchBls(q, { limit: 25 }));
    setBlsSearching(false);
  };

  const closeSearchModal = () => {
    setSearchModalOpen(false);
    setBlsQuery('');
    setBlsResults([]);
    setSelectedBlsItem(null);
  };

  // Collapse when switching tabs
  const prevTab = useRef(activeTab);
  useEffect(() => {
    if (prevTab.current !== activeTab) {
      prevTab.current = activeTab;
      setExpandedId(null);
    }
  }, [activeTab]);

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={s.headerRow}>
          <View>
            <Text style={s.countLabel}>{items.length} ARTIKEL</Text>
            <Text style={s.headline}>Inventar</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              style={s.toggleBtn}
              onPress={() => loadInvRecipes(expiring, true)}
              disabled={invLoading}
              hitSlop={8}
            >
              <Text style={[s.toggleIcon, invLoading && { opacity: 0.35 }]}>↻</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.toggleBtn}
              onPress={() => { setViewMode(v => v === 'list' ? 'grid' : 'list'); setExpandedId(null); }}
              hitSlop={8}
            >
              <Text style={s.toggleIcon}>{viewMode === 'list' ? '⊞' : '☰'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Ablauf-Warnkarte ── */}
        {expiring.length > 0 && (
          <View style={s.warnCard}>
            <View style={s.warnIconWrap}>
              <Text style={{ fontSize: 20 }}>⏱</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.warnTitle}>
                {expiring.length === 1 ? '1 Artikel läuft' : `${expiring.length} Artikel laufen`} bald ab
              </Text>
              <Text style={s.warnSub} numberOfLines={2}>
                {expiring.map(e => e.name).join(', ')}
              </Text>
            </View>
          </View>
        )}

        {/* ── Jetzt aufbrauchen ── */}
        {expiring.length > 0 && (
          <View>
            <View style={s.sectionHeaderRow}>
              <Text style={s.sectionLabel}>JETZT AUFBRAUCHEN {expiring.length}</Text>
              <TouchableOpacity
                hitSlop={8}
                onPress={() => loadInvRecipes(expiring, true)}
                disabled={invLoading}
              >
                <Text style={[s.sectionAllLink, invLoading && { opacity: 0.35 }]}>↻</Text>
              </TouchableOpacity>
            </View>

            {invLoading && invRecipes.length === 0 ? (
              <View style={s.invLoadingCard}>
                <ActivityIndicator color={ACCENT} size="small" />
                <Text style={s.invLoadingText}>KI erstellt Rezepte aus ablaufenden Zutaten…</Text>
              </View>
            ) : invRecipes.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.recipeRow}
              >
                {invRecipes.map((recipe, i) => {
                  const { matchPct, missing } = calcInventoryMatch(recipe.ingredients, items);
                  const matchC = matchBadgeColor(matchPct);
                  return (
                    <TouchableOpacity
                      key={recipe.name}
                      style={s.recipeCard}
                      activeOpacity={0.85}
                      onPress={() => router.push({
                        pathname: '/recipe-detail',
                        params: { data: JSON.stringify(recipe), colorIndex: String(i % 5) },
                      })}
                    >
                      <View style={[StyleSheet.absoluteFill, s.recipeOverlay]} />
                      <View style={s.recipeCardContent}>
                        <View style={s.recipeTimeBadge}>
                          <Text style={s.recipeTimeText}>⏱ {recipe.prepTime} Min.</Text>
                        </View>
                        <View style={[s.recipeMatchBadge, { backgroundColor: `${matchC}20`, borderColor: `${matchC}40` }]}>
                          <Text style={[s.recipeMatchText, { color: matchC }]}>
                            {matchPct >= 100 ? '✓ Alles da' : `⚠ ${missing} fehlen`}
                          </Text>
                        </View>
                        <View style={s.recipeTags}>
                          {recipe.usedInventoryItems.slice(0, 2).map(item => (
                            <View key={item} style={s.recipeTag}>
                              <Text style={s.recipeTagText} numberOfLines={1}>{item}</Text>
                            </View>
                          ))}
                        </View>
                        <Text style={s.recipeName} numberOfLines={2}>{recipe.name}</Text>
                        <Text style={s.recipeMacros}>{recipe.calories} kcal · {recipe.protein}g P</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : null}
          </View>
        )}

        {/* ── Scan Buttons ── */}
        <View style={s.scanRow}>
          <TouchableOpacity
            style={s.scanPrimary}
            onPress={() => router.push({ pathname: '/camera', params: { mode: 'inventory' } })}
            activeOpacity={0.8}
          >
            <Text style={{ fontSize: 16 }}>📸</Text>
            <Text style={s.scanPrimaryText} numberOfLines={1}>Kühlschrank scannen</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.scanSecondary}
            onPress={() => router.push('/inventory-barcode' as any)}
            activeOpacity={0.8}
          >
            <Text style={{ fontSize: 14 }}>▣</Text>
            <Text style={s.scanSecondaryText}>Barcode</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.scanSecondary, voiceState === 'recording' && s.scanSecondaryRecording]}
            onPress={handleVoiceInventoryPress}
            activeOpacity={0.8}
            disabled={voiceState === 'processing'}
          >
            {voiceState === 'processing' ? (
              <ActivityIndicator size="small" color={ACCENT} />
            ) : voiceState === 'recording' ? (
              <Animated.View style={[s.voiceInvDot, { transform: [{ scale: voicePulseAnim }] }]} />
            ) : (
              <Text style={{ fontSize: 14 }}>🎙</Text>
            )}
            <Text style={[s.scanSecondaryText, voiceState === 'recording' && { color: '#F74F4F' }]}>
              {voiceState === 'recording' ? 'Stopp' : voiceState === 'processing' ? '…' : 'Sprache'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.scanSecondary, s.scanAddBtn]}
            onPress={() => setSearchModalOpen(true)}
            activeOpacity={0.8}
          >
            <Text style={s.scanAddText}>🔍</Text>
          </TouchableOpacity>
        </View>

        {/* ── Voice Inventory Confirmation Modal ── */}
        <Modal
          visible={voiceModalOpen}
          animationType="slide"
          onRequestClose={closeVoiceModal}
          statusBarTranslucent
        >
          <SafeAreaView style={s.modalSafe} edges={['top', 'bottom']}>
            <View style={s.modalHeader}>
              <TouchableOpacity onPress={closeVoiceModal} hitSlop={12}>
                <Text style={s.modalClose}>✕</Text>
              </TouchableOpacity>
              <Text style={s.modalTitle}>Erkannte Artikel</Text>
              <View style={{ width: 32 }} />
            </View>

            {voiceEmpty ? (
              /* ── Leer-State ── */
              <View style={s.voiceEmptyState}>
                <Text style={s.voiceEmptyIcon}>🎙</Text>
                <Text style={s.voiceEmptyTitle}>Nichts erkannt</Text>
                <Text style={s.voiceEmptyHint}>
                  Sprich deutlich und nenne Produkt und Menge,{'\n'}z.B. „500g Reis" oder „1 Liter Milch"
                </Text>
                <TouchableOpacity style={s.voiceRetryBtn} onPress={closeVoiceModal} activeOpacity={0.85}>
                  <Text style={s.voiceRetryBtnText}>Erneut versuchen</Text>
                </TouchableOpacity>
              </View>
            ) : (
              /* ── Ergebnis-Liste ── */
              <ScrollView
                contentContainerStyle={s.voiceScrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {voiceItems.map((item, i) => {
                  const selected = voiceSelected.has(i);
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[s.voiceItemRow, selected && s.voiceItemRowSelected]}
                      onPress={() => {
                        setVoiceSelected(prev => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i); else next.add(i);
                          return next;
                        });
                      }}
                      activeOpacity={0.75}
                    >
                      <View style={[s.voiceCheckbox, selected && s.voiceCheckboxOn]}>
                        {selected && <Text style={s.voiceCheckmark}>✓</Text>}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.voiceItemName}>{item.name}</Text>
                        <Text style={s.voiceItemMeta}>{item.amount}{item.unit} · {item.idealStorage}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}

                <Text style={s.voiceHintText}>Tippe auf einen Artikel um ihn abzuwählen</Text>

                <TouchableOpacity style={s.voiceAddLink} onPress={closeVoiceModal} activeOpacity={0.7}>
                  <Text style={s.voiceAddLinkText}>+ Artikel manuell hinzufügen</Text>
                </TouchableOpacity>

                <View style={{ flex: 1, minHeight: 32 }} />

                <TouchableOpacity style={s.voiceConfirmBtn} onPress={confirmVoiceItems} activeOpacity={0.85}>
                  <Text style={s.voiceConfirmBtnText}>
                    {voiceSelected.size} Artikel ins Inventar
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </SafeAreaView>
        </Modal>

        {/* ── BLS Search Modal ── */}
        <Modal
          visible={searchModalOpen}
          animationType="slide"
          onRequestClose={closeSearchModal}
          statusBarTranslucent
        >
          <SafeAreaView style={s.modalSafe} edges={['top', 'bottom']}>
            <View style={s.modalHeader}>
              <TouchableOpacity onPress={closeSearchModal} hitSlop={12}>
                <Text style={s.modalClose}>✕</Text>
              </TouchableOpacity>
              <Text style={s.modalTitle}>Lebensmittel suchen</Text>
              <View style={{ width: 32 }} />
            </View>

            <View style={s.modalSearchRow}>
              <Text style={{ fontSize: 16 }}>🔍</Text>
              <TextInput
                style={s.modalSearchInput}
                placeholder="z.B. Hähnchenbrust, Joghurt…"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={blsQuery}
                onChangeText={handleBlsSearch}
                returnKeyType="search"
                autoFocus
                autoCorrect={false}
              />
              {blsQuery.length > 0 && (
                <TouchableOpacity onPress={() => handleBlsSearch('')} hitSlop={8}>
                  <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {blsSearching ? (
              <ActivityIndicator color={ACCENT} style={{ marginTop: 32 }} />
            ) : blsResults.length > 0 ? (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={s.modalResultsList}
                showsVerticalScrollIndicator={false}
              >
                <Text style={s.modalResultsCount}>{blsResults.length} Ergebnisse</Text>
                <View style={s.modalResultsCard}>
                  {blsResults.map((item, i) => (
                    <TouchableOpacity
                      key={item.id}
                      style={[s.modalResultRow, i < blsResults.length - 1 && s.modalResultBorder]}
                      onPress={() => { Keyboard.dismiss(); setSelectedBlsItem(item); }}
                      activeOpacity={0.7}
                    >
                      <View style={s.modalResultGlyph}>
                        <Text style={s.modalResultGlyphText}>{item.name[0].toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.modalResultName} numberOfLines={1}>{item.name}</Text>
                        <Text style={s.modalResultSub} numberOfLines={1}>
                          {Math.round(item.pro100g.kalorien)} kcal · {item.pro100g.protein.toFixed(1)}g P · {item.kategorie}
                        </Text>
                      </View>
                      <Text style={s.modalResultChevron}>›</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            ) : blsQuery.length > 0 ? (
              <View style={s.modalEmptyState}>
                <Text style={s.modalEmptyText}>Keine Ergebnisse für „{blsQuery}"</Text>
              </View>
            ) : (
              <View style={s.modalEmptyState}>
                <Text style={s.modalEmptyText}>Tippe einen Lebensmittelnamen ein</Text>
              </View>
            )}
          </SafeAreaView>
        </Modal>

        {/* ── Detail Sheet (BLS item selected) ── */}
        <ItemDetailSheet
          visible={selectedBlsItem !== null}
          productName={selectedBlsItem?.name ?? ''}
          onClose={() => setSelectedBlsItem(null)}
          onAdd={async ({ qty, location, expiresAt }) => {
            if (!selectedBlsItem) return;
            await addItems([{
              name: selectedBlsItem.name,
              qty,
              cat: selectedBlsItem.kategorie ?? 'sonstiges',
              location,
              expiresAt,
            }]);
            closeSearchModal();
          }}
        />

        {/* ── Search ── */}
        <View style={s.searchRow}>
          <Text style={{ fontSize: 16 }}>🔍</Text>
          <TextInput
            style={s.searchInput}
            placeholder="In Kühlschrank suchen..."
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={searchQuery}
            onChangeText={t => { setSearchQuery(t); setExpandedId(null); }}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
              <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Tab Filter ── */}
        <View style={s.tabRow}>
          {LOCATIONS.map(loc => (
            <TouchableOpacity
              key={loc}
              style={[s.tab, activeTab === loc && s.tabActive]}
              onPress={() => setActiveTab(loc)}
            >
              <Text style={[s.tabLabel, activeTab === loc && s.tabLabelActive]}>{loc}</Text>
              <View style={[s.tabBadge, activeTab === loc && s.tabBadgeActive]}>
                <Text style={[s.tabBadgeText, activeTab === loc && s.tabBadgeTextActive]}>
                  {counts[loc]}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Item List / Grid / Empty ── */}
        {tabItems.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyEmoji}>🫙</Text>
            <Text style={s.emptyTitle}>{searchQuery ? 'Keine Treffer' : 'Noch nichts hier'}</Text>
            <Text style={s.emptySub}>
              {searchQuery
                ? `Kein Artikel mit „${searchQuery}" gefunden.`
                : 'Scanne deinen Kühlschrank oder füge Artikel manuell hinzu.'}
            </Text>
            {!searchQuery && (
              <TouchableOpacity
                style={s.emptyBtn}
                onPress={() => router.push({ pathname: '/camera', params: { mode: 'inventory' } })}
                activeOpacity={0.85}
              >
                <Text style={s.emptyBtnText}>Kühlschrank scannen</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : viewMode === 'list' ? (
          <View style={s.listCard}>
            {tabItems.map((item, i) => (
              <ExpandableItemRow
                key={item.id}
                item={item}
                isExpanded={expandedId === item.id}
                isLast={i === tabItems.length - 1}
                highlighted={highlightedId === item.id}
                onToggle={toggleExpanded}
                onSave={async (id, changes) => { await updateItem(id, changes); }}
                onDelete={(id) => { removeItem(id); setExpandedId(null); }}
                onLocationChange={handleLocationChange}
              />
            ))}
          </View>
        ) : (
          <View style={s.gridWrap}>
            {tabItems.map(item => (
              <GridItem key={item.id} item={item} />
            ))}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── ExpandableItemRow ────────────────────────────────────────

function ExpandableItemRow({
  item, isExpanded, isLast, highlighted, onToggle, onSave, onDelete, onLocationChange,
}: {
  item: InventoryItem;
  isExpanded: boolean;
  isLast: boolean;
  highlighted: boolean;
  onToggle: (id: string) => void;
  onSave: (id: string, changes: Partial<Omit<InventoryItem, 'id'>>) => void;
  onDelete: (id: string) => void;
  onLocationChange: (id: string, newLoc: InventoryLocation, opened: boolean | null) => void;
}) {
  const color   = CAT_COLOR[item.cat] || ACCENT;
  const fallbackDays = AI_EXPIRY_FALLBACK[item.cat] ?? 7;
  const displayExpiry = item.expiresAt ?? makeExpiresAt(fallbackDays);
  const days    = daysUntil(displayExpiry);
  const label   = expLabel(days);
  const ec      = expColor(days);

  const [mode, setMode]           = useState<'ai' | 'manual'>('ai');
  const [draftExpiry, setDraft]   = useState<string | null>(item.expiresAt);
  const [showPicker, setShowPick] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [editOpened, setEditOpened]     = useState<boolean | null>(false);
  const [aiDays, setAiDays]             = useState<number | null>(null);
  const [aiWarning, setAiWarning]       = useState<string | null>(null);
  const [aiIdealStorage, setAiIdealStorage] = useState<string | null>(null);
  const [aiLoading, setAiLoading]       = useState(false);

  const swipeableRef = useRef<any>(null);
  const fadeAnim     = useRef(new Animated.Value(1)).current;
  const deletingRef  = useRef(false);

  const highlightAnim = useRef(new Animated.Value(0)).current;

  // Green highlight animation when item moves to a new tab
  useEffect(() => {
    if (!highlighted) return;
    highlightAnim.setValue(0);
    Animated.sequence([
      Animated.timing(highlightAnim, { toValue: 0.28, duration: 200, useNativeDriver: true }),
      Animated.delay(700),
      Animated.timing(highlightAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, [highlighted]);

  // Load AI shelf life estimate — runtime category cache → AsyncStorage → API
  useEffect(() => {
    if (!isExpanded || mode !== 'ai') return;
    let cancelled = false;

    (async () => {
      // Fast path: category already known locally
      const catData = runtimeCategoryCache.get(item.name);
      if (catData && !cancelled) {
        const { days, unsuitable } = lookupShelfLife(catData.category, item.location, editOpened);
        setAiDays(days);
        setAiWarning(unsuitable ? `Nicht zur Lagerung im ${item.location} geeignet.` : null);
        setAiIdealStorage(catData.idealStorage);
        return;
      }

      // AsyncStorage cache check
      const key = shelfCacheKey(item.name, item.location, editOpened);
      try {
        const cachedStr = await AsyncStorage.getItem(key);
        if (cachedStr && !cancelled) {
          const parsed = JSON.parse(cachedStr);
          setAiDays(parsed.estimatedDays);
          setAiWarning(parsed.warning ?? null);
          setAiIdealStorage(parsed.idealStorage ?? null);
          if (parsed.category && parsed.idealStorage) {
            runtimeCategoryCache.set(item.name, { category: parsed.category, idealStorage: parsed.idealStorage });
          }
          return;
        }
      } catch {}

      if (cancelled) return;
      setAiLoading(true);
      try {
        const result = await estimateShelfLife(item.name, item.location, editOpened);
        if (cancelled) return;
        setAiDays(result.days);
        setAiWarning(result.warning ?? null);
        setAiIdealStorage(result.idealStorage ?? null);
        if (result.category && result.idealStorage) {
          runtimeCategoryCache.set(item.name, { category: result.category, idealStorage: result.idealStorage });
        }
        await AsyncStorage.setItem(key, JSON.stringify({
          estimatedDays: result.days,
          estimatedDate: formatDate(makeExpiresAt(result.days > 0 ? result.days : 1)),
          storageLocation: item.location,
          warning: result.warning ?? null,
          idealStorage: result.idealStorage ?? null,
          category: result.category ?? null,
          opened: editOpened,
          cachedAt: new Date().toISOString(),
        }));
      } catch {
        if (!cancelled) setAiDays(fallbackDays);
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isExpanded, mode, item.name, item.location, editOpened]);

  // Reset state when accordion closes
  useEffect(() => {
    if (!isExpanded) {
      setMode('ai');
      setDraft(item.expiresAt);
      setShowPick(false);
      setSaving(false);
      setEditOpened(false);
      setAiDays(null);
      setAiWarning(null);
      setAiIdealStorage(null);
      setAiLoading(false);
    }
  }, [isExpanded, item.expiresAt]);

  const activeChip = daysFromToday(draftExpiry);
  const aiDate     = (aiDays != null && aiDays > 0) ? makeExpiresAt(aiDays) : null;
  const saveBusy   = saving || (mode === 'ai' && aiLoading);

  const handleSave = async () => {
    if (saveBusy) return;
    setSaving(true);
    const exp = mode === 'ai' ? aiDate : draftExpiry;
    await onSave(item.id, { expiresAt: exp });
    setSaving(false);
  };

  const handleDelete = () => {
    Alert.alert(item.name, 'Aus dem Inventar entfernen?', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Entfernen', style: 'destructive', onPress: () => onDelete(item.id) },
    ]);
  };

  const doSwipeDelete = useCallback(() => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true })
      .start(() => onDelete(item.id));
  }, [fadeAnim, item.id, onDelete]);

  const renderDeleteAction = useCallback(() => (
    <TouchableOpacity style={s.swipeDeleteAction} onPress={doSwipeDelete} activeOpacity={0.85}>
      <Text style={s.swipeDeleteIcon}>🗑</Text>
      <Text style={s.swipeDeleteText}>Löschen</Text>
    </TouchableOpacity>
  ), [doSwipeDelete]);

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderDeleteAction}
      onSwipeableRightOpen={doSwipeDelete}
      rightThreshold={80}
      overshootRight={false}
      friction={2}
    >
    <Animated.View style={{ opacity: fadeAnim }}>
      {/* Green highlight overlay for location change */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: GREEN, opacity: highlightAnim }]}
        pointerEvents="none"
      />

      {/* ── Row header ── */}
      <TouchableOpacity
        style={[s.itemRow, isExpanded && s.itemRowActive]}
        onPress={() => onToggle(item.id)}
        activeOpacity={0.7}
      >
        <FoodGlyph name={item.name} color={color} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.itemName} numberOfLines={1}>{item.name}</Text>
          <Text style={s.itemQty} numberOfLines={1}>{item.qty}</Text>
        </View>
        {label ? <Text style={[s.expiryLabel, { color: ec }]}>{label}</Text> : null}
        <Text style={[s.chevron, isExpanded && s.chevronOpen]}>›</Text>
      </TouchableOpacity>

      {/* ── Expanded detail ── */}
      {isExpanded && (
        <View style={s.detailPanel}>

          {/* ── Location switcher ── */}
          <View style={s.locationSection}>
            <Text style={s.locationSectionLabel}>LAGERORT</Text>
            <View style={s.locationBtnRow}>
              {LOCATIONS.map(loc => (
                <TouchableOpacity
                  key={loc}
                  style={[s.locationBtn, item.location === loc && s.locationBtnActive]}
                  onPress={() => { if (loc !== item.location) onLocationChange(item.id, loc, editOpened); }}
                  activeOpacity={0.75}
                >
                  <Text style={[s.locationBtnText, item.location === loc && s.locationBtnTextActive]}>
                    {loc}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ── Zustand ── */}
          <View style={s.locationSection}>
            <Text style={s.locationSectionLabel}>ZUSTAND</Text>
            <View style={s.locationBtnRow}>
              {([false, true] as const).map(o => {
                const isActive = o ? editOpened === true : editOpened !== true;
                return (
                  <TouchableOpacity
                    key={String(o)}
                    style={[s.locationBtn, isActive && s.locationBtnActive]}
                    onPress={() => {
                      setEditOpened(o);
                      setAiDays(null);
                    }}
                    activeOpacity={0.75}
                  >
                    <Text style={[s.locationBtnText, isActive && s.locationBtnTextActive]}>
                      {o ? 'Geöffnet' : 'Ungeöffnet'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ── AI / Manual toggle ── */}
          <View style={s.segControl}>
            {(['ai', 'manual'] as const).map(m => (
              <TouchableOpacity
                key={m}
                style={[s.segOpt, mode === m && s.segOptActive]}
                onPress={() => setMode(m)}
                activeOpacity={0.8}
              >
                <Text style={[s.segOptText, mode === m && s.segOptTextActive]}>
                  {m === 'ai' ? 'AI-Schätzung' : 'Manuell'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── AI mode ── */}
          {mode === 'ai' && (
            <View style={[s.aiCard, aiWarning != null && s.aiCardWarn]}>
              {aiLoading ? (
                <View style={s.aiLoadRow}>
                  <ActivityIndicator size="small" color={ACCENT} />
                  <Text style={s.aiLoadText}>Richtwert wird ermittelt…</Text>
                </View>
              ) : aiWarning ? (
                <>
                  <Text style={s.aiLabelWarn}>⚠ Ungeeigneter Lagerort</Text>
                  <Text style={s.aiWarningText}>Nicht zur Lagerung hier geeignet.</Text>
                  {aiIdealStorage && (
                    <Text style={s.aiIdealStorageText}>Empfehlung: {aiIdealStorage}</Text>
                  )}
                </>
              ) : (
                <>
                  <View style={s.aiTopRow}>
                    <Text style={s.aiLabel}>✦ Richtwert</Text>
                    {aiDate && <Text style={s.aiUntil}>bis {formatDate(aiDate)}</Text>}
                  </View>
                  {aiDays != null && aiDays > 0 && <Text style={s.aiDays}>~{aiDays} Tage</Text>}
                </>
              )}
            </View>
          )}

          {/* ── Manual mode ── */}
          {mode === 'manual' && (
            <View style={s.manualSection}>
              <TouchableOpacity
                style={s.dateField}
                onPress={() => {
                  if (Platform.OS === 'android') {
                    DateTimePickerAndroid.open({
                      value: draftExpiry ? new Date(draftExpiry) : new Date(),
                      mode: 'date',
                      onChange: (event, date) => {
                        if (event.type === 'set' && date) {
                          const d = new Date(date);
                          d.setHours(0, 0, 0, 0);
                          setDraft(d.toISOString());
                        }
                      },
                    });
                  } else {
                    setShowPick(v => !v);
                  }
                }}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 18 }}>📅</Text>
                <Text style={s.dateText}>{formatDate(draftExpiry)}</Text>
                <View style={{ flex: 1 }} />
                <Text style={s.dateChevron}>
                  {Platform.OS === 'android' ? '›' : showPicker ? '▲' : '▼'}
                </Text>
              </TouchableOpacity>

              {showPicker && Platform.OS === 'ios' && (
                <View style={s.iosPickerWrap}>
                  <DateTimePicker
                    value={draftExpiry ? new Date(draftExpiry) : new Date()}
                    mode="date"
                    display="inline"
                    themeVariant="dark"
                    onChange={(_, date) => {
                      if (date) {
                        const d = new Date(date);
                        d.setHours(0, 0, 0, 0);
                        setDraft(d.toISOString());
                      }
                    }}
                    style={s.iosPicker}
                  />
                </View>
              )}

              <View style={s.chipRow}>
                {EXPIRY_CHIPS.map(c => (
                  <TouchableOpacity
                    key={c.label}
                    style={[s.expiryChip, activeChip === c.days && s.expiryChipActive]}
                    onPress={() => setDraft(makeExpiresAt(c.days))}
                    activeOpacity={0.75}
                  >
                    <Text style={[s.expiryChipText, activeChip === c.days && s.expiryChipTextActive]}>
                      {c.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* ── Action buttons ── */}
          <View style={s.detailBtnRow}>
            <TouchableOpacity style={s.detailDelBtn} onPress={handleDelete} activeOpacity={0.8}>
              <Text style={s.detailDelBtnText}>Löschen</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.detailSaveBtn, saveBusy && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saveBusy}
              activeOpacity={0.85}
            >
              <Text style={s.detailSaveBtnText}>{saving ? 'Speichert…' : 'Speichern'}</Text>
            </TouchableOpacity>
          </View>

        </View>
      )}

      {!isLast && <View style={s.rowDivider} />}
    </Animated.View>
    </Swipeable>
  );
}

// ─── GridItem ────────────────────────────────────────────────

function GridItem({ item }: { item: InventoryItem }) {
  const color    = CAT_COLOR[item.cat] || ACCENT;
  const fallback = AI_EXPIRY_FALLBACK[item.cat] ?? 7;
  const displayExpiry = item.expiresAt ?? makeExpiresAt(fallback);
  const days     = daysUntil(displayExpiry);
  const label    = expLabel(days);
  const ec       = expColor(days);

  return (
    <View style={s.gridItem}>
      <FoodGlyph name={item.name} color={color} size={42} />
      <Text style={s.gridItemName} numberOfLines={2}>{item.name}</Text>
      <Text style={s.gridItemQty} numberOfLines={1}>{item.qty}</Text>
      {label ? <Text style={[s.gridExpiry, { color: ec }]}>{label}</Text> : null}
    </View>
  );
}

// ─── FoodGlyph ───────────────────────────────────────────────

function FoodGlyph({ name, color, size = 36 }: { name: string; color: string; size?: number }) {
  return (
    <View style={{
      width: size, height: size,
      borderRadius: Math.round(size * 0.3),
      backgroundColor: `${color}1a`,
      borderWidth: 0.5,
      borderColor: `${color}30`,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}>
      <Text style={{ fontSize: size * 0.42, fontWeight: '700', color, letterSpacing: -0.3 }}>
        {name[0].toUpperCase()}
      </Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#0a0a0a' },
  scroll: { padding: 16, paddingBottom: 120, gap: 14 },

  // Header
  headerRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    justifyContent: 'space-between', paddingTop: 4,
  },
  countLabel: {
    fontSize: 11, fontWeight: '600',
    color: 'rgba(255,255,255,0.4)', letterSpacing: 1.2, marginBottom: 4,
  },
  headline:  { fontSize: 32, fontWeight: '800', color: '#fff', letterSpacing: -1 },
  toggleBtn: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: '#111111', borderWidth: 0.5, borderColor: '#222222',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  toggleIcon: { fontSize: 18, color: 'rgba(255,255,255,0.7)' },

  // Ablauf-Warnkarte
  warnCard: {
    backgroundColor: 'rgba(255,122,77,0.1)',
    borderWidth: 0.5, borderColor: 'rgba(255,122,77,0.4)',
    borderRadius: 18, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  warnIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(255,122,77,0.18)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  warnTitle: { fontSize: 14, fontWeight: '600', color: '#fff', marginBottom: 3 },
  warnSub:   { fontSize: 12, color: 'rgba(255,122,77,0.85)', lineHeight: 17 },

  // Jetzt aufbrauchen
  sectionHeaderRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 10, paddingHorizontal: 2,
  },
  sectionLabel:   {
    fontSize: 10, fontWeight: '700',
    color: 'rgba(255,255,255,0.35)', letterSpacing: 1, textTransform: 'uppercase',
  },
  sectionAllLink: { fontSize: 13, fontWeight: '600', color: ACCENT },
  recipeRow:      { gap: 10, paddingRight: 4 },
  invLoadingCard: {
    backgroundColor: '#111111', borderRadius: 16, borderWidth: 0.5,
    borderColor: '#222222', padding: 20,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  invLoadingText: { fontSize: 13, color: 'rgba(255,255,255,0.4)', fontWeight: '500', flex: 1 },
  recipeCard: {
    width: 175, height: 185, borderRadius: 18,
    overflow: 'hidden', backgroundColor: '#160c03',
    borderWidth: 0.5, borderColor: 'rgba(255,122,77,0.35)',
  },
  recipeOverlay:     { backgroundColor: 'rgba(255,85,15,0.2)' },
  recipeCardContent: { flex: 1, padding: 13, justifyContent: 'flex-end', gap: 6 },
  recipeTimeBadge: {
    position: 'absolute', top: 13, right: 13,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 99, paddingHorizontal: 8, paddingVertical: 4,
  },
  recipeTimeText: { fontSize: 11, color: '#fff', fontWeight: '600' },
  recipeMatchBadge: {
    position: 'absolute', top: 13, left: 13,
    borderRadius: 99, paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 0.5,
  },
  recipeMatchText: { fontSize: 10, fontWeight: '700' },
  recipeTags:     { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  recipeTag: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 99, paddingHorizontal: 7, paddingVertical: 3, maxWidth: 90,
  },
  recipeTagText:  { fontSize: 10, color: 'rgba(255,255,255,0.8)', fontWeight: '500' },
  recipeName:     { fontSize: 15, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  recipeMacros:   { fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: '500' },

  // Scan Buttons
  scanRow:     { flexDirection: 'row', gap: 8, height: 52 },
  scanPrimary: {
    flex: 1.5, backgroundColor: ACCENT, borderRadius: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, paddingHorizontal: 10,
  },
  scanPrimaryText: { fontSize: 12, fontWeight: '700', color: '#000', flexShrink: 1 },
  scanSecondary: {
    flex: 1, backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 0.5, borderColor: '#222222',
    alignItems: 'center', justifyContent: 'center', gap: 3,
  },
  scanSecondaryText: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.6)' },
  scanSecondaryRecording: { borderColor: 'rgba(247,79,79,0.4)', backgroundColor: 'rgba(247,79,79,0.08)' },
  scanAddBtn: { flex: 0, width: 52 },
  voiceInvDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#F74F4F' },

  // Voice confirmation modal
  voiceScrollContent: {
    flexGrow: 1, padding: 16, paddingBottom: 24, gap: 10,
  },
  voiceItemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#111111', borderRadius: 14, borderWidth: 0.5,
    borderColor: '#222222', padding: 14,
  },
  voiceItemRowSelected: { borderColor: `${ACCENT}55` },
  voiceCheckbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5,
    borderColor: '#333333', alignItems: 'center', justifyContent: 'center',
  },
  voiceCheckboxOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  voiceCheckmark: { fontSize: 12, fontWeight: '800', color: '#000' },
  voiceItemName: { fontSize: 14, fontWeight: '600', color: '#fff', marginBottom: 2 },
  voiceItemMeta: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  voiceHintText: { fontSize: 12, color: '#666666', textAlign: 'center', marginTop: 4 },
  voiceAddLink: { alignItems: 'center', paddingVertical: 4 },
  voiceAddLinkText: { fontSize: 14, color: ACCENT, fontWeight: '600' },
  voiceConfirmBtn: { backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  voiceConfirmBtnText: { color: '#000', fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },

  // Voice empty state
  voiceEmptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16,
  },
  voiceEmptyIcon: { fontSize: 56, color: '#666666' },
  voiceEmptyTitle: { fontSize: 20, fontWeight: '700', color: '#fff', letterSpacing: -0.4 },
  voiceEmptyHint: {
    fontSize: 14, color: '#666666', textAlign: 'center', lineHeight: 20,
  },
  voiceRetryBtn: {
    backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 14,
    paddingHorizontal: 32, alignItems: 'center', marginTop: 8,
  },
  voiceRetryBtnText: { color: '#000', fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },

  // Search
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 13,
    backgroundColor: '#111111', borderWidth: 0.5,
    borderColor: '#222222', borderRadius: 14,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#fff' },

  // Tabs
  tabRow: {
    flexDirection: 'row', backgroundColor: '#111111',
    borderRadius: 14, borderWidth: 0.5, borderColor: '#222222', padding: 4, gap: 4,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 10,
  },
  tabActive:          { backgroundColor: '#fff' },
  tabLabel:           { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.45)' },
  tabLabelActive:     { color: '#000' },
  tabBadge: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 99, paddingHorizontal: 6, paddingVertical: 1, minWidth: 18, alignItems: 'center',
  },
  tabBadgeActive:     { backgroundColor: 'rgba(0,0,0,0.12)' },
  tabBadgeText:       { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.4)' },
  tabBadgeTextActive: { color: 'rgba(0,0,0,0.55)' },

  // List card
  listCard: {
    backgroundColor: '#111111', borderRadius: 18,
    borderWidth: 0.5, borderColor: '#222222',
    overflow: 'hidden',
  },

  // Swipe-to-delete action
  swipeDeleteAction: {
    width: 80, backgroundColor: '#F74F4F',
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  swipeDeleteIcon: { fontSize: 18 },
  swipeDeleteText: { fontSize: 11, fontWeight: '700', color: '#f0f0f0' },

  // Item row
  itemRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 12, paddingVertical: 12, paddingHorizontal: 14,
  },
  itemRowActive: { backgroundColor: '#181818' },
  rowDivider:    { height: 0.5, backgroundColor: '#1e1e1e', marginHorizontal: 14 },
  itemName:  { fontSize: 14, fontWeight: '500', color: '#fff', letterSpacing: -0.1 },
  itemQty:   { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 1 },
  expiryLabel: { fontSize: 12, fontWeight: '600', flexShrink: 0 },
  chevron: {
    fontSize: 16, color: 'rgba(255,255,255,0.25)',
    transform: [{ rotate: '90deg' }], marginLeft: 2,
  },
  chevronOpen: {
    transform: [{ rotate: '-90deg' }],
  },

  // Detail panel (accordion content)
  detailPanel: {
    backgroundColor: '#181818',
    borderTopWidth: 0.5, borderTopColor: '#222222',
    paddingHorizontal: 14, paddingVertical: 14,
    gap: 14,
  },

  // Location switcher
  locationSection: { gap: 6 },
  locationSectionLabel: {
    fontSize: 10, fontWeight: '700',
    color: '#666666', letterSpacing: 1, textTransform: 'uppercase',
  },
  locationBtnRow: { flexDirection: 'row', gap: 6 },
  locationBtn: {
    flex: 1, backgroundColor: '#222222', borderRadius: 8,
    paddingVertical: 9, alignItems: 'center', justifyContent: 'center',
  },
  locationBtnActive: { backgroundColor: ACCENT },
  locationBtnText: { fontSize: 11, fontWeight: '700', color: '#666666' },
  locationBtnTextActive: { color: '#0a0a0a' },

  // Segment control
  segControl: {
    flexDirection: 'row', backgroundColor: '#111111',
    borderRadius: 10, borderWidth: 0.5, borderColor: '#222222', padding: 3, gap: 3,
  },
  segOpt: {
    flex: 1, paddingVertical: 8, borderRadius: 7,
    alignItems: 'center', justifyContent: 'center',
  },
  segOptActive:     { backgroundColor: '#fff' },
  segOptText:       { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.4)' },
  segOptTextActive: { color: '#000' },

  // AI card
  aiCard: {
    backgroundColor: 'rgba(200,255,0,0.04)',
    borderRadius: 14, borderWidth: 0.5,
    borderColor: 'rgba(200,255,0,0.12)', padding: 16, gap: 5,
  },
  aiLoadRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  aiLoadText: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  aiCardWarn: { backgroundColor: 'rgba(247,79,79,0.07)', borderColor: 'rgba(247,79,79,0.25)' },
  aiTopRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 2,
  },
  aiLabel: {
    fontSize: 10, fontWeight: '700', color: ACCENT,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  aiLabelWarn: {
    fontSize: 10, fontWeight: '700', color: '#F74F4F',
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  aiWarningText: { fontSize: 12, color: '#F74F4F', lineHeight: 18, fontWeight: '500', marginTop: 4 },
  aiIdealStorageText: { fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 4, fontWeight: '500' },
  aiUntil: { fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: '500' },
  aiDays:  { fontSize: 30, fontWeight: '800', color: '#fff', letterSpacing: -1.5, lineHeight: 34 },

  // Manual section
  manualSection: { gap: 10 },
  dateField: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#111111', borderRadius: 12,
    borderWidth: 0.5, borderColor: '#222222', padding: 13,
  },
  dateText:    { fontSize: 15, fontWeight: '700', color: '#fff', letterSpacing: -0.2 },
  dateChevron: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },

  // iOS inline picker
  iosPickerWrap: { marginHorizontal: -30, transform: [{ scale: 0.9 }], marginVertical: -16 },
  iosPicker:     { backgroundColor: '#111111', height: 320 },
  pickerBtnRow:  { flexDirection: 'row', gap: 8 },
  pickerBtnDel: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    backgroundColor: 'rgba(255,94,94,0.1)',
    borderWidth: 0.5, borderColor: 'rgba(255,94,94,0.25)',
    alignItems: 'center',
  },
  pickerBtnDelText: { fontSize: 13, fontWeight: '700', color: '#ff5e5e' },
  pickerBtnToday: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    backgroundColor: 'rgba(200,255,0,0.1)',
    borderWidth: 0.5, borderColor: 'rgba(200,255,0,0.25)',
    alignItems: 'center',
  },
  pickerBtnTodayText: { fontSize: 13, fontWeight: '700', color: ACCENT },

  // Expiry quick chips
  chipRow:          { flexDirection: 'row', gap: 6 },
  expiryChip: {
    flex: 1, paddingVertical: 9, borderRadius: 9,
    backgroundColor: '#111111', borderWidth: 0.5, borderColor: '#222222',
    alignItems: 'center',
  },
  expiryChipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  expiryChipText:       { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.45)' },
  expiryChipTextActive: { color: '#000' },

  // Detail action buttons
  detailBtnRow: { flexDirection: 'row', gap: 10 },
  detailDelBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: 'rgba(255,94,94,0.1)',
    borderRadius: 12, paddingVertical: 13,
    borderWidth: 0.5, borderColor: 'rgba(255,94,94,0.22)',
  },
  detailDelBtnText:  { fontSize: 13, fontWeight: '700', color: '#ff5e5e' },
  detailSaveBtn: {
    flex: 2, alignItems: 'center', justifyContent: 'center',
    backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 13,
  },
  detailSaveBtnText: { fontSize: 14, fontWeight: '800', color: '#000', letterSpacing: -0.2 },

  // Grid
  gridWrap:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridItem: {
    width: '48.5%', backgroundColor: '#111111', borderRadius: 16,
    borderWidth: 0.5, borderColor: '#222222', padding: 14, gap: 6,
  },
  gridItemName: { fontSize: 13, fontWeight: '600', color: '#fff', letterSpacing: -0.1, marginTop: 2 },
  gridItemQty:  { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  gridExpiry:   { fontSize: 11, fontWeight: '600' },

  // Search button (replaces +)
  scanAddText: { fontSize: 18, color: '#fff', lineHeight: 30 },

  // BLS Search Modal
  modalSafe: { flex: 1, backgroundColor: '#0a0a0a' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 0.5, borderBottomColor: '#222222',
  },
  modalClose: { fontSize: 15, color: 'rgba(255,255,255,0.5)', fontWeight: '700', width: 32 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  modalSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: 16, paddingHorizontal: 14, paddingVertical: 13,
    backgroundColor: '#111111', borderWidth: 0.5, borderColor: '#222222', borderRadius: 14,
  },
  modalSearchInput: { flex: 1, fontSize: 15, color: '#fff' },
  modalResultsList: { paddingHorizontal: 16, paddingBottom: 40, gap: 8 },
  modalResultsCount: {
    fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: 2,
  },
  modalResultsCard: {
    backgroundColor: '#111111', borderRadius: 18, borderWidth: 0.5, borderColor: '#222222',
  },
  modalResultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  modalResultBorder: { borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  modalResultGlyph: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: `${ACCENT}15`, borderWidth: 0.5, borderColor: `${ACCENT}30`,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  modalResultGlyphText: { fontSize: 15, fontWeight: '700', color: ACCENT },
  modalResultName: { fontSize: 14, fontWeight: '600', color: '#fff', letterSpacing: -0.1 },
  modalResultSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  modalResultChevron: { fontSize: 20, color: 'rgba(255,255,255,0.25)' },
  modalEmptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  modalEmptyText: { fontSize: 14, color: 'rgba(255,255,255,0.35)', textAlign: 'center' },

  // Empty state
  emptyCard: {
    backgroundColor: '#111111', borderRadius: 20, borderWidth: 0.5, borderColor: '#222222',
    padding: 36, alignItems: 'center', gap: 10, marginTop: 4,
  },
  emptyEmoji:   { fontSize: 44, marginBottom: 4 },
  emptyTitle:   { fontSize: 18, fontWeight: '700', color: '#fff', letterSpacing: -0.4 },
  emptySub: {
    fontSize: 13, color: 'rgba(255,255,255,0.45)',
    textAlign: 'center', lineHeight: 19,
  },
  emptyBtn:     { marginTop: 8, backgroundColor: ACCENT, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 13 },
  emptyBtnText: { color: '#000', fontSize: 14, fontWeight: '700' },
});
