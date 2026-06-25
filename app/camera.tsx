import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { capturedPhoto } from '@/lib/captured-photo';

const ACCENT = '#c8ff00';

export default function CameraScreen() {
  const { mode = 'food', meal } = useLocalSearchParams<{ mode?: string; meal?: string }>();
  const isInventory = mode === 'inventory';

  const [permission, requestPermission] = useCameraPermissions();
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [camMode, setCamMode] = useState<'dish' | 'barcode'>('dish');
  const [capturing, setCapturing] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  if (!permission) return <View style={styles.fill} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.fill, styles.center]}>
        <Text style={styles.permText}>Kamera-Zugriff erforderlich</Text>
        <TouchableOpacity style={styles.accentBtn} onPress={requestPermission}>
          <Text style={styles.accentBtnText}>Zugriff erlauben</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 4 }}>
          <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 15 }}>Abbrechen</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const handleShutter = async () => {
    if (capturing || !cameraRef.current) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.7 });
      if (photo?.base64) {
        capturedPhoto.set(photo.uri, photo.base64);
        if (isInventory) {
          router.replace('/ai-inventory');
        } else {
          router.replace({ pathname: '/ai-result', params: { meal: meal ?? 'Frühstück' } });
        }
      } else {
        setCapturing(false);
      }
    } catch {
      setCapturing(false);
    }
  };

  const handleBarcode = ({ data }: { data: string }) => {
    capturedPhoto.set('barcode:' + data, '');
    router.back();
  };

  return (
    <View style={styles.fill}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        flash={flash}
        barcodeScannerSettings={
          camMode === 'barcode'
            ? { barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] }
            : undefined
        }
        onBarcodeScanned={camMode === 'barcode' ? handleBarcode : undefined}
      />

      {/* Top overlay */}
      <SafeAreaView style={styles.topOverlay} edges={['top']}>
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.circleBtn} onPress={() => router.back()} hitSlop={8}>
            <Text style={styles.circleBtnText}>✕</Text>
          </TouchableOpacity>

          {isInventory ? (
            <View style={[styles.badge, { backgroundColor: 'rgba(79,139,255,0.2)', borderColor: 'rgba(79,139,255,0.4)' }]}>
              <Text style={[styles.badgeText, { color: '#4f8bff' }]}>Inventar-Scan</Text>
            </View>
          ) : meal ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{meal}</Text>
            </View>
          ) : <View style={{ width: 100 }} />}

          <TouchableOpacity
            style={[styles.circleBtn, flash === 'on' && styles.circleBtnActive]}
            onPress={() => setFlash(f => f === 'off' ? 'on' : 'off')}
            hitSlop={8}
          >
            <Text style={styles.circleBtnText}>⚡</Text>
          </TouchableOpacity>
        </View>

        {!isInventory && (
          <View style={styles.modeRow}>
            <View style={styles.modePill}>
              {(['dish', 'barcode'] as const).map(m => (
                <TouchableOpacity
                  key={m}
                  style={[styles.modeBtn, camMode === m && styles.modeBtnActive]}
                  onPress={() => setCamMode(m)}
                >
                  <Text style={[styles.modeBtnText, camMode === m && styles.modeBtnTextActive]}>
                    {m === 'dish' ? 'Gericht erkennen' : 'Barcode'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </SafeAreaView>

      {/* Barcode frame */}
      {camMode === 'barcode' && (
        <View style={styles.barcodeOverlay} pointerEvents="none">
          <View style={styles.barcodeFrame} />
          <Text style={styles.barcodeHint}>Barcode in den Rahmen halten</Text>
        </View>
      )}

      {/* Shutter */}
      {(camMode === 'dish' || isInventory) && (
        <View style={styles.bottomOverlay}>
          <Text style={styles.bottomHint}>
            {isInventory ? 'Kühlschrank oder Zutaten fotografieren' : 'Gericht fotografieren'}
          </Text>
          <TouchableOpacity
            style={[styles.shutter, capturing && { opacity: 0.5 }]}
            onPress={handleShutter}
            disabled={capturing}
            activeOpacity={0.85}
          >
            {capturing
              ? <ActivityIndicator color="#000" />
              : <View style={styles.shutterInner} />
            }
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: {
    backgroundColor: '#0a0a0a',
    alignItems: 'center', justifyContent: 'center',
    padding: 32, gap: 12,
  },
  permText: { fontSize: 16, fontWeight: '600', color: '#fff', textAlign: 'center' },
  accentBtn: {
    backgroundColor: ACCENT, borderRadius: 14,
    paddingHorizontal: 28, paddingVertical: 14,
    alignItems: 'center',
  },
  accentBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },

  topOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingHorizontal: 20, gap: 14,
  },
  topRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 8,
  },
  circleBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  circleBtnActive: { backgroundColor: `${ACCENT}30`, borderColor: `${ACCENT}60` },
  circleBtnText: { fontSize: 15, color: '#fff' },
  badge: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99,
    backgroundColor: `${ACCENT}20`, borderWidth: 0.5, borderColor: `${ACCENT}50`,
  },
  badgeText: { fontSize: 13, fontWeight: '600', color: ACCENT },

  modeRow: { alignItems: 'center' },
  modePill: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 22, padding: 3, gap: 2,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)',
  },
  modeBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 19 },
  modeBtnActive: { backgroundColor: '#fff' },
  modeBtnText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.6)' },
  modeBtnTextActive: { color: '#000' },

  barcodeOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  barcodeFrame: {
    width: 260, height: 150,
    borderWidth: 2, borderColor: ACCENT, borderRadius: 12,
  },
  barcodeHint: {
    color: '#fff', fontSize: 14, fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8,
  },

  bottomOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingBottom: 50, paddingTop: 28,
    alignItems: 'center', gap: 20,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  bottomHint: {
    color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '500',
  },
  shutter: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#fff',
  },
});
