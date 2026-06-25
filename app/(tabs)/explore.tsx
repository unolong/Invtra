import DateTimePicker from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { SafeAreaView } from 'react-native-safe-area-context';

import ItemDetailSheet from '@/components/ui/ItemDetailSheet';
import {
  daysUntil,
  type InventoryItem,
  type InventoryLocation,
  useInventory,
} from '@/context/inventory-context';
import { searchBls, type BlsItem } from '@/services/bls-search';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

const ACCENT = '#c8ff00';
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

const AI_EXPIRY: Record<string, { days: number; label: string }> = {
  protein:   { days: 4,  label: 'Fleisch & Fisch' },
  milch:     { days: 10, label: 'Milchprodukte' },
  gemüse:    { days: 6,  label: 'Frisches Gemüse' },
  obst:      { days: 7,  label: 'Frisches Obst' },
  carbs:     { days: 14, label: 'Brot & Getreide' },
  fett:      { days: 30, label: 'Öle & Fette' },
  sonstiges: { days: 7,  label: 'Allgemeine Lebensmittel' },
};

const EXPIRY_CHIPS = [
  { label: '1T',  days: 1  },
  { label: '3T',  days: 3  },
  { label: '7T',  days: 7  },
  { label: '14T', days: 14 },
  { label: '1M',  days: 30 },
] as const;

const LOCATIONS: InventoryLocation[] = ['Kühlschrank', 'Vorrat', 'Tiefkühler'];

const MOCK_RECIPES = [
  { id: '1', name: 'Schnell-Omelette', time: '10 Min.', kcal: 340, protein: 22 },
  { id: '2', name: 'Pfannengemüse',    time: '15 Min.', kcal: 280, protein: 12 },
  { id: '3', name: 'Frittata',         time: '20 Min.', kcal: 420, protein: 26 },
];

// ─── Helpers ──────────────────────────────────────────────────

