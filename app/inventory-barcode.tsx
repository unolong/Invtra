import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ItemDetailSheet from '@/components/ui/ItemDetailSheet';
import { type InventoryLocation, useInventory } from '@/context/inventory-context';
import { fetchProductByBarcode, type Product } from '@/services/open-food-facts';

const ACCENT = '#c8ff00';

export default function InventoryBarcodeScreen() {
  const { addItems } = useInventory();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [torch, setTorch] = useState(false);

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
        Alert.alert(
          'Nicht gefunden',
          'Dieses Produkt ist nicht in der Datenbank.\nMöchtest du es manuell hinzufügen?',
          [
            { text: 'Abbrechen', onPress: () => setScanned(false) },
            { text: 'Manuell', onPress: () => router.replace('/add-inventory-item' as any) },
          ],
        );
      }
    },
    [scanned, loading],
  );

  if (!permission) return <View style={s.fill} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={[s.fill, s.center]}>
        <Text style={s.permText}>Kamera-Zugriff erforderlich</Text>
        <TouchableOpacity style={s.accentBtn} onPress={requestPermission}>
          <Text style={s.accentBtnText}>Zugriff erlauben</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 4 }}>
          <Text style={s.cancelLink}>Abbrechen</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <View style={s.fill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{
          barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarcode}
        enableTorch={torch}
      />

      <SafeAreaView style={s.topBar} edges={['top']}>
        <TouchableOpacity style={s.closeBtn} onPress={() => router.back()} hitSlop={8}>
          <Text style={s.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <View style={s.badge}>
          <Text style={s.badgeText}>Inventar · Barcode</Text>
        </View>
        <View style={{ width: 44 }} />
      </SafeAreaView>

      <TouchableOpacity
        style={s.torchBtn}
        onPress={() => setTorch(t => !t)}
        activeOpacity={0.75}
        hitSlop={8}
      >
        <Text style={[s.torchIcon, torch && s.torchIconOn]}>⚡</Text>
      </TouchableOpacity>

      <View style={s.scanOverlay} pointerEvents="none">
        <View style={s.scanFrame} />
        <Text style={s.scanHint}>Barcode in den Rahmen halten</Text>
      </View>

      {loading && (
        <View style={s.loadingOverlay}>
          <ActivityIndicator size="large" color={ACCENT} />
          <Text style={s.loadingText}>Produkt wird gesucht…</Text>
        </View>
      )}

      {/* Detail sheet slides up after successful scan */}
      <ItemDetailSheet
        visible={product !== null}
        productName={product ? (product.brand ? `${product.name} (${product.brand})` : product.name) : ''}
        macros={product ? {
          kcal: product.caloriesPer100g,
          protein: product.proteinPer100g,
          carbs: product.carbsPer100g,
          fat: product.fatPer100g,
        } : undefined}
        initialQty={product?.isDrink && product.packageMl ? `${product.packageMl} ml` : '100g'}
        onClose={() => { setProduct(null); setScanned(false); }}
        onAdd={async ({ qty, location, expiresAt }) => {
          if (!product) return;
          await addItems([{
            name: product.brand ? `${product.name} (${product.brand})` : product.name,
            qty,
            cat: 'sonstiges',
            location,
            expiresAt,
          }]);
          router.back();
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: {
    backgroundColor: '#0a0a0a',
    alignItems: 'center', justifyContent: 'center',
    padding: 32, gap: 12,
  },
  permText: { fontSize: 16, fontWeight: '600', color: '#fff', textAlign: 'center' },
  cancelLink: { color: 'rgba(255,255,255,0.4)', fontSize: 15 },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 8,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { fontSize: 15, color: '#fff' },
  badge: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99,
    backgroundColor: 'rgba(79,139,255,0.2)', borderWidth: 0.5, borderColor: 'rgba(79,139,255,0.4)',
  },
  badgeText: { fontSize: 13, fontWeight: '600', color: '#4f8bff' },

  scanOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  scanFrame: { width: 260, height: 150, borderWidth: 2, borderColor: ACCENT, borderRadius: 12 },
  scanHint: {
    color: '#fff', fontSize: 14, fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  loadingText: { color: '#fff', fontSize: 15, fontWeight: '500' },

  torchBtn: {
    position: 'absolute', bottom: 40, right: 24, zIndex: 10,
    backgroundColor: '#222222', borderRadius: 12, padding: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  torchIcon:    { fontSize: 20, color: '#666666' },
  torchIconOn:  { color: ACCENT },

  accentBtn: {
    backgroundColor: ACCENT, borderRadius: 14,
    paddingVertical: 16, paddingHorizontal: 28, alignItems: 'center',
  },
  accentBtnText: { color: '#000', fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
});
