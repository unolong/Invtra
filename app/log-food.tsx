import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useFoodLog } from '@/context/food-log-context';
import { fetchProductByBarcode, type Product, searchProducts } from '@/services/open-food-facts';

type Tab = 'scan' | 'search';

export default function LogFoodScreen() {
  const [tab, setTab] = useState<Tab>('scan');
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [grams, setGrams] = useState('100');
  const { addEntry } = useFoodLog();

  const handleBarcode = useCallback(
    async ({ data }: { data: string }) => {
      if (scanned || loading) return;
      setScanned(true);
      setLoading(true);
      const found = await fetchProductByBarcode(data);
      setLoading(false);
      if (found) {
        setProduct(found);
      } else {
        Alert.alert('Nicht gefunden', 'Dieses Produkt ist nicht in der Datenbank.', [
          { text: 'OK', onPress: () => setScanned(false) },
        ]);
      }
    },
    [scanned, loading],
  );

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    Keyboard.dismiss();
    setSearching(true);
    const results = await searchProducts(searchQuery.trim());
    setSearchResults(results);
    setSearching(false);
  }, [searchQuery]);

  const handleAddEntry = useCallback(async () => {
    if (!product) return;
    const g = parseFloat(grams) || 100;
    const f = g / 100;
    await addEntry({
      name: product.name,
      brand: product.brand,
      grams: g,
      calories: Math.round(product.caloriesPer100g * f),
      protein: Math.round(product.proteinPer100g * f * 10) / 10,
      carbs: Math.round(product.carbsPer100g * f * 10) / 10,
      fat: Math.round(product.fatPer100g * f * 10) / 10,
    });
    router.back();
  }, [product, grams, addEntry]);

  const resetProduct = useCallback(() => {
    setProduct(null);
    setScanned(false);
  }, []);

  if (product) {
    return <ProductDetail product={product} grams={grams} onGramsChange={setGrams} onAdd={handleAddEntry} onBack={resetProduct} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancelBtn}>Abbrechen</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Essen eintragen</Text>
        <View style={{ width: 80 }} />
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity style={[styles.tabItem, tab === 'scan' && styles.tabItemActive]} onPress={() => setTab('scan')}>
          <Text style={[styles.tabLabel, tab === 'scan' && styles.tabLabelActive]}>Scannen</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabItem, tab === 'search' && styles.tabItemActive]} onPress={() => setTab('search')}>
          <Text style={[styles.tabLabel, tab === 'search' && styles.tabLabelActive]}>Suchen</Text>
        </TouchableOpacity>
      </View>

      {tab === 'scan' ? (
        <ScannerTab permission={permission} requestPermission={requestPermission} loading={loading} onBarcode={handleBarcode} />
      ) : (
        <SearchTab
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onSearch={handleSearch}
          results={searchResults}
          searching={searching}
          onSelect={setProduct}
        />
      )}
    </View>
  );
}

// ── Scanner Tab ───────────────────────────────────────────────────────────────

type CameraPermission = ReturnType<typeof useCameraPermissions>[0];

function ScannerTab({
  permission,
  requestPermission,
  loading,
  onBarcode,
}: {
  permission: CameraPermission;
  requestPermission: () => Promise<any>;
  loading: boolean;
  onBarcode: (e: { data: string }) => void;
}) {
  if (!permission) {
    return <View style={styles.centered}><ActivityIndicator /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.permissionText}>Kamera-Zugriff erforderlich um Barcodes zu scannen.</Text>
        <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={styles.permissionBtnText}>Zugriff erlauben</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'] }}
        onBarcodeScanned={onBarcode}
      />
      <View style={styles.scanOverlay}>
        <View style={styles.scanFrame} />
        <Text style={styles.scanHint}>Barcode in den Rahmen halten</Text>
      </View>
      {loading && (
        <View style={styles.scanLoading}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.scanLoadingText}>Produkt wird gesucht…</Text>
        </View>
      )}
    </View>
  );
}

// ── Search Tab ────────────────────────────────────────────────────────────────

