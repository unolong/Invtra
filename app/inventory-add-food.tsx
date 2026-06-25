import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type InventoryLocation, useInventory } from '@/context/inventory-context';
import ItemDetailSheet from '@/components/ui/ItemDetailSheet';
import { fetchProductByBarcode, type Product, searchProducts } from '@/services/open-food-facts';

const ACCENT = '#c8ff00';
const LOCATIONS: InventoryLocation[] = ['Kühlschrank', 'Vorrat', 'Tiefkühler'];
const EXPIRY_CHIPS = [
  { label: '1T',  days: 1  },
  { label: '3T',  days: 3  },
  { label: '7T',  days: 7  },
  { label: '14T', days: 14 },
  { label: '1M',  days: 30 },
] as const;

type Tab = 'browse' | 'scan';

function makeExpiresAt(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export default function InventoryAddFoodScreen() {
  const { addItems } = useInventory();
  const [tab, setTab] = useState<Tab>('browse');
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);

  const [sheetProduct, setSheetProduct] = useState<Product | null>(null);

  const [qty, setQty] = useState('100g');
  const [location, setLocation] = useState<InventoryLocation>('Kühlschrank');
  const [expiryDays, setExpiryDays] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (product) {
      setQty(product.isDrink && product.packageMl ? `${product.packageMl} ml` : '100g');
      setExpiryDays(null);
    }
  }, [product]);

  const handleBarcode = useCallback(async ({ data }: { data: string }) => {
    if (scanned || loading) return;
    setScanned(true);
    setLoading(true);
    const found = await fetchProductByBarcode(data);
    setLoading(false);
    if (found) {
      setProduct(found);
      setTab('browse');
    } else {
      Alert.alert('Nicht gefunden', 'Dieses Produkt ist nicht in der Datenbank.', [
        { text: 'OK', onPress: () => setScanned(false) },
      ]);
    }
  }, [scanned, loading]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    Keyboard.dismiss();
    setSearching(true);
    const results = await searchProducts(searchQuery.trim());
    setSearchResults(results);
    setSearching(false);
  }, [searchQuery]);

  const handleAdd = async () => {
    if (!product || saving) return;
    setSaving(true);
    try {
      await addItems([{
        name: product.name,
        qty: qty.trim() || '100g',
        cat: 'sonstiges',
        location,
        expiresAt: expiryDays ? makeExpiresAt(expiryDays) : null,
      }]);
      router.back();
    } catch {
      Alert.alert('Fehler', 'Artikel konnte nicht gespeichert werden.');
      setSaving(false);
    }
  };

  // ─── Product form ──────────────────────────────────────────────
  if (product) {
    return (
      <SafeAreaView style={st.safe} edges={['bottom']}>
        <View style={st.header}>
          <TouchableOpacity onPress={() => { setProduct(null); setScanned(false); }} hitSlop={12}>
            <Text style={st.cancelLink}>← Zurück</Text>
          </TouchableOpacity>
          <Text style={st.headerTitle}>Zum Inventar</Text>
          <View style={{ width: 80 }} />
        </View>

        <ScrollView
          contentContainerStyle={st.formScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Product header */}
          <View style={st.productHero}>
            <View style={st.productGlyph}>
              <Text style={st.productGlyphText}>{product.name[0].toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.productName} numberOfLines={2}>{product.name}</Text>
              {product.brand ? <Text style={st.productBrand}>{product.brand}</Text> : null}
            </View>
          </View>

          {/* Menge */}
          <View style={st.field}>
            <Text style={st.fieldLabel}>MENGE</Text>
            <TextInput
              style={st.fieldInput}
              value={qty}
              onChangeText={setQty}
              placeholder="z.B. 500g · 1 Packung · 2 Stk."
              placeholderTextColor="rgba(255,255,255,0.2)"
              returnKeyType="done"
            />
          </View>

          {/* Standort */}
          <View style={st.field}>
            <Text style={st.fieldLabel}>STANDORT</Text>
            <View style={st.chipRow}>
              {LOCATIONS.map(loc => (
                <TouchableOpacity
                  key={loc}
                  style={[st.chip, location === loc && st.chipActive]}
                  onPress={() => setLocation(loc)}
                  activeOpacity={0.75}
                >
                  <Text style={[st.chipText, location === loc && st.chipTextActive]}>{loc}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Haltbarkeit */}
          <View style={st.field}>
            <Text style={st.fieldLabel}>HALTBARKEIT</Text>
            <View style={st.chipRow}>
              {EXPIRY_CHIPS.map(c => (
                <TouchableOpacity
                  key={c.label}
                  style={[st.chip, expiryDays === c.days && st.chipAccent]}
                  onPress={() => setExpiryDays(expiryDays === c.days ? null : c.days)}
                  activeOpacity={0.75}
                >
                  <Text style={[st.chipText, expiryDays === c.days && st.chipTextBlack]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity
            style={[st.ctaBtn, saving && { opacity: 0.6 }]}
            onPress={handleAdd}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Text style={st.ctaBtnText}>
              {saving ? 'Wird hinzugefügt…' : 'Zum Inventar hinzufügen'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── Barcode scanner ───────────────────────────────────────────
  if (tab === 'scan') {
    if (!permission?.granted) {
      return (
        <SafeAreaView style={[st.safe, { alignItems: 'center', justifyContent: 'center', gap: 16 }]}>
          <Text style={st.emptyText}>Kamera-Zugriff erforderlich.</Text>
          <TouchableOpacity style={st.ctaBtn} onPress={requestPermission}>
            <Text style={st.ctaBtnText}>Zugriff erlauben</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setTab('browse')}>
            <Text style={st.cancelLink}>Abbrechen</Text>
          </TouchableOpacity>
        </SafeAreaView>
      );
    }
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'] }}
          onBarcodeScanned={handleBarcode}
        />
        <View style={st.scanOverlay}>
          <View style={st.scanFrame} />
          <Text style={st.scanHint}>Barcode in den Rahmen halten</Text>
          <TouchableOpacity style={st.scanCancelBtn} onPress={() => setTab('browse')}>
            <Text style={st.scanCancelText}>Abbrechen</Text>
          </TouchableOpacity>
        </View>
        {loading && (
          <View style={st.scanLoadingOverlay}>
            <ActivityIndicator size="large" color={ACCENT} />
            <Text style={st.scanHint}>Produkt wird gesucht…</Text>
          </View>
        )}
      </View>
    );
  }

  // ─── Browse / search ───────────────────────────────────────────
  return (
    <SafeAreaView style={st.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        <View style={st.header}>
          <View style={{ width: 40 }} />
          <Text style={st.headerTitle}>Zum Inventar</Text>
          <TouchableOpacity onPress={() => router.back()} style={st.closeBtn} hitSlop={8}>
            <Text style={st.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={st.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Scan grid */}
          <View style={st.scanGrid}>
            <TouchableOpacity
              style={st.fotoCard}
              onPress={() => router.push({ pathname: '/camera', params: { mode: 'inventory' } })}
              activeOpacity={0.85}
            >
              <View style={st.fotoIconBox}>
                <Text style={{ fontSize: 24 }}>📸</Text>
              </View>
              <Text style={st.fotoTitle}>KI-Scan</Text>
              <Text style={st.fotoSub}>Foto aufnehmen</Text>
            </TouchableOpacity>

            <View style={st.rightCol}>
              <TouchableOpacity style={st.smallCard} onPress={() => setTab('scan')} activeOpacity={0.8}>
                <Text style={{ fontSize: 20 }}>▣</Text>
                <Text style={st.smallCardLabel}>Barcode</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.smallCard} onPress={() => Alert.alert('Spracheingabe', 'Kommt bald!')} activeOpacity={0.8}>
                <Text style={{ fontSize: 20 }}>🎙</Text>
                <Text style={st.smallCardLabel}>Sprache</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Search */}
          <View style={st.searchRow}>
            <Text style={{ fontSize: 16 }}>🔍</Text>
            <TextInput
              style={st.searchInput}
              placeholder="Produkt suchen..."
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={searchQuery}
              onChangeText={t => { setSearchQuery(t); if (!t) setSearchResults([]); }}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={handleSearch} style={st.goBtn}>
                <Text style={st.goBtnText}>Go</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Results */}
          {searching ? (
            <View style={st.centered}>
              <ActivityIndicator color={ACCENT} />
            </View>
          ) : searchResults.length > 0 ? (
            <View>
              <Text style={st.sectionLabel}>{searchResults.length} Ergebnisse</Text>
              {searchResults.map((item, i) => (
                <TouchableOpacity
                  key={item.barcode}
                  style={[st.resultRow, i < searchResults.length - 1 && st.resultBorder]}
                  onPress={() => setSheetProduct(item)}
                >
                  <View style={st.resultGlyph}>
                    <Text style={st.resultGlyphText}>{item.name[0].toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={st.resultName} numberOfLines={1}>{item.name}</Text>
                    <Text style={st.resultSub} numberOfLines={1}>
                      {item.brand ? `${item.brand} · ` : ''}{Math.round(item.caloriesPer100g)} kcal/100g
                    </Text>
                  </View>
                  <Text style={st.resultChevron}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : searchQuery.length > 0 ? (
            <Text style={st.emptyText}>Keine Ergebnisse für „{searchQuery}"</Text>
          ) : null}

        </ScrollView>
      </KeyboardAvoidingView>

      <ItemDetailSheet
        visible={sheetProduct !== null}
        productName={sheetProduct?.name ?? ''}
        macros={sheetProduct ? {
          kcal: sheetProduct.caloriesPer100g,
          protein: sheetProduct.proteinPer100g,
          carbs: sheetProduct.carbsPer100g,
          fat: sheetProduct.fatPer100g,
        } : undefined}
        initialQty={
          sheetProduct?.isDrink && sheetProduct.packageMl
            ? `${sheetProduct.packageMl} ml`
            : sheetProduct?.productType === 'piece'
            ? '1 Stück'
            : '100 g'
        }
        onClose={() => setSheetProduct(null)}
        onAdd={async ({ qty, location, expiresAt }) => {
          if (!sheetProduct) return;
          await addItems([{
            name: sheetProduct.name,
            qty,
            cat: 'sonstiges',
            location,
            expiresAt,
          }]);
          setSheetProduct(null);
          router.back();
        }}
      />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },

  // Header
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
    width: 32, height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: '700' },
  cancelLink: { fontSize: 15, color: ACCENT, fontWeight: '600' },

  scroll: { padding: 16, paddingBottom: 40, gap: 16 },
  formScroll: { padding: 20, paddingBottom: 40, gap: 20 },

  // Scan grid
  scanGrid: { flexDirection: 'row', gap: 10, height: 158 },
  fotoCard: {
    flex: 1.3, backgroundColor: ACCENT, borderRadius: 18,
    padding: 16, justifyContent: 'flex-end', gap: 3,
  },
  fotoIconBox: {
    position: 'absolute', top: 14, left: 14,
    width: 46, height: 46, borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  fotoTitle: { fontSize: 20, fontWeight: '800', color: '#000', letterSpacing: -0.5 },
  fotoSub: { fontSize: 11, fontWeight: '500', color: 'rgba(0,0,0,0.5)' },
  rightCol: { flex: 1, gap: 10 },
  smallCard: {
    flex: 1, backgroundColor: '#111111', borderRadius: 16,
    borderWidth: 0.5, borderColor: '#222222',
    alignItems: 'center', justifyContent: 'center', gap: 5,
  },
  smallCardLabel: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.6)' },

  // Search
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 13,
    backgroundColor: '#111111', borderWidth: 0.5,
    borderColor: '#222222', borderRadius: 14,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#fff' },
  goBtn: {
    backgroundColor: ACCENT, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  goBtnText: { fontSize: 13, fontWeight: '700', color: '#000' },

  // Results
  sectionLabel: {
    fontSize: 10, fontWeight: '700',
    color: 'rgba(255,255,255,0.35)', letterSpacing: 1,
    textTransform: 'uppercase', marginBottom: 6,
  },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 2,
  },
  resultBorder: { borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  resultGlyph: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: `${ACCENT}18`, borderWidth: 0.5, borderColor: `${ACCENT}30`,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  resultGlyphText: { fontSize: 15, fontWeight: '700', color: ACCENT },
  resultName: { fontSize: 14, fontWeight: '600', color: '#fff', letterSpacing: -0.1 },
  resultSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  resultChevron: { fontSize: 20, color: 'rgba(255,255,255,0.25)' },
  centered: { alignItems: 'center', paddingVertical: 24 },
  emptyText: {
    textAlign: 'center', color: 'rgba(255,255,255,0.35)',
    fontSize: 14, paddingVertical: 24,
  },

  // Product form
  productHero: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#181818', borderRadius: 16,
    borderWidth: 0.5, borderColor: '#222222', padding: 16,
  },
  productGlyph: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: `${ACCENT}1a`, borderWidth: 0.5, borderColor: `${ACCENT}35`,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  productGlyphText: { fontSize: 24, fontWeight: '800', color: ACCENT, letterSpacing: -0.5 },
  productName: { fontSize: 18, fontWeight: '700', color: '#fff', letterSpacing: -0.4 },
  productBrand: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 3 },

  field: { gap: 10 },
  fieldLabel: {
    fontSize: 10, fontWeight: '700',
    color: 'rgba(255,255,255,0.35)', letterSpacing: 1, textTransform: 'uppercase',
  },
  fieldInput: {
    backgroundColor: '#111111', borderRadius: 14, borderWidth: 0.5,
    borderColor: '#222222', paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: '#fff', fontWeight: '500',
  },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: 99, backgroundColor: '#111111',
    borderWidth: 0.5, borderColor: '#222222',
  },
  chipActive: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.2)' },
  chipAccent: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.55)' },
  chipTextActive: { color: '#fff' },
  chipTextBlack: { color: '#000' },

  ctaBtn: { backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  ctaBtnText: { color: '#000', fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },

  // Scanner
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  scanFrame: { width: 240, height: 160, borderWidth: 1.5, borderColor: ACCENT, borderRadius: 16 },
  scanHint: {
    color: '#fff', fontSize: 14, fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6,
  },
  scanCancelBtn: {
    marginTop: 16, backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20, paddingHorizontal: 24, paddingVertical: 10,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)',
  },
  scanCancelText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  scanLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center', gap: 16,
  },
});
