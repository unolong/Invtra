import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const SCREEN_HEIGHT = Dimensions.get('window').height;
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFoodLog } from '@/context/food-log-context';
import { capturedPhoto } from '@/lib/captured-photo';
import { voiceResult } from '@/lib/voice-result';
import { analyzeDishPhoto } from '@/services/anthropic';
import { searchBls, type BlsItem } from '@/services/bls-search';
import { fetchProductByBarcode, type Product } from '@/services/open-food-facts';

const ACCENT = '#c8ff00';
const ORANGE = '#F7A94F';
const BLUE   = '#4F8EF7';
const RED    = '#F74F4F';

const UNITS = ['g', 'ml', 'Stück'] as const;

// ─── Types ────────────────────────────────────────────────────

type ComponentItem = {
  id: string;
  name: string;
  unit: string;
  isHiddenFat: boolean;
  amountStr: string;
  caloriesPer100: number;
  proteinPer100: number;
  carbsPer100: number;
  fatPer100: number;
};

// ─── Helpers ──────────────────────────────────────────────────

function cKcal(c: ComponentItem) { return Math.round((Number(c.amountStr) || 0) / 100 * c.caloriesPer100); }
function cProt(c: ComponentItem) { return Math.round((Number(c.amountStr) || 0) / 100 * c.proteinPer100); }
function cCarb(c: ComponentItem) { return Math.round((Number(c.amountStr) || 0) / 100 * c.carbsPer100); }
function cFat(c: ComponentItem)  { return Math.round((Number(c.amountStr) || 0) / 100 * c.fatPer100); }
function stepFor(unit: string)   { return unit === 'Stück' ? 1 : 10; }

function blsToComponent(item: BlsItem): Omit<ComponentItem, 'id'> {
  return {
    name: item.name,
    unit: 'g',
    isHiddenFat: false,
    amountStr: '100',
    caloriesPer100: Math.round(item.pro100g.kalorien),
    proteinPer100:  Math.round(item.pro100g.protein * 10) / 10,
    carbsPer100:    Math.round(item.pro100g.kohlenhydrate * 10) / 10,
    fatPer100:      Math.round(item.pro100g.fett * 10) / 10,
  };
}

function productToComponent(p: Product): Omit<ComponentItem, 'id'> {
  return {
    name: p.name,
    unit: p.isDrink ? 'ml' : 'g',
    isHiddenFat: false,
    amountStr: '100',
    caloriesPer100: Math.round(p.caloriesPer100g),
    proteinPer100:  Math.round(p.proteinPer100g * 10) / 10,
    carbsPer100:    Math.round(p.carbsPer100g * 10) / 10,
    fatPer100:      Math.round(p.fatPer100g * 10) / 10,
  };
}

// ─── Screen ───────────────────────────────────────────────────

