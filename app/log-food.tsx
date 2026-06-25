import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import InventoryDeductModal from '@/components/ui/InventoryDeductModal';
import { useFoodLog } from '@/context/food-log-context';
import { useInventory } from '@/context/inventory-context';
import { applyInventoryDeductions, findInventoryMatches, type InventoryMatch } from '@/lib/inventoryMatching';
import { searchBls, type BlsItem } from '@/services/bls-search';
import { fetchProductByBarcode, type Product } from '@/services/open-food-facts';
import { addRecentMeal, getRecentMeals, type RecentMeal } from '@/services/recent-meals';

const ACCENT = '#c8ff00';
const MEALS = ['Frühstück', 'Mittagessen', 'Snacks', 'Abendessen'];
const GLYPH_COLORS = ['#4f8bff', '#ffb547', '#26de81', '#ff5e5e'];

type Tab = 'scan' | 'search';
type UnitLabel = 'Gramm' | 'ml' | 'Stück' | 'Portion' | 'EL' | 'TL';

const ALL_LOG_UNITS: UnitLabel[] = ['Gramm', 'ml', 'Stück', 'Portion', 'EL', 'TL'];

const UNIT_GRAMS: Record<UnitLabel, number> = {
  Gramm: 1, ml: 1, Stück: 100, Portion: 100, EL: 15, TL: 5,
};

const UNIT_STEP: Record<UnitLabel, number> = {
  Gramm: 10, ml: 10, Stück: 1, Portion: 1, EL: 1, TL: 1,
};