function SearchTab({
  query,
  onQueryChange,
  onSearch,
  results,
  searching,
  onSelect,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  onSearch: () => void;
  results: Product[];
  searching: boolean;
  onSelect: (p: Product) => void;
}) {
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Produkt suchen…"
          placeholderTextColor="#999"
          value={query}
          onChangeText={onQueryChange}
          onSubmitEditing={onSearch}
          returnKeyType="search"
          autoFocus
        />
        <TouchableOpacity style={styles.searchBtn} onPress={onSearch}>
          <Text style={styles.searchBtnText}>Suchen</Text>
        </TouchableOpacity>
      </View>

      {searching ? (
        <View style={styles.centered}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={item => item.barcode}
          contentContainerStyle={{ padding: 16 }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#eee' }} />}
          renderItem={({ item }) => (
            <Pressable style={styles.resultItem} onPress={() => onSelect(item)}>
              <Text style={styles.resultName}>{item.name}</Text>
              {item.brand ? <Text style={styles.resultBrand}>{item.brand}</Text> : null}
              <Text style={styles.resultMacros}>
                {Math.round(item.caloriesPer100g)} kcal · {item.proteinPer100g.toFixed(1)}g P · {item.carbsPer100g.toFixed(1)}g K · {item.fatPer100g.toFixed(1)}g F
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            results.length === 0 && query ? (
              <Text style={styles.emptyText}>Keine Ergebnisse gefunden.</Text>
            ) : null
          }
        />
      )}
    </KeyboardAvoidingView>
  );
}

// ── Product Detail ────────────────────────────────────────────────────────────

function ProductDetail({
  product,
  grams,
  onGramsChange,
  onAdd,
  onBack,
}: {
  product: Product;
  grams: string;
  onGramsChange: (v: string) => void;
  onAdd: () => void;
  onBack: () => void;
}) {
  const g = parseFloat(grams) || 100;
  const f = g / 100;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={12}>
          <Text style={styles.cancelBtn}>← Zurück</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Produkt</Text>
        <View style={{ width: 80 }} />
      </View>

      <View style={styles.productCard}>
        <Text style={styles.productName}>{product.name}</Text>
        {product.brand ? <Text style={styles.productBrand}>{product.brand}</Text> : null}

        <View style={styles.portionRow}>
          <Text style={styles.portionLabel}>Portion</Text>
          <View style={styles.portionInputRow}>
            <TextInput
              style={styles.portionInput}
              value={grams}
              onChangeText={onGramsChange}
              keyboardType="numeric"
              selectTextOnFocus
            />
            <Text style={styles.portionUnit}>g</Text>
          </View>
        </View>

        <View style={styles.macroGrid}>
          <MacroBox label="Kalorien" value={`${Math.round(product.caloriesPer100g * f)}`} unit="kcal" color="#333" />
          <MacroBox label="Protein" value={(product.proteinPer100g * f).toFixed(1)} unit="g" color="#4F8EF7" />
          <MacroBox label="Kohlenhydrate" value={(product.carbsPer100g * f).toFixed(1)} unit="g" color="#F7A94F" />
          <MacroBox label="Fett" value={(product.fatPer100g * f).toFixed(1)} unit="g" color="#F74F4F" />
        </View>

        <Text style={styles.per100Label}>Angaben pro 100g: {Math.round(product.caloriesPer100g)} kcal · {product.proteinPer100g.toFixed(1)}g P · {product.carbsPer100g.toFixed(1)}g K · {product.fatPer100g.toFixed(1)}g F</Text>

        <TouchableOpacity style={styles.addBtn} onPress={onAdd}>
          <Text style={styles.addBtnText}>Hinzufügen</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function MacroBox({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <View style={styles.macroBox}>
      <Text style={[styles.macroValue, { color }]}>{value}</Text>
      <Text style={styles.macroUnit}>{unit}</Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111',
  },
  cancelBtn: {
    fontSize: 16,
    color: '#4F8EF7',
    width: 80,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tabItem: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: '#4F8EF7',
  },
  tabLabel: {
    fontSize: 15,
    color: '#999',
  },
  tabLabelActive: {
    color: '#4F8EF7',
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  // Scanner
  cameraContainer: {
    flex: 1,
    position: 'relative',
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanFrame: {
    width: 240,
    height: 160,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 12,
  },
  scanHint: {
    marginTop: 16,
    color: '#fff',
    fontSize: 14,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  scanLoading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  scanLoadingText: {
    color: '#fff',
    fontSize: 15,
  },
  permissionText: {
    fontSize: 15,
    color: '#555',
    textAlign: 'center',
    marginHorizontal: 32,
  },
  permissionBtn: {
    backgroundColor: '#4F8EF7',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  permissionBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Search
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: '#111',
  },
  searchBtn: {
    backgroundColor: '#4F8EF7',
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  searchBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  resultItem: {
    paddingVertical: 12,
    gap: 2,
  },
  resultName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
  },
  resultBrand: {
    fontSize: 13,
    color: '#888',
  },
  resultMacros: {
    fontSize: 12,
    color: '#aaa',
    marginTop: 2,
  },
  emptyText: {
    textAlign: 'center',
    color: '#aaa',
    marginTop: 32,
    fontSize: 15,
  },
  // Product Detail
  productCard: {
    margin: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    gap: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  productName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
  },
  productBrand: {
    fontSize: 14,
    color: '#888',
    marginTop: -10,
  },
  portionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  portionLabel: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  portionInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  portionInput: {
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 18,
    fontWeight: '600',
    color: '#111',
    minWidth: 80,
    textAlign: 'center',
  },
  portionUnit: {
    fontSize: 16,
    color: '#555',
  },
  macroGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  macroBox: {
    flex: 1,
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 2,
  },
  macroValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  macroUnit: {
    fontSize: 12,
    color: '#aaa',
    marginTop: -2,
  },
  macroLabel: {
    fontSize: 10,
    color: '#999',
    textAlign: 'center',
  },
  per100Label: {
    fontSize: 12,
    color: '#bbb',
    textAlign: 'center',
  },
  addBtn: {
    backgroundColor: '#4F8EF7',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  addBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
});