export default function AiResultScreen() {
  const { meal = 'Frühstück', fromVoice } = useLocalSearchParams<{ meal?: string; fromVoice?: string }>();
  const { addEntry, totals, goals } = useFoodLog();
  const { bottom: bottomInset } = useSafeAreaInsets();
  const photo = capturedPhoto.get();

  const remaining = {
    calories: Math.max(0, goals.calories - totals.calories),
    protein:  Math.max(0, goals.protein  - totals.protein),
    carbs:    Math.max(0, goals.carbs    - totals.carbs),
    fat:      Math.max(0, goals.fat      - totals.fat),
  };

  // ── Main state
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [dishName, setDishName]     = useState('');
  const [components, setComponents] = useState<ComponentItem[]>([]);
  const [adding, setAdding]         = useState(false);

  // ── Add-sheet state
  const [showAddSheet, setShowAddSheet]   = useState(false);
  const [searchQuery, setSearchQuery]     = useState('');
  const [searchResults, setSearchResults] = useState<BlsItem[]>([]);
  const [barcodeMode, setBarcodeMode]     = useState(false);
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [manualMode, setManualMode]       = useState(false);
  const [addName, setAddName]             = useState('');
  const [addAmount, setAddAmount]         = useState('100');
  const [addUnit, setAddUnit]             = useState<typeof UNITS[number]>('g');
  const [addCalories, setAddCalories]     = useState('');
  const [permission, requestPermission]   = useCameraPermissions();
  const [torch, setTorch]               = useState(false);
  const barcodeRef  = useRef(false);
  const searchRef   = useRef<TextInput>(null);

  // ── BLS live search
  useEffect(() => {
    const q = searchQuery.trim();
    setSearchResults(q ? searchBls(q, { limit: 20 }) : []);
  }, [searchQuery]);

  const closeSheet = useCallback(() => {
    setShowAddSheet(false);
    setSearchQuery('');
    setSearchResults([]);
    setBarcodeMode(false);
    setManualMode(false);
    setAddName(''); setAddAmount('100'); setAddUnit('g'); setAddCalories('');
    barcodeRef.current = false;
    setTorch(false);
  }, []);

  const openSheet = useCallback(() => {
    setShowAddSheet(true);
    setBarcodeMode(false);
    setManualMode(false);
    setSearchQuery('');
    setSearchResults([]);
    barcodeRef.current = false;
  }, []);

  const addComponent = useCallback((partial: Omit<ComponentItem, 'id'>) => {
    setComponents(prev => [...prev, { ...partial, id: `add-${Date.now()}` }]);
    closeSheet();
  }, [closeSheet]);

  const addFromBls = useCallback((item: BlsItem) => {
    addComponent(blsToComponent(item));
  }, [addComponent]);

  const addFromProduct = useCallback((p: Product) => {
    addComponent(productToComponent(p));
  }, [addComponent]);

  const confirmManual = () => {
    if (!addName.trim()) return;
    addComponent({
      name: addName.trim(),
      unit: addUnit,
      isHiddenFat: false,
      amountStr: String(Math.max(1, Number(addAmount) || 1)),
      caloriesPer100: Math.max(0, Number(addCalories) || 0),
      proteinPer100: 0, carbsPer100: 0, fatPer100: 0,
    });
  };

  const startBarcodeMode = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) { Alert.alert('Kamera-Zugriff benötigt'); return; }
    }
    setBarcodeMode(true);
    barcodeRef.current = false;
  };

  const handleBarcode = useCallback(async ({ data }: { data: string }) => {
    if (barcodeRef.current) return;
    barcodeRef.current = true;
    setBarcodeLoading(true);
    try {
      const product = await fetchProductByBarcode(data);
      if (product) {
        addFromProduct(product);
      } else {
        Alert.alert('Nicht gefunden', 'Produkt nicht in der Datenbank.');
        barcodeRef.current = false;
      }
    } finally {
      setBarcodeLoading(false);
    }
  }, [addFromProduct]);

  // ── Dish analysis
  const analyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const vr = voiceResult.consume();
      if (vr) {
        setDishName(vr.dishName);
        setComponents(vr.components.map((c, i) => ({
          id: String(i),
          name: c.name,
          unit: c.unit,
          isHiddenFat: c.isHiddenFat,
          caloriesPer100: c.caloriesPer100,
          proteinPer100: c.proteinPer100,
          carbsPer100: c.carbsPer100,
          fatPer100: c.fatPer100,
          amountStr: String(c.amount),
        })));
        return;
      }
      if (!photo.base64) { setError('Kein Foto verfügbar.'); return; }
      const result = await analyzeDishPhoto(photo.base64, meal, remaining);
      console.log('[ai-result] dishName:', result.dishName, 'components:', result.components.length);
      setDishName(result.dishName);
      setComponents(result.components.map((c, i) => ({
        id: String(i),
        name: c.name,
        unit: c.unit,
        isHiddenFat: c.isHiddenFat,
        caloriesPer100: c.caloriesPer100,
        proteinPer100:  c.proteinPer100,
        carbsPer100:    c.carbsPer100,
        fatPer100:      c.fatPer100,
        amountStr: String(c.amount),
      })));
      if (result.components.length === 0) setError('Keine Zutaten erkannt. Bitte nochmal versuchen.');
    } catch (e) {
      console.error('[ai-result] analyze error:', e);
      setError('Scan fehlgeschlagen. Bitte versuche es erneut.');
    } finally {
      setLoading(false);
    }
  }, [photo.base64, meal]);

  useEffect(() => { analyze(); }, []);

  // ── Live totals
  const totalKcal = components.reduce((a, c) => a + cKcal(c), 0);
  const totalP    = components.reduce((a, c) => a + cProt(c), 0);
  const totalC    = components.reduce((a, c) => a + cCarb(c), 0);
  const totalF    = components.reduce((a, c) => a + cFat(c), 0);

  const updateAmountStr = (id: string, str: string) =>
    setComponents(prev => prev.map(c => c.id === id ? { ...c, amountStr: str } : c));

  const adjustAmount = (id: string, delta: number) =>
    setComponents(prev => prev.map(c => {
      if (c.id !== id) return c;
      return { ...c, amountStr: String(Math.max(0, (Number(c.amountStr) || 0) + delta)) };
    }));

  const removeComponent = (id: string) =>
    setComponents(prev => prev.filter(c => c.id !== id));

  const handleAdd = useCallback(async () => {
    if (components.length === 0) return;
    setAdding(true);
    try {
      for (const c of components) {
        await addEntry({ meal, name: c.name, brand: '', grams: Number(c.amountStr) || 0,
          calories: cKcal(c), protein: cProt(c), carbs: cCarb(c), fat: cFat(c) });
      }
      capturedPhoto.clear();
      router.back();
    } catch (e: any) {
      Alert.alert('Fehler', e.message);
    } finally {
      setAdding(false);
    }
  }, [components, meal, addEntry]);

  const hasContent = !loading && !error && components.length > 0;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={s.headerBack}>← Zurück</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>KI-Ergebnis</Text>
        <View style={s.mealChip}>
          <Text style={s.mealChipText}>{meal}</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={s.kav} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        {/* TotalBar — fixed above scroll */}
        {hasContent && (
          <View style={s.totalBar}>
            {!!dishName && <Text style={s.dishName} numberOfLines={1}>{dishName}</Text>}
            <Text style={s.totalKcal}>{totalKcal} <Text style={s.totalKcalUnit}>kcal</Text></Text>
            <View style={s.macroRow}>
              <MacroPill label="Protein" value={totalP} color={BLUE} />
              <MacroPill label="Carbs"   value={totalC} color={ORANGE} />
              <MacroPill label="Fett"    value={totalF} color={RED} />
            </View>
          </View>
        )}

        {/* ScrollView — photo + cards scroll together */}
        <ScrollView
          style={s.scrollFlex}
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {/* Photo / voice placeholder inside scroll */}
          {fromVoice === '1' ? (
            <View style={[s.photoWrapper, s.voicePlaceholder]}>
              <Text style={{ fontSize: 48 }}>🎙</Text>
              <Text style={s.voicePlaceholderText}>Spracheingabe</Text>
              {loading && <ActivityIndicator color={ACCENT} style={{ marginTop: 12 }} />}
            </View>
          ) : !!photo.uri ? (
            <View style={s.photoWrapper}>
              <Image source={{ uri: photo.uri }} style={s.photo} resizeMode="cover" />
              {loading && (
                <View style={s.photoOverlay}>
                  <ActivityIndicator color={ACCENT} size="large" />
                  <Text style={s.photoOverlayText}>Gericht wird zerlegt…</Text>
                </View>
              )}
            </View>
          ) : null}

          {error ? (
            <View style={s.stateCard}>
              <Text style={s.stateText}>{error}</Text>
              <TouchableOpacity style={s.retryBtn} onPress={analyze}>
                <Text style={s.retryBtnText}>Wiederholen</Text>
              </TouchableOpacity>
            </View>
          ) : loading ? (
            !photo.uri && <View style={s.stateCard}><ActivityIndicator color={ACCENT} /></View>
          ) : components.length === 0 ? (
            <View style={s.stateCard}>
              <Text style={s.stateText}>Kein Gericht erkannt.</Text>
              <TouchableOpacity style={s.retryBtn} onPress={analyze}>
                <Text style={s.retryBtnText}>Erneut analysieren</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {components.map(c => {
                const kcalVal    = cKcal(c);
                const pct        = totalKcal > 0 ? kcalVal / totalKcal : 0;
                const barColor   = c.isHiddenFat ? ORANGE : ACCENT;
                const cardBorder = c.isHiddenFat ? `${ORANGE}55` : '#222222';
                return (
                  <View key={c.id} style={[s.componentCard, { borderColor: cardBorder }]}>

                    {/* Row 1: glyph · name (2 lines) · remove */}
                    <View style={s.cardRow1}>
                      <View style={[s.glyph, c.isHiddenFat && s.glyphHidden]}>
                        <Text style={[s.glyphText, c.isHiddenFat && { color: ORANGE }]}>
                          {c.name[0]?.toUpperCase() ?? '?'}
                        </Text>
                      </View>
                      <View style={s.cardInfo}>
                        <Text style={s.componentName} numberOfLines={2}>{c.name}</Text>
                        {c.isHiddenFat ? (
                          <View style={s.hiddenMeta}>
                            <TouchableOpacity
                              style={s.hiddenBadge}
                              hitSlop={6}
                              onPress={() => Alert.alert(
                                'Verstecktes Fett',
                                'Zubereitungsfett (Öl, Butter) wird separat erfasst, damit es nicht doppelt zählt. Die anderen Zutaten enthalten nur ihr natürliches Eigenfett.',
                              )}
                            >
                              <Text style={s.hiddenBadgeText}>verstecktes Fett  ⓘ</Text>
                            </TouchableOpacity>
                            <Text style={s.hiddenInfo}>Separat, nicht in anderen Zutaten enthalten</Text>
                          </View>
                        ) : (
                          <Text style={s.componentKcal}>{kcalVal} kcal</Text>
                        )}
                        {c.isHiddenFat && (
                          <Text style={s.componentKcal}>{kcalVal} kcal</Text>
                        )}
                      </View>
                      <TouchableOpacity style={s.removeBtn} onPress={() => removeComponent(c.id)} hitSlop={10}>
                        <Text style={s.removeBtnText}>✕</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Row 2: stepper with long-press acceleration */}
                    <View style={s.cardRow2}>
                      <StepButton label="−" onStep={() => adjustAmount(c.id, -stepFor(c.unit))} disabled={(Number(c.amountStr) || 0) <= 0} />
                      <TextInput
                        style={s.stepInput}
                        value={c.amountStr}
                        onChangeText={str => updateAmountStr(c.id, str.replace(/[^0-9]/g, ''))}
                        keyboardType="number-pad"
                        returnKeyType="done"
                        selectTextOnFocus
                      />
                      <Text style={s.stepUnit}>{c.unit}</Text>
                      <StepButton label="+" onStep={() => adjustAmount(c.id, stepFor(c.unit))} />
                    </View>

                    {/* Calorie proportion bar */}
                    <View style={s.calBarTrack}>
                      <View style={[s.calBarFill, { width: `${Math.min(100, Math.round(pct * 100))}%`, backgroundColor: barColor }]} />
                    </View>

                  </View>
                );
              })}

              <TouchableOpacity style={s.addZutatBtn} onPress={openSheet} activeOpacity={0.7}>
                <Text style={s.addZutatBtnText}>+ Zutat hinzufügen</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>

        {/* CTA — in layout flow, pushed above keyboard */}
        {hasContent && (
          <View style={[s.ctaArea, { paddingBottom: Math.max(bottomInset, 16) }]}>
            <TouchableOpacity
              style={[s.ctaBtn, (components.length === 0 || adding) && s.ctaBtnDisabled]}
              onPress={handleAdd}
              disabled={components.length === 0 || adding}
              activeOpacity={0.85}
            >
              {adding
                ? <ActivityIndicator color="#000" />
                : <Text style={s.ctaBtnText}>{totalKcal} kcal zu {meal} hinzufügen</Text>}
            </TouchableOpacity>
          </View>
        )}

      </KeyboardAvoidingView>

      {/* ── Add-Ingredient Sheet ── */}
      <Modal
        visible={showAddSheet}
        transparent
        animationType="slide"
        onRequestClose={closeSheet}
        onShow={() => {
          if (!barcodeMode && !manualMode) {
            setTimeout(() => searchRef.current?.focus(), 100);
          }
        }}
      >
        {/*
          Layout: flex column, dark overlay fills the space ABOVE the sheet.
          The overlay is a sibling ABOVE the sheet in JSX so the sheet
          (rendered later = higher z-index) receives all touches first.
        */}
        <View style={s.sheetBackdrop}>
          {/* Dark overlay — only covers area above sheet */}
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeSheet}>
            <View style={s.sheetOverlayColor} />
          </TouchableOpacity>

          {/* KAV wraps only the sheet — pushes it above keyboard */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={[s.sheet, { paddingBottom: Math.max(bottomInset, 16) }]}>

              {/* Handle + header */}
              <View style={s.sheetHandle} />
              <View style={s.sheetHeader}>
                <Text style={s.sheetTitle}>Zutat hinzufügen</Text>
                <TouchableOpacity onPress={closeSheet} hitSlop={12}>
                  <Text style={s.sheetClose}>✕</Text>
                </TouchableOpacity>
              </View>

              {!manualMode ? (
                <>
                  {/* Search + Barcode row */}
                  <View style={s.searchRow}>
                    <TextInput
                      ref={searchRef}
                      style={s.searchInput}
                      placeholder="Zutat suchen…"
                      placeholderTextColor="#666666"
                      value={searchQuery}
                      onChangeText={q => { setSearchQuery(q); setBarcodeMode(false); }}
                      keyboardType="default"
                      returnKeyType="search"
                      clearButtonMode="while-editing"
                      autoCorrect={false}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity style={s.sheetBarcodeBtn} onPress={startBarcodeMode} activeOpacity={0.75}>
                      <Text style={s.sheetBarcodeBtnText}>Barcode</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Barcode camera */}
                  {barcodeMode && (
                    <View style={s.barcodePreview}>
                      {barcodeLoading ? (
                        <View style={s.barcodeLoader}>
                          <ActivityIndicator color={ACCENT} size="large" />
                          <Text style={s.barcodeLoaderText}>Produkt wird gesucht…</Text>
                        </View>
                      ) : (
                        <>
                          <CameraView
                            style={{ flex: 1 }}
                            facing="back"
                            onBarcodeScanned={handleBarcode}
                            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
                            enableTorch={torch}
                          />
                          <TouchableOpacity
                            style={s.sheetTorchBtn}
                            onPress={() => setTorch(t => !t)}
                            activeOpacity={0.75}
                          >
                            <Text style={[s.sheetTorchIcon, torch && s.sheetTorchIconOn]}>⚡</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={s.cancelBarcodeBtn} onPress={() => { setBarcodeMode(false); barcodeRef.current = false; setTorch(false); }}>
                            <Text style={s.cancelBarcodeBtnText}>Abbrechen</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  )}

                  {/* Search results */}
                  {!barcodeMode && (
                    <ScrollView
                      style={s.resultsList}
                      keyboardShouldPersistTaps="handled"
                      showsVerticalScrollIndicator={false}
                    >
                      {searchResults.map(item => (
                        <TouchableOpacity key={item.id} style={s.resultItem} onPress={() => addFromBls(item)} activeOpacity={0.7}>
                          <View style={s.resultLeft}>
                            <Text style={s.resultName} numberOfLines={1}>{item.name}</Text>
                            <Text style={s.resultKcal}>
                              {Math.round(item.pro100g.kalorien)} kcal · {Math.round(item.pro100g.protein * 10) / 10}g P · {Math.round(item.pro100g.kohlenhydrate * 10) / 10}g C · {Math.round(item.pro100g.fett * 10) / 10}g F · pro 100g
                            </Text>
                          </View>
                          <Text style={s.resultAdd}>+</Text>
                        </TouchableOpacity>
                      ))}

                      {searchQuery.trim() !== '' && searchResults.length === 0 && (
                        <View style={s.noResults}>
                          <Text style={s.noResultsText}>Kein Eintrag gefunden</Text>
                          <TouchableOpacity style={s.manualFallbackBtn} onPress={() => setManualMode(true)} activeOpacity={0.75}>
                            <Text style={s.manualFallbackText}>Manuell eingeben</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {searchQuery.trim() === '' && !barcodeMode && (
                        <Text style={s.searchHint}>Tippe den Namen einer Zutat ein oder tippe auf Barcode</Text>
                      )}
                    </ScrollView>
                  )}
                </>
              ) : (
                /* Manual fallback form */
                <ScrollView style={s.resultsList} keyboardShouldPersistTaps="handled">
                  <Text style={s.manualFormLabel}>MANUELL EINGEBEN</Text>
                  <TextInput
                    style={s.manualInput}
                    placeholder="Name (z.B. Butter)"
                    placeholderTextColor="#666666"
                    value={addName}
                    onChangeText={setAddName}
                    autoFocus
                    returnKeyType="next"
                  />
                  <View style={s.manualAmountRow}>
                    <TextInput
                      style={[s.manualInput, { flex: 1 }]}
                      placeholder="Menge"
                      placeholderTextColor="#666666"
                      value={addAmount}
                      onChangeText={setAddAmount}
                      keyboardType="number-pad"
                      returnKeyType="next"
                    />
                    <View style={s.unitChips}>
                      {UNITS.map(u => (
                        <TouchableOpacity key={u} style={[s.unitChip, addUnit === u && s.unitChipActive]} onPress={() => setAddUnit(u)} activeOpacity={0.75}>
                          <Text style={[s.unitChipText, addUnit === u && s.unitChipTextActive]}>{u}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  <TextInput
                    style={s.manualInput}
                    placeholder="kcal pro 100g"
                    placeholderTextColor="#666666"
                    value={addCalories}
                    onChangeText={setAddCalories}
                    keyboardType="number-pad"
                    returnKeyType="done"
                  />
                  <View style={s.manualBtnRow}>
                    <TouchableOpacity style={s.manualBack} onPress={() => setManualMode(false)}>
                      <Text style={s.manualBackText}>← Zurück</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.manualConfirm, !addName.trim() && { opacity: 0.35 }]}
                      onPress={confirmManual}
                      disabled={!addName.trim()}
                      activeOpacity={0.85}
                    >
                      <Text style={s.manualConfirmText}>Hinzufügen</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

// ─── StepButton — long-press with acceleration ────────────────

function StepButton({ onStep, label, disabled }: { onStep: () => void; label: string; disabled?: boolean }) {
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef  = useRef(0);
  const fnRef     = useRef(onStep);
  fnRef.current   = onStep;

  const stop = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const start = useCallback(() => {
    if (disabled) return;
    fnRef.current();
    startRef.current = Date.now();
    const next = () => {
      const elapsed = Date.now() - startRef.current;
      const delay = elapsed < 1000 ? 300 : elapsed < 3000 ? 100 : 50;
      timerRef.current = setTimeout(() => { fnRef.current(); next(); }, delay);
    };
    next();
  }, [disabled]);

  useEffect(() => stop, [stop]);

  return (
    <Pressable
      style={({ pressed }) => [s.stepBtn, pressed && { opacity: 0.6 }, disabled && s.stepBtnDisabled]}
      onPressIn={start}
      onPressOut={stop}
      hitSlop={6}
    >
      <Text style={s.stepBtnText}>{label}</Text>
    </Pressable>
  );
}

// ─── MacroPill ────────────────────────────────────────────────

function MacroPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[s.macroPill, { backgroundColor: `${color}14`, borderColor: `${color}30` }]}>
      <Text style={[s.macroPillValue, { color }]}>{value}g</Text>
      <Text style={s.macroPillLabel}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  kav:  { flex: 1 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 0.5, borderBottomColor: '#222222',
  },
  headerBack:   { fontSize: 15, color: ACCENT, fontWeight: '600', width: 80 },
  headerTitle:  { fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  mealChip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 99,
    backgroundColor: `${ACCENT}18`, borderWidth: 0.5, borderColor: `${ACCENT}40`,
  },
  mealChipText: { fontSize: 12, fontWeight: '600', color: ACCENT },

  // Photo
  photoWrapper: { width: '100%', height: 190, backgroundColor: '#111111', position: 'relative', marginBottom: 4 },
  photo:        { width: '100%', height: '100%' },
  photoOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  photoOverlayText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  voicePlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  voicePlaceholderText: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },

  // Total bar
  totalBar: {
    backgroundColor: '#0f0f0f',
    borderBottomWidth: 0.5, borderBottomColor: '#222222',
    paddingHorizontal: 16, paddingVertical: 14,
    alignItems: 'center', gap: 3,
  },
  dishName:      { fontSize: 12, color: '#666666', fontWeight: '500', letterSpacing: 0.2 },
  totalKcal:     { fontSize: 38, fontWeight: '800', color: '#f0f0f0', letterSpacing: -2 },
  totalKcalUnit: { fontSize: 18, fontWeight: '600', color: '#666666', letterSpacing: 0 },
  macroRow:      { flexDirection: 'row', gap: 8, marginTop: 2 },
  macroPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 99, borderWidth: 0.5,
  },
  macroPillValue: { fontSize: 13, fontWeight: '700' },
  macroPillLabel: { fontSize: 11, color: '#666666', fontWeight: '600' },

  // Scroll
  scrollFlex: { flex: 1 },
  scroll:     { padding: 14, paddingBottom: 14, gap: 10 },

  // State
  stateCard: {
    backgroundColor: '#111111', borderRadius: 18, padding: 24,
    borderWidth: 0.5, borderColor: '#222222', gap: 12, alignItems: 'center',
  },
  stateText:    { color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center' },
  retryBtn:     { backgroundColor: '#222222', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  retryBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  // Component card
  componentCard: { backgroundColor: '#111111', borderRadius: 16, borderWidth: 0.5, overflow: 'hidden' },
  cardRow1: {
    flexDirection: 'row', alignItems: 'flex-start',
    gap: 12, paddingHorizontal: 14, paddingTop: 13, paddingBottom: 8,
  },
  glyph: {
    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
    backgroundColor: `${ACCENT}18`, borderWidth: 0.5, borderColor: `${ACCENT}30`,
    alignItems: 'center', justifyContent: 'center',
  },
  glyphHidden:     { backgroundColor: `${ORANGE}18`, borderColor: `${ORANGE}30` },
  glyphText:       { fontSize: 15, fontWeight: '700', color: ACCENT, letterSpacing: -0.3 },
  cardInfo:        { flex: 1, minWidth: 0 },
  componentName:   { fontSize: 15, fontWeight: '600', color: '#f0f0f0', letterSpacing: -0.1, marginBottom: 3 },
  componentKcal:   { fontSize: 12, color: '#666666', marginTop: 2 },

  // Hidden fat meta
  hiddenMeta:  { gap: 2, marginBottom: 1 },
  hiddenBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6,
    backgroundColor: `${ORANGE}18`, borderWidth: 0.5, borderColor: `${ORANGE}40`,
  },
  hiddenBadgeText: { fontSize: 9, fontWeight: '700', color: ORANGE, letterSpacing: 0.3, textTransform: 'uppercase' },
  hiddenInfo:      { fontSize: 10, color: '#555555', lineHeight: 13 },

  removeBtn:     { width: 24, height: 24, borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 4 },
  removeBtnText: { fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: '700' },

  cardRow2: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 11, gap: 6, justifyContent: 'flex-end' },
  stepBtn:        { width: 32, height: 32, borderRadius: 9, backgroundColor: '#222222', alignItems: 'center', justifyContent: 'center' },
  stepBtnDisabled:{ opacity: 0.3 },
  stepBtnText:    { fontSize: 18, fontWeight: '700', color: '#f0f0f0', lineHeight: 22 },
  stepInput: {
    width: 52, height: 32, borderRadius: 8,
    backgroundColor: '#0a0a0a', borderWidth: 0.5, borderColor: '#333333',
    textAlign: 'center', fontSize: 14, fontWeight: '700', color: '#fff',
  },
  stepUnit: { fontSize: 12, color: '#666666', fontWeight: '600', minWidth: 22, textAlign: 'left' },

  calBarTrack: { height: 3, backgroundColor: '#1a1a1a' },
  calBarFill:  { height: 3 },

  // Add button
  addZutatBtn:     { borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#222222', borderStyle: 'dashed' },
  addZutatBtnText: { color: 'rgba(255,255,255,0.4)', fontSize: 14, fontWeight: '600' },

  // CTA
  ctaArea:        { paddingHorizontal: 16, paddingTop: 12, backgroundColor: '#0a0a0a', borderTopWidth: 0.5, borderTopColor: '#222222' },
  ctaBtn:         { backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  ctaBtnDisabled: { opacity: 0.35 },
  ctaBtnText:     { color: '#000', fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },

  // ── Add sheet ──
  sheetBackdrop:    { flex: 1, justifyContent: 'flex-end' },
  sheetOverlayColor: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: '#111111',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 0.5, borderTopColor: '#2a2a2a',
    minHeight: SCREEN_HEIGHT * 0.6,
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#333', alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12 },
  sheetTitle:  { fontSize: 16, fontWeight: '700', color: '#f0f0f0', letterSpacing: -0.3 },
  sheetClose:  { fontSize: 16, color: '#666', fontWeight: '600', padding: 4 },

  searchRow: { flexDirection: 'row', paddingHorizontal: 14, paddingBottom: 10, gap: 8, alignItems: 'center' },
  searchInput: {
    flex: 1, height: 46, borderRadius: 12,
    backgroundColor: '#222222', borderWidth: 1, borderColor: '#333333',
    paddingHorizontal: 12, fontSize: 16, color: '#f0f0f0',
  },
  sheetBarcodeBtn: {
    height: 46, paddingHorizontal: 14, borderRadius: 12,
    backgroundColor: '#222222', borderWidth: 1, borderColor: '#333333',
    alignItems: 'center', justifyContent: 'center',
  },
  sheetBarcodeBtnText: { fontSize: 13, fontWeight: '700', color: ACCENT },

  barcodePreview: { height: 220, marginHorizontal: 14, marginBottom: 10, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' },
  barcodeLoader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  barcodeLoaderText: { color: '#fff', fontSize: 13 },
  sheetTorchBtn: {
    position: 'absolute', bottom: 10, right: 10, zIndex: 10,
    backgroundColor: '#222222', borderRadius: 12, padding: 12,
  },
  sheetTorchIcon:   { fontSize: 18, color: '#666666' },
  sheetTorchIconOn: { color: ACCENT },
  cancelBarcodeBtn: {
    position: 'absolute', bottom: 10, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20,
  },
  cancelBarcodeBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  resultsList: { flex: 1, paddingHorizontal: 14 },
  resultItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#1e1e1e', gap: 10,
  },
  resultLeft: { flex: 1, minWidth: 0 },
  resultName: { fontSize: 14, fontWeight: '600', color: '#f0f0f0', marginBottom: 2 },
  resultKcal: { fontSize: 11, color: '#555' },
  resultAdd:  { fontSize: 22, color: ACCENT, fontWeight: '700', paddingHorizontal: 4 },

  noResults: { alignItems: 'center', paddingVertical: 28, gap: 12 },
  noResultsText: { color: '#555', fontSize: 14 },
  manualFallbackBtn: {
    paddingHorizontal: 18, paddingVertical: 9, borderRadius: 10,
    borderWidth: 0.5, borderColor: '#333',
  },
  manualFallbackText: { color: '#aaa', fontSize: 13, fontWeight: '600' },

  searchHint: { color: '#444', fontSize: 13, textAlign: 'center', paddingVertical: 28, paddingHorizontal: 20 },

  // Manual form inside sheet
  manualFormLabel: { fontSize: 10, fontWeight: '700', color: '#444', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, marginTop: 4 },
  manualInput: {
    backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 0.5, borderColor: '#2a2a2a',
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#fff', marginBottom: 8,
  },
  manualAmountRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  unitChips:       { flexDirection: 'row', gap: 5 },
  unitChip:        { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1a1a1a', borderWidth: 0.5, borderColor: '#2a2a2a' },
  unitChipActive:  { backgroundColor: `${ACCENT}20`, borderColor: `${ACCENT}50` },
  unitChipText:    { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.4)' },
  unitChipTextActive: { color: ACCENT },
  manualBtnRow:    { flexDirection: 'row', gap: 8, marginTop: 4 },
  manualBack:      { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center', backgroundColor: '#1a1a1a', borderWidth: 0.5, borderColor: '#2a2a2a' },
  manualBackText:  { fontSize: 13, fontWeight: '600', color: '#666' },
  manualConfirm:   { flex: 2, paddingVertical: 11, borderRadius: 10, alignItems: 'center', backgroundColor: ACCENT },
  manualConfirmText: { fontSize: 13, fontWeight: '700', color: '#000' },
});