interface Suggestion {
  name: string;
  category: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

const SUGGESTIONS: Suggestion[] = [
  { name: 'Haferflocken',    category: 'Getreide',     kcal: 372, protein: 13.0, carbs: 56.0, fat:  7.0 },
  { name: 'Hühnerbrust',     category: 'Fleisch',      kcal: 165, protein: 31.0, carbs:  0.0, fat:  3.6 },
  { name: 'Ei (1 Stück)',    category: 'Ei',           kcal:  78, protein:  6.3, carbs:  0.6, fat:  5.0 },
  { name: 'Magerquark',      category: 'Milchprodukt', kcal:  67, protein: 12.0, carbs:  4.0, fat:  0.2 },
  { name: 'Banane',          category: 'Obst',         kcal:  89, protein:  1.1, carbs: 23.0, fat:  0.3 },
  { name: 'Lachs',           category: 'Fisch',        kcal: 208, protein: 20.0, carbs:  0.0, fat: 13.0 },
];

function detectProductType(name: string, kategorie: string): 'liquid' | 'piece' | 'solid' {
  const n = name.toLowerCase();
  const k = kategorie.toLowerCase();
  const pieceWords = ['apfel', 'banane', 'birne', 'orange', 'mandarine', 'kiwi'];
  if (k.includes('eier') || pieceWords.some(w => n.includes(w))) return 'piece';
  const liquidWords = ['milch', 'saft', 'getränk', 'wasser', 'bier', 'wein', 'kaffee', 'tee'];
  if (liquidWords.some(w => n.includes(w) || k.includes(w))) return 'liquid';
  return 'solid';
}

function defaultUnitForProduct(product: Product): UnitLabel {
  if (product.isDrink || product.productType === 'liquid') return 'ml';
  if (product.productType === 'piece') return 'Stück';
  return 'Gramm';
}

function recentMealToProduct(m: RecentMeal): Product {
  const base = m.grams > 0 ? 100 / m.grams : 1;
  return {
    barcode: '',
    name: m.name,
    brand: m.brand,
    caloriesPer100g: Math.round(m.calories * base),
    proteinPer100g: Math.round(m.protein * base * 10) / 10,
    carbsPer100g: Math.round(m.carbs * base * 10) / 10,
    fatPer100g: Math.round(m.fat * base * 10) / 10,
    sugarPer100g: 0,
    fiberPer100g: 0,
    saturatedFatPer100g: 0,
    saltPer100g: 0,
    productType: m.unit === 'ml' ? 'liquid' : 'solid',
    isDrink: m.unit === 'ml',
    packageMl: m.unit === 'ml' ? m.grams : null,
  };
}

function suggestionToProduct(s: Suggestion): Product {
  const pt = (s.category === 'Ei' || s.category === 'Obst') ? 'piece' : 'solid';
  return {
    barcode: '',
    name: s.name,
    brand: '',
    caloriesPer100g: s.kcal,
    proteinPer100g: s.protein,
    carbsPer100g: s.carbs,
    fatPer100g: s.fat,
    sugarPer100g: 0,
    fiberPer100g: 0,
    saturatedFatPer100g: 0,
    saltPer100g: 0,
    productType: pt,
    isDrink: false,
    packageMl: null,
  };
}

function blsToProduct(b: BlsItem): Product {
  const pt = detectProductType(b.name, b.kategorie);
  return {
    barcode: b.id,
    name: b.name,
    brand: 'BLS 4.0',
    caloriesPer100g: b.pro100g.kalorien,
    proteinPer100g: b.pro100g.protein,
    carbsPer100g: b.pro100g.kohlenhydrate,
    fatPer100g: b.pro100g.fett,
    sugarPer100g: b.pro100g.zucker,
    fiberPer100g: b.pro100g.ballaststoffe,
    saturatedFatPer100g: b.pro100g.gesaettigteFettsaeuren,
    saltPer100g: b.pro100g.salz,
    productType: pt,
    isDrink: pt === 'liquid',
    packageMl: null,
  };
}

export default function LogFoodScreen() {
  const { meal: mealParam } = useLocalSearchParams<{ meal?: string }>();
  const [selectedMeal, setSelectedMeal] = useState<string>(
    mealParam && MEALS.includes(mealParam) ? mealParam : MEALS[0],
  );
  const [tab, setTab] = useState<Tab>('search');
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BlsItem[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [portion, setPortion] = useState(100);
  const [portionUnit, setPortionUnit] = useState<'g' | 'ml'>('g');
  const [recentMeals, setRecentMeals] = useState<RecentMeal[]>([]);
  const [addCount, setAddCount] = useState(0);
  const [inventoryMatches, setInventoryMatches] = useState<InventoryMatch[]>([]);
  const [showDeductModal, setShowDeductModal] = useState(false);
  const { addEntry, entries } = useFoodLog();
  const { items: inventoryItems, updateItem, removeItem } = useInventory();

  const mealCounts = MEALS.reduce<Record<string, number>>((acc, m) => {
    acc[m] = entries.filter(e => e.meal === m).length;
    return acc;
  }, {});

  useEffect(() => {
    getRecentMeals().then(setRecentMeals);
  }, []);

  const selectProduct = useCallback((p: Product) => {
    setProduct(p);
    setPortion(p.isDrink && p.packageMl ? p.packageMl : 100);
    setPortionUnit(p.isDrink ? 'ml' : 'g');
  }, []);

  const handleBarcode = useCallback(
    async ({ data }: { data: string }) => {
      if (scanned || loading) return;
      setScanned(true);
      setLoading(true);
      const found = await fetchProductByBarcode(data);
      setLoading(false);
      if (found) {
        selectProduct(found);
        setTab('search');
      } else {
        Alert.alert('Nicht gefunden', 'Dieses Produkt ist nicht in der Datenbank.', [
          { text: 'OK', onPress: () => setScanned(false) },
        ]);
      }
    },
    [scanned, loading, selectProduct],
  );

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) return;
    Keyboard.dismiss();
    setSearchResults(searchBls(searchQuery.trim()));
  }, [searchQuery]);

  const finishAdd = useCallback(() => {
    setProduct(null);
    setScanned(false);
    setAddCount(c => c + 1);
    setShowDeductModal(false);
    setInventoryMatches([]);
  }, []);

  const handleDeductConfirm = useCallback(async (selected: InventoryMatch[]) => {
    await applyInventoryDeductions(selected, updateItem, removeItem);
    finishAdd();
  }, [updateItem, removeItem, finishAdd]);

  const handleDeductSkip = useCallback(() => {
    finishAdd();
  }, [finishAdd]);

  const handleAddEntry = useCallback(async () => {
    if (!product) return;
    const f = portion / 100;
    const entry = {
      meal: selectedMeal,
      name: product.name,
      brand: product.brand,
      grams: portion,
      unit: portionUnit,
      calories: Math.round(product.caloriesPer100g * f),
      protein: Math.round(product.proteinPer100g * f * 10) / 10,
      carbs: Math.round(product.carbsPer100g * f * 10) / 10,
      fat: Math.round(product.fatPer100g * f * 10) / 10,
      sugar: Math.round(product.sugarPer100g * f * 10) / 10,
      fiber: Math.round(product.fiberPer100g * f * 10) / 10,
      saturatedFat: Math.round(product.saturatedFatPer100g * f * 10) / 10,
      sodium: Math.round(product.saltPer100g * f / 2.5 * 100) / 100,
    };
    await addEntry(entry);
    await addRecentMeal(entry);

    const matches = findInventoryMatches(product.name, portion, inventoryItems);
    if (matches.length > 0) {
      setInventoryMatches(matches);
      setShowDeductModal(true);
    } else {
      finishAdd();
    }
  }, [product, portion, portionUnit, selectedMeal, addEntry, inventoryItems, finishAdd]);

  if (product) {
    return (
      <>
        <ProductDetail
          product={product}
          portion={portion}
          onPortionChange={setPortion}
          meal={selectedMeal}
          onAdd={handleAddEntry}
          onBack={() => { setProduct(null); setScanned(false); setPortionUnit('g'); }}
          onUnitChange={setPortionUnit}
        />
        <InventoryDeductModal
          visible={showDeductModal}
          meal={selectedMeal}
          matches={inventoryMatches}
          onDeduct={handleDeductConfirm}
          onSkip={handleDeductSkip}
        />
      </>
    );
  }

  if (tab === 'scan') {
    return (
      <ScannerView
        permission={permission}
        requestPermission={requestPermission}
        loading={loading}
        onBarcode={handleBarcode}
        onClose={() => setTab('search')}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        <View style={styles.header}>
          <View style={{ width: 40 }} />
          <Text style={styles.headerTitle}>Essen eintragen</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} hitSlop={8}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <MealChips
            meals={MEALS}
            selected={selectedMeal}
            onSelect={setSelectedMeal}
            counts={mealCounts}
            addCount={addCount}
          />

          <View style={styles.scanGrid}>
            <TouchableOpacity
              style={styles.fotoCard}
              onPress={() => router.push({ pathname: '/camera', params: { mode: 'food', meal: selectedMeal } })}
              activeOpacity={0.85}
            >
              <View style={styles.fotoIconBox}>
                <Text style={{ fontSize: 26 }}>📸</Text>
              </View>
              <Text style={styles.fotoTitle}>Foto</Text>
              <Text style={styles.fotoSub}>KI erkennt Gericht</Text>
            </TouchableOpacity>

            <View style={styles.rightCol}>
              <TouchableOpacity style={styles.smallCard} onPress={() => setTab('scan')} activeOpacity={0.8}>
                <Text style={{ fontSize: 20 }}>▣</Text>
                <Text style={styles.smallCardLabel}>Barcode</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.smallCard}
                onPress={() => Alert.alert('Spracheingabe', 'Kommt bald!')}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 20 }}>🎙</Text>
                <Text style={styles.smallCardLabel}>Sprache</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.searchRow}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Lebensmittel suchen..."
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={searchQuery}
              onChangeText={t => { setSearchQuery(t); if (!t) setSearchResults([]); }}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={handleSearch} style={styles.searchGoBtn}>
                <Text style={styles.searchGoBtnText}>Go</Text>
              </TouchableOpacity>
            )}
          </View>

          {searchResults.length > 0 ? (
            <View>
              <Text style={styles.sectionLabel}>{searchResults.length} Ergebnisse</Text>
              {searchResults.map((item, i) => (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.listRow, i < searchResults.length - 1 && styles.listRowBorder]}
                  onPress={() => selectProduct(blsToProduct(item))}
                >
                  <FoodGlyph name={item.name} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                      <View style={styles.deBadge}>
                        <Text style={styles.deBadgeText}>DE</Text>
                      </View>
                    </View>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {item.kategorie} · <Text style={styles.rowKcalHl}>{item.pro100g.kalorien} kcal</Text>
                      {' · '}{item.pro100g.protein.toFixed(1)}g P
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.addBtn} onPress={() => selectProduct(blsToProduct(item))} hitSlop={8}>
                    <Text style={styles.addBtnText}>+</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>
          ) : searchQuery.length > 0 ? (
            <Text style={styles.emptyText}>Keine Ergebnisse für „{searchQuery}"</Text>
          ) : null}

          {!searchQuery && recentMeals.length > 0 && (
            <View>
              <Text style={styles.sectionLabel}>ZULETZT</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.zuletzRow}
              >
                {recentMeals.slice(0, 8).map((m, i) => (
                  <ZuletzCard
                    key={`${m.name}-${i}`}
                    item={m}
                    onSelect={() => {
                      setProduct(recentMealToProduct(m));
                      setPortion(m.grams);
                    }}
                  />
                ))}
              </ScrollView>
            </View>
          )}

          {!searchQuery && (
            <View>
              <Text style={styles.sectionLabel}>VORSCHLÄGE</Text>
              {SUGGESTIONS.map((s, i) => (
                <SuggRow
                  key={s.name}
                  suggestion={s}
                  index={i}
                  isLast={i === SUGGESTIONS.length - 1}
                  onSelect={() => {
                    setProduct(suggestionToProduct(s));
                    setPortion(100);
                  }}
                />
              ))}
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Meal Chips ────────────────────────────────────────────────

function MealChips({
  meals, selected, onSelect, counts, addCount,
}: {
  meals: string[];
  selected: string;
  onSelect: (m: string) => void;
  counts: Record<string, number>;
  addCount?: number;
}) {
  const bubbleAnim = useRef(new Animated.Value(0)).current;
  const [showBubble, setShowBubble] = useState(false);
  const prevAddCount = useRef(addCount ?? 0);

  useEffect(() => {
    const cur = addCount ?? 0;
    if (cur > prevAddCount.current) {
      prevAddCount.current = cur;
      setShowBubble(true);
      bubbleAnim.setValue(0);
      Animated.timing(bubbleAnim, { toValue: 1, duration: 750, useNativeDriver: true })
        .start(() => setShowBubble(false));
    }
  }, [addCount, bubbleAnim]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipsRow}
    >
      {meals.map(m => {
        const active = m === selected;
        const count = counts[m] ?? 0;
        return (
          <View key={m}>
            <TouchableOpacity
              onPress={() => onSelect(m)}
              style={[styles.chip, active && styles.chipActive]}
              activeOpacity={0.75}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{m}</Text>
              {active && count > 0 && (
                <View style={styles.chipBadge}>
                  <Text style={styles.chipBadgeText}>{count}</Text>
                </View>
              )}
            </TouchableOpacity>
            {active && showBubble && (
              <Animated.View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 2,
                  transform: [{
                    translateY: bubbleAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -28],
                    }),
                  }],
                  opacity: bubbleAnim.interpolate({
                    inputRange: [0, 0.08, 0.7, 1],
                    outputRange: [0, 1, 1, 0],
                  }),
                }}
              >
                <Text style={styles.chipBubble}>+1</Text>
              </Animated.View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

// ─── Suggestion Glyph ─────────────────────────────────────────

function SuggGlyph({ name, index }: { name: string; index: number }) {
  const color = GLYPH_COLORS[index % GLYPH_COLORS.length];
  return (
    <View style={[styles.glyph, { backgroundColor: `${color}18`, borderColor: `${color}30` }]}>
      <Text style={[styles.glyphText, { color }]}>{name[0].toUpperCase()}</Text>
    </View>
  );
}

// ─── Scanner ──────────────────────────────────────────────────

type CameraPermission = ReturnType<typeof useCameraPermissions>[0];

function ScannerView({
  permission, requestPermission, loading, onBarcode, onClose,
}: {
  permission: CameraPermission;
  requestPermission: () => Promise<any>;
  loading: boolean;
  onBarcode: (e: { data: string }) => void;
  onClose: () => void;
}) {
  if (!permission?.granted) {
    return (
      <SafeAreaView style={[styles.safe, { alignItems: 'center', justifyContent: 'center', gap: 16 }]}>
        <Text style={[styles.emptyText, { textAlign: 'center', marginHorizontal: 32 }]}>
          Kamera-Zugriff erforderlich um Barcodes zu scannen.
        </Text>
        <TouchableOpacity style={styles.accentBtn} onPress={requestPermission}>
          <Text style={styles.accentBtnText}>Zugriff erlauben</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.cancelLink}>Abbrechen</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'] }}
        onBarcodeScanned={onBarcode}
      />
      <View style={styles.scanOverlay}>
        <View style={styles.scanFrame} />
        <Text style={styles.scanHint}>Barcode in den Rahmen halten</Text>
        <TouchableOpacity style={styles.scanCancelBtn} onPress={onClose}>
          <Text style={styles.scanCancelText}>Abbrechen</Text>
        </TouchableOpacity>
      </View>
      {loading && (
        <View style={styles.scanLoadingOverlay}>
          <ActivityIndicator size="large" color={ACCENT} />
          <Text style={styles.scanHint}>Produkt wird gesucht…</Text>
        </View>
      )}
    </View>
  );
}

// ─── Product Detail ────────────────────────────────────────────

function ProductDetail({
  product, portion, onPortionChange, meal, onAdd, onBack, onUnitChange,
}: {
  product: Product;
  portion: number;
  onPortionChange: (v: number) => void;
  meal: string;
  onAdd: () => void;
  onBack: () => void;
  onUnitChange: (u: 'g' | 'ml') => void;
}) {
  const defUnit = defaultUnitForProduct(product);
  const defQty  = Math.max(1, Math.round(portion / UNIT_GRAMS[defUnit]));

  const [qtyText, setQtyText]             = useState(String(defQty));
  const [displayUnit, setDisplayUnit]     = useState<UnitLabel>(defUnit);
  const [unitMenuVisible, setUnitMenuVisible] = useState(false);

  const onPortionRef = useRef(onPortionChange);
  onPortionRef.current = onPortionChange;
  const onUnitRef = useRef(onUnitChange);
  onUnitRef.current = onUnitChange;

  const qty          = Math.max(1, parseInt(qtyText) || 1);
  const effectiveGrams = qty * UNIT_GRAMS[displayUnit];
  const f = effectiveGrams / 100;

  useEffect(() => {
    onPortionRef.current(effectiveGrams);
  }, [effectiveGrams]);

  const kcal   = Math.round(product.caloriesPer100g * f);
  const prot   = (product.proteinPer100g        * f).toFixed(1);
  const carbs  = (product.carbsPer100g          * f).toFixed(1);
  const fat    = (product.fatPer100g            * f).toFixed(1);
  const sugar  = (product.sugarPer100g          * f).toFixed(1);
  const fiber  = (product.fiberPer100g          * f).toFixed(1);
  const satFat = (product.saturatedFatPer100g   * f).toFixed(1);
  const salt   = (product.saltPer100g           * f).toFixed(1);

  const step = UNIT_STEP[displayUnit];

  const adjustQty = (delta: number) => {
    setQtyText(t => String(Math.max(1, (parseInt(t) || 1) + delta)));
  };

  const handleUnitSelect = (u: UnitLabel) => {
    const wasWeight = displayUnit === 'Gramm' || displayUnit === 'ml';
    const isWeight  = u === 'Gramm' || u === 'ml';
    setDisplayUnit(u);
    setUnitMenuVisible(false);
    onUnitRef.current(u === 'ml' ? 'ml' : 'g');
    if (wasWeight && !isWeight) setQtyText('1');
  };

  const validateQty = () => {
    setQtyText(t => String(Math.max(1, parseInt(t) || 1)));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 36 }} showsVerticalScrollIndicator={false}>

        <View style={styles.hero}>
          <TouchableOpacity style={styles.backBtn} onPress={onBack} hitSlop={8}>
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>
          <View style={styles.heroGlyphWrap}>
            <Text style={styles.heroGlyphText}>{product.name[0].toUpperCase()}</Text>
          </View>
        </View>

        <View style={styles.pdContent}>
          <Text style={styles.pdName}>{product.name}</Text>
          <Text style={styles.pdMeta}>
            {product.brand ? `${product.brand} · ` : ''}pro 100{displayUnit === 'ml' ? 'ml' : 'g'}
          </Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.badgesRow}>
            <MacroBadge label="kcal"    value={`${kcal}`}   color={ACCENT}  />
            <MacroBadge label="Protein" value={`${prot}g`}  color="#4f8bff" />
            <MacroBadge label="Carbs"   value={`${carbs}g`} color="#ffb547" />
            <MacroBadge label="Fett"    value={`${fat}g`}   color="#ff5e5e" />
          </ScrollView>

          {/* Portion input row */}
          <View style={styles.portionRow}>
            <TouchableOpacity style={styles.portionStepBtn} onPress={() => adjustQty(-step)} activeOpacity={0.7}>
              <Text style={styles.portionStepText}>−</Text>
            </TouchableOpacity>

            <TextInput
              style={styles.portionInput}
              value={qtyText}
              onChangeText={setQtyText}
              keyboardType="number-pad"
              returnKeyType="done"
              onBlur={validateQty}
              onSubmitEditing={validateQty}
              selectTextOnFocus
            />

            <TouchableOpacity style={styles.unitBtn} onPress={() => setUnitMenuVisible(true)} activeOpacity={0.75}>
              <Text style={styles.unitBtnText}>{displayUnit}</Text>
              <Text style={styles.unitChevron}>▾</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.portionStepBtn} onPress={() => adjustQty(step)} activeOpacity={0.7}>
              <Text style={styles.portionStepText}>+</Text>
            </TouchableOpacity>
          </View>

          {/* Unit dropdown */}
          <Modal
            visible={unitMenuVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setUnitMenuVisible(false)}
          >
            <TouchableOpacity
              style={styles.unitModalOverlay}
              onPress={() => setUnitMenuVisible(false)}
              activeOpacity={1}
            >
              <TouchableOpacity style={styles.unitModalBox} activeOpacity={1}>
                <Text style={styles.unitModalTitle}>Einheit wählen</Text>
                {ALL_LOG_UNITS.map(u => (
                  <TouchableOpacity
                    key={u}
                    style={[styles.unitModalRow, displayUnit === u && styles.unitModalRowActive]}
                    onPress={() => handleUnitSelect(u)}
                  >
                    <Text style={[styles.unitModalText, displayUnit === u && styles.unitModalTextActive]}>
                      {u}
                    </Text>
                    {displayUnit === u && <Text style={styles.unitModalCheck}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>

          <View style={styles.secCard}>
            <SecRow label="Zucker"           value={`${sugar}g`}  />
            <View style={styles.secDivider} />
            <SecRow label="Ballaststoffe"     value={`${fiber}g`}  />
            <View style={styles.secDivider} />
            <SecRow label="Ges. Fettsäuren"   value={`${satFat}g`} />
            <View style={styles.secDivider} />
            <SecRow label="Salz"              value={`${salt}g`}   />
          </View>

          <TouchableOpacity style={styles.accentBtn} onPress={onAdd} activeOpacity={0.85}>
            <Text style={styles.accentBtnText}>Zu {meal} hinzufügen</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function MacroBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}1a`, borderColor: `${color}35` }]}>
      <Text style={[styles.badgeVal, { color }]}>{value}</Text>
      <Text style={[styles.badgeLbl, { color: `${color}99` }]}>{label}</Text>
    </View>
  );
}

function SecRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.secRow}>
      <Text style={styles.secLabel}>{label}</Text>
      <Text style={styles.secVal}>{value}</Text>
    </View>
  );
}

// ─── Zuletzt & Vorschläge ─────────────────────────────────────

function ZuletzCard({ item, onSelect }: { item: RecentMeal; onSelect: () => void }) {
  return (
    <TouchableOpacity style={styles.zuletzCard} onPress={onSelect} activeOpacity={0.75}>
      <Text style={styles.zuletzMeta} numberOfLines={1}>
        {item.grams}{item.unit || 'g'}{item.brand ? ` · ${item.brand}` : ''}
      </Text>
      <Text style={styles.zuletzName} numberOfLines={2}>{item.name}</Text>
      <Text style={styles.zuletzKcal}>{item.calories} kcal</Text>
    </TouchableOpacity>
  );
}

function SuggRow({
  suggestion, index, isLast, onSelect,
}: {
  suggestion: Suggestion; index: number; isLast: boolean; onSelect: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.listRow, !isLast && styles.listRowBorder]}
      onPress={onSelect}
      activeOpacity={0.75}
    >
      <SuggGlyph name={suggestion.name} index={index} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowName} numberOfLines={1}>{suggestion.name}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {suggestion.category} · pro 100g · {suggestion.kcal} kcal · {suggestion.protein}g P
        </Text>
      </View>
      <View style={styles.addBtn} pointerEvents="none">
        <Text style={styles.addBtnText}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

function FoodGlyph({ name }: { name: string }) {
  return (
    <View style={styles.glyph}>
      <Text style={styles.glyphText}>{name[0].toUpperCase()}</Text>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scroll: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: '#222222',
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '700',
  },
  cancelLink: {
    fontSize: 15,
    color: ACCENT,
    fontWeight: '600',
  },

  chipsRow: {
    gap: 8,
    paddingRight: 4,
    paddingTop: 24,
  },
  chipBubble: {
    fontSize: 13,
    fontWeight: '800',
    color: ACCENT,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 3,
    textShadowOffset: { width: 0, height: 1 },
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 99,
    backgroundColor: '#111111',
    borderWidth: 0.5,
    borderColor: '#222222',
    gap: 6,
  },
  chipActive: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
  },
  chipTextActive: {
    color: '#000',
  },
  chipBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.22)',
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#000',
  },

  scanGrid: {
    flexDirection: 'row',
    gap: 10,
    height: 158,
  },
  fotoCard: {
    flex: 1.3,
    backgroundColor: ACCENT,
    borderRadius: 18,
    padding: 16,
    justifyContent: 'flex-end',
    gap: 3,
  },
  fotoIconBox: {
    position: 'absolute',
    top: 14,
    left: 14,
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fotoTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#000',
    letterSpacing: -0.5,
  },
  fotoSub: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(0,0,0,0.5)',
  },
  rightCol: {
    flex: 1,
    gap: 10,
  },
  smallCard: {
    flex: 1,
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: '#222222',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  smallCardLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
  },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: '#111111',
    borderWidth: 0.5,
    borderColor: '#222222',
    borderRadius: 14,
  },
  searchIcon: { fontSize: 16 },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#fff',
  },
  searchGoBtn: {
    backgroundColor: ACCENT,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  searchGoBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000',
  },

  deBadge: {
    backgroundColor: 'rgba(200,255,0,0.12)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderWidth: 0.5,
    borderColor: 'rgba(200,255,0,0.3)',
    flexShrink: 0,
  },
  deBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: ACCENT,
    letterSpacing: 0.5,
  },

  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
    paddingHorizontal: 2,
  },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 2,
  },
  listRowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#1a1a1a',
  },
  rowName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.1,
  },
  rowSub: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },
  rowKcalHl: {
    color: 'rgba(255,255,255,0.65)',
    fontWeight: '600',
  },

  addBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  addBtnText: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.55)',
    fontWeight: '300',
    lineHeight: 22,
  },

  zuletzRow: {
    gap: 10,
    paddingRight: 4,
  },
  zuletzCard: {
    width: 128,
    backgroundColor: '#111111',
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: '#222222',
    padding: 12,
    gap: 4,
  },
  zuletzMeta: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.35)',
    fontWeight: '500',
  },
  zuletzName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.2,
    lineHeight: 17,
    flex: 1,
  },
  zuletzKcal: {
    fontSize: 12,
    fontWeight: '700',
    color: ACCENT,
    marginTop: 2,
  },

  glyph: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: `${ACCENT}18`,
    borderWidth: 0.5,
    borderColor: `${ACCENT}30`,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  glyphText: {
    fontSize: 15,
    fontWeight: '700',
    color: ACCENT,
  },

  centered: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.35)',
    fontSize: 14,
    paddingVertical: 24,
  },

  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  scanFrame: {
    width: 240,
    height: 160,
    borderWidth: 1.5,
    borderColor: ACCENT,
    borderRadius: 16,
  },
  scanHint: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  scanCancelBtn: {
    marginTop: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  scanCancelText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  scanLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },

  hero: {
    height: 192,
    backgroundColor: '#181818',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtn: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  backBtnText: {
    fontSize: 17,
    color: '#fff',
    fontWeight: '600',
  },
  heroGlyphWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: `${ACCENT}1a`,
    borderWidth: 1,
    borderColor: `${ACCENT}35`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroGlyphText: {
    fontSize: 36,
    fontWeight: '800',
    color: ACCENT,
    letterSpacing: -1,
  },
  pdContent: {
    padding: 20,
    gap: 16,
  },
  pdName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.6,
    lineHeight: 29,
  },
  pdMeta: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    marginTop: -10,
  },

  badgesRow: {
    gap: 8,
    paddingRight: 4,
  },
  badge: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 0.5,
    alignItems: 'center',
    minWidth: 72,
    gap: 2,
  },
  badgeVal: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  badgeLbl: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },

  // Portion input row
  portionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#181818',
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: '#222222',
    padding: 12,
  },
  portionStepBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#222222',
    alignItems: 'center',
    justifyContent: 'center',
  },
  portionStepText: {
    fontSize: 24,
    color: '#fff',
    fontWeight: '300',
    lineHeight: 28,
  },
  portionInput: {
    flex: 1,
    fontSize: 30,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: -1,
    paddingVertical: 2,
  },
  unitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#222222',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
    borderWidth: 0.5,
    borderColor: '#333333',
  },
  unitBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.2,
  },
  unitChevron: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.4)',
  },

  // Unit modal
  unitModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitModalBox: {
    backgroundColor: '#181818',
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    paddingVertical: 8,
    width: 220,
    overflow: 'hidden',
  },
  unitModalTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.3)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    textAlign: 'center',
    paddingVertical: 10,
  },
  unitModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  unitModalRowActive: {
    backgroundColor: `${ACCENT}12`,
  },
  unitModalText: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.8)',
  },
  unitModalTextActive: {
    color: ACCENT,
  },
  unitModalCheck: {
    fontSize: 14,
    color: ACCENT,
    fontWeight: '800',
  },

  secCard: {
    backgroundColor: '#181818',
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: '#222222',
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  secRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  secLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
  },
  secVal: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.75)',
  },
  secDivider: {
    height: 0.5,
    backgroundColor: '#222222',
  },
  accentBtn: {
    backgroundColor: ACCENT,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  accentBtnText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
});