function expColor(days: number): string {
  if (days <= 1)  return '#ff5e5e';
  if (days <= 3)  return ORANGE;
  if (days <= 7)  return '#ffb547';
  if (days <= 14) return '#26de81';
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

// ─── Main Screen ──────────────────────────────────────────────

export default function InventarScreen() {
  const { items, removeItem, updateItem, addItems } = useInventory();
  const [activeTab, setActiveTab]     = useState<InventoryLocation>('Kühlschrank');
  const [viewMode, setViewMode]       = useState<'list' | 'grid'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId]   = useState<string | null>(null);

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

  const handleBlsSearch = (q: string) => {
    setBlsQuery(q);
    if (!q.trim()) { setBlsResults([]); return; }
    setBlsSearching(true);
    setBlsResults(searchBls(q, 25));
    setBlsSearching(false);
  };

  const closeSearchModal = () => {
    setSearchModalOpen(false);
    setBlsQuery('');
    setBlsResults([]);
    setSelectedBlsItem(null);
  };

  // Collapse when switching tabs or searching
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
          <TouchableOpacity
            style={s.toggleBtn}
            onPress={() => { setViewMode(v => v === 'list' ? 'grid' : 'list'); setExpandedId(null); }}
            hitSlop={8}
          >
            <Text style={s.toggleIcon}>{viewMode === 'list' ? '⊞' : '☰'}</Text>
          </TouchableOpacity>
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
              <TouchableOpacity hitSlop={8}>
                <Text style={s.sectionAllLink}>Alle ›</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.recipeRow}
            >
              {MOCK_RECIPES.map(recipe => (
                <TouchableOpacity key={recipe.id} style={s.recipeCard} activeOpacity={0.85}>
                  <View style={[StyleSheet.absoluteFill, s.recipeOverlay]} />
                  <View style={s.recipeCardContent}>
                    <View style={s.recipeTimeBadge}>
                      <Text style={s.recipeTimeText}>⏱ {recipe.time}</Text>
                    </View>
                    <View style={s.recipeTags}>
                      {expiring.slice(0, 2).map(e => (
                        <View key={e.id} style={s.recipeTag}>
                          <Text style={s.recipeTagText} numberOfLines={1}>{e.name}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={s.recipeName} numberOfLines={2}>{recipe.name}</Text>
                    <Text style={s.recipeMacros}>{recipe.kcal} kcal · {recipe.protein}g Protein</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
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
            style={s.scanSecondary}
            onPress={() => Alert.alert('Spracheingabe', 'Kommt bald!')}
            activeOpacity={0.8}
          >
            <Text style={{ fontSize: 14 }}>🎙</Text>
            <Text style={s.scanSecondaryText}>Sprache</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.scanSecondary, s.scanAddBtn]}
            onPress={() => setSearchModalOpen(true)}
            activeOpacity={0.8}
          >
            <Text style={s.scanAddText}>🔍</Text>
          </TouchableOpacity>
        </View>

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
                onToggle={toggleExpanded}
                onSave={async (id, changes) => { await updateItem(id, changes); }}
                onDelete={(id) => { removeItem(id); setExpandedId(null); }}
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
  item, isExpanded, isLast, onToggle, onSave, onDelete,
}: {
  item: InventoryItem;
  isExpanded: boolean;
  isLast: boolean;
  onToggle: (id: string) => void;
  onSave: (id: string, changes: Partial<Omit<InventoryItem, 'id'>>) => void;
  onDelete: (id: string) => void;
}) {
  const color   = CAT_COLOR[item.cat] || ACCENT;
  const aiMeta  = AI_EXPIRY[item.cat] ?? AI_EXPIRY.sonstiges;
  const aiDate  = makeExpiresAt(aiMeta.days);
  const displayExpiry = item.expiresAt ?? aiDate;
  const days    = daysUntil(displayExpiry);
  const label   = expLabel(days);
  const ec      = expColor(days);

  const [mode, setMode]           = useState<'ai' | 'manual'>('ai');
  const [draftExpiry, setDraft]   = useState<string | null>(item.expiresAt);
  const [showPicker, setShowPick] = useState(false);
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    if (!isExpanded) {
      setMode('ai');
      setDraft(item.expiresAt);
      setShowPick(false);
      setSaving(false);
    }
  }, [isExpanded, item.expiresAt]);

  const activeChip = daysFromToday(draftExpiry);

  const handleSave = async () => {
    if (saving) return;
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

  return (
    <View>
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

          {/* Toggle */}
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

          {/* AI mode */}
          {mode === 'ai' && (
            <View style={s.aiCard}>
              <View style={s.aiTopRow}>
                <Text style={s.aiLabel}>✦ KI-Schätzung</Text>
                <Text style={s.aiUntil}>bis {formatDate(aiDate)}</Text>
              </View>
              <Text style={s.aiDays}>~{aiMeta.days} Tage</Text>
              <Text style={s.aiHint}>
                Die KI schätzt, dass {item.name} noch ~{aiMeta.days} Tage haltbar ist – basierend auf typischen Richtwerten für {aiMeta.label.toLowerCase()}.
              </Text>
            </View>
          )}

          {/* Manual mode */}
          {mode === 'manual' && (
            <View style={s.manualSection}>
              {/* Date field */}
              <TouchableOpacity
                style={s.dateField}
                onPress={() => setShowPick(v => !v)}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 18 }}>📅</Text>
                <Text style={s.dateText}>{formatDate(draftExpiry)}</Text>
                <View style={{ flex: 1 }} />
                <Text style={s.dateChevron}>{showPicker ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {/* iOS inline DatePicker */}
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

              {/* Android native dialog */}
              {showPicker && Platform.OS === 'android' && (
                <DateTimePicker
                  value={draftExpiry ? new Date(draftExpiry) : new Date()}
                  mode="date"
                  display="default"
                  onChange={(event, date) => {
                    setShowPick(false);
                    if (event.type === 'set' && date) {
                      const d = new Date(date);
                      d.setHours(0, 0, 0, 0);
                      setDraft(d.toISOString());
                    }
                  }}
                />
              )}

              {/* Quick chips */}
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

          {/* Action buttons */}
          <View style={s.detailBtnRow}>
            <TouchableOpacity style={s.detailDelBtn} onPress={handleDelete} activeOpacity={0.8}>
              <Text style={s.detailDelBtnText}>Löschen</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.detailSaveBtn, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={s.detailSaveBtnText}>{saving ? 'Speichert…' : 'Speichern'}</Text>
            </TouchableOpacity>
          </View>

        </View>
      )}

      {!isLast && <View style={s.rowDivider} />}
    </View>
  );
}

// ─── GridItem ────────────────────────────────────────────────

function GridItem({ item }: { item: InventoryItem }) {
  const color    = CAT_COLOR[item.cat] || ACCENT;
  const aiMeta   = AI_EXPIRY[item.cat] ?? AI_EXPIRY.sonstiges;
  const displayExpiry = item.expiresAt ?? makeExpiresAt(aiMeta.days);
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
  scanAddBtn: { flex: 0, width: 52 },

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
  },

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
  aiTopRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 2,
  },
  aiLabel: {
    fontSize: 10, fontWeight: '700', color: ACCENT,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  aiUntil: { fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: '500' },
  aiDays:  { fontSize: 30, fontWeight: '800', color: '#fff', letterSpacing: -1.5, lineHeight: 34 },
  aiHint:  { fontSize: 11, color: 'rgba(255,255,255,0.38)', lineHeight: 16 },

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
