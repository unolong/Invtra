import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useFoodLog } from '@/context/food-log-context';
import { capturedPhoto } from '@/lib/captured-photo';
import {
  analyzeFoodPhoto,
  type FoodPhotoItem,
} from '@/services/anthropic';

const ACCENT = '#c8ff00';
const ITEM_COLORS = ['#4f8bff', '#ffb547', '#26de81', '#ff7a4d', '#a78bff', ACCENT];

type CheckedItem = FoodPhotoItem & { id: string; checked: boolean };

export default function AiResultScreen() {
  const { meal = 'Frühstück' } = useLocalSearchParams<{ meal?: string }>();
  const { addEntry, totals, goals } = useFoodLog();
  const photo = capturedPhoto.get();

  const remaining = {
    calories: Math.max(0, goals.calories - totals.calories),
    protein:  Math.max(0, goals.protein  - totals.protein),
    carbs:    Math.max(0, goals.carbs    - totals.carbs),
    fat:      Math.max(0, goals.fat      - totals.fat),
  };

  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [items, setItems]       = useState<CheckedItem[]>([]);
  const [hidden, setHidden]     = useState<Array<{ name: string; calories: number }>>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [adding, setAdding]     = useState(false);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!photo.base64) {
        setError('Kein Foto verfügbar.');
        return;
      }
      const result = await analyzeFoodPhoto(photo.base64, meal, remaining);
      setItems(result.items.map((item, i) => ({ ...item, id: String(i), checked: true })));
      setHidden(result.hidden);
    } catch (e: any) {
      setError('Scan fehlgeschlagen. Bitte versuche es erneut.');
    } finally {
      setLoading(false);
    }
  }, [photo.base64, meal]);

  useEffect(() => { analyze(); }, []);

  const checkedItems = items.filter(i => i.checked);
  const totalKcal    = checkedItems.reduce((a, i) => a + i.calories, 0);
  const totalP       = checkedItems.reduce((a, i) => a + i.protein, 0);
  const totalC       = checkedItems.reduce((a, i) => a + i.carbs, 0);
  const totalF       = checkedItems.reduce((a, i) => a + i.fat, 0);
  const hiddenKcal   = hidden.reduce((a, h) => a + h.calories, 0);
  const avgConf      = items.length
    ? Math.round(items.reduce((a, i) => a + i.confidence, 0) / items.length * 100)
    : 0;

  const handleAdd = useCallback(async () => {
    if (checkedItems.length === 0) return;
    setAdding(true);
    try {
      for (const item of checkedItems) {
        await addEntry({
          meal,
          name: item.name,
          brand: '',
          grams: item.grams,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
        });
      }
      capturedPhoto.clear();
      router.back();
    } catch (e: any) {
      Alert.alert('Fehler', e.message);
    } finally {
      setAdding(false);
    }
  }, [checkedItems, meal, addEntry]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.headerBack}>← Zurück</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>KI-Ergebnis</Text>
        <View style={styles.mealChip}>
          <Text style={styles.mealChipText}>{meal}</Text>
        </View>
      </View>

      {/* Photo */}
      {!!photo.uri && (
        <View style={styles.photoWrapper}>
          <Image source={{ uri: photo.uri }} style={styles.photo} resizeMode="cover" />
          {loading && (
            <View style={styles.photoOverlay}>
              <ActivityIndicator color={ACCENT} size="large" />
              <Text style={styles.photoOverlayText}>Gericht wird analysiert…</Text>
            </View>
          )}
          {/* Detection dots */}
          {!loading && items.slice(0, 4).map((item, i) => (
            <View
              key={item.id}
              style={[
                styles.detectionDot,
                {
                  top: `${18 + i * 16}%`,
                  left: `${12 + (i % 3) * 26}%`,
                  backgroundColor: ITEM_COLORS[i % ITEM_COLORS.length],
                } as any,
              ]}
            >
              <Text style={styles.detectionDotText} numberOfLines={1}>{item.name}</Text>
            </View>
          ))}
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {error ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={analyze}>
              <Text style={styles.retryBtnText}>Wiederholen</Text>
            </TouchableOpacity>
            {error.includes('API Key') && (
              <TouchableOpacity onPress={() => router.push('/settings')}>
                <Text style={[styles.retryBtnText, { color: ACCENT }]}>Einstellungen öffnen →</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : loading ? null : items.length === 0 ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateText}>Keine Lebensmittel erkannt.</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={analyze}>
              <Text style={styles.retryBtnText}>Erneut analysieren</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Section header */}
            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>Erkannte Zutaten</Text>
              <View style={styles.confBadge}>
                <Text style={styles.confBadgeText}>⌀ {avgConf}% Konfidenz</Text>
              </View>
            </View>

            {/* Ingredient list */}
            <View style={styles.card}>
              {items.map((item, idx) => {
                const color = ITEM_COLORS[idx % ITEM_COLORS.length];
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.itemRow, idx < items.length - 1 && styles.itemRowBorder]}
                    onPress={() =>
                      setItems(prev =>
                        prev.map(i => i.id === item.id ? { ...i, checked: !i.checked } : i)
                      )
                    }
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, item.checked && { backgroundColor: color, borderColor: color }]}>
                      {item.checked && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <View style={[styles.colorDot, { backgroundColor: color }]} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.itemName, !item.checked && styles.faded]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.itemSub} numberOfLines={1}>
                        {item.grams}g · {Math.round(item.confidence * 100)}% sicher
                      </Text>
                    </View>
                    <Text style={[styles.itemKcal, !item.checked && styles.faded]}>
                      {item.calories} kcal
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Macro strip */}
            <View style={styles.macroStrip}>
              <MacroChip label="kcal"  value={Math.round(totalKcal)} color="#fff" />
              <MacroChip label="Prot." value={Math.round(totalP)}    unit="g" color="#4f8bff" />
              <MacroChip label="Carbs" value={Math.round(totalC)}    unit="g" color="#ffb547" />
              <MacroChip label="Fett"  value={Math.round(totalF)}    unit="g" color="#ff5e5e" />
            </View>

            {/* Hidden calories */}
            {hidden.length > 0 && (
              <TouchableOpacity
                style={styles.hiddenToggle}
                onPress={() => setShowHidden(v => !v)}
                activeOpacity={0.7}
              >
                <Text style={styles.hiddenToggleText}>
                  {showHidden ? '▼' : '▶'}  Versteckte Kalorien?{'  '}
                  <Text style={{ color: '#ffb547' }}>+{hiddenKcal} kcal</Text>
                </Text>
              </TouchableOpacity>
            )}
            {showHidden && (
              <View style={styles.hiddenCard}>
                {hidden.map((h, i) => (
                  <View key={i} style={[styles.hiddenRow, i > 0 && styles.hiddenRowBorder]}>
                    <Text style={styles.hiddenName}>{h.name}</Text>
                    <Text style={styles.hiddenKcal}>~{h.calories} kcal</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* CTA */}
      {!loading && !error && items.length > 0 && (
        <View style={styles.ctaArea}>
          <TouchableOpacity
            style={[
              styles.ctaBtn,
              (checkedItems.length === 0 || adding) && styles.ctaBtnDisabled,
            ]}
            onPress={handleAdd}
            disabled={checkedItems.length === 0 || adding}
            activeOpacity={0.85}
          >
            {adding ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.ctaBtnText}>
                Zu {meal} hinzufügen
                {checkedItems.length > 0 ? `  (${checkedItems.length})` : ''}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

function MacroChip({
  label, value, unit = '', color,
}: {
  label: string; value: number; unit?: string; color: string;
}) {
  return (
    <View style={styles.macroChip}>
      <Text style={[styles.macroValue, { color }]}>{value}{unit}</Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 0.5, borderBottomColor: '#222222',
  },
  headerBack: { fontSize: 15, color: ACCENT, fontWeight: '600', width: 80 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  mealChip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 99,
    backgroundColor: `${ACCENT}18`, borderWidth: 0.5, borderColor: `${ACCENT}40`,
  },
  mealChipText: { fontSize: 12, fontWeight: '600', color: ACCENT },

  photoWrapper: {
    width: '100%', height: 220, backgroundColor: '#111111', position: 'relative',
  },
  photo: { width: '100%', height: '100%' },
  photoOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  photoOverlayText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  detectionDot: {
    position: 'absolute',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
    maxWidth: 110,
  },
  detectionDotText: { fontSize: 10, color: '#000', fontWeight: '700' },

  scroll: { padding: 16, paddingBottom: 110, gap: 12 },

  stateCard: {
    backgroundColor: '#111111', borderRadius: 18, padding: 24,
    borderWidth: 0.5, borderColor: '#222222', gap: 12, alignItems: 'center',
  },
  stateText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center' },
  retryBtn: {
    backgroundColor: '#222222', borderRadius: 10,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  retryBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.8, textTransform: 'uppercase',
  },
  confBadge: {
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: 99,
    backgroundColor: '#1a1a1a',
  },
  confBadgeText: { fontSize: 10, color: 'rgba(255,255,255,0.45)', fontWeight: '600' },

  card: {
    backgroundColor: '#111111', borderRadius: 18,
    borderWidth: 0.5, borderColor: '#222222', overflow: 'hidden',
  },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 13, paddingHorizontal: 14,
  },
  itemRowBorder: { borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  checkbox: {
    width: 22, height: 22, borderRadius: 7, borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  checkmark: { fontSize: 11, color: '#000', fontWeight: '800' },
  colorDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  itemName: { fontSize: 14, fontWeight: '500', color: '#fff', letterSpacing: -0.1 },
  faded: { opacity: 0.3 },
  itemSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  itemKcal: { fontSize: 13, color: '#fff', fontWeight: '600', flexShrink: 0 },

  macroStrip: {
    flexDirection: 'row', backgroundColor: '#111111',
    borderRadius: 14, borderWidth: 0.5, borderColor: '#222222', padding: 14, gap: 4,
  },
  macroChip: { flex: 1, alignItems: 'center', gap: 3 },
  macroValue: { fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  macroLabel: { fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: '500' },

  hiddenToggle: { paddingHorizontal: 4, paddingVertical: 4 },
  hiddenToggleText: { fontSize: 13, color: 'rgba(255,255,255,0.45)', fontWeight: '500' },
  hiddenCard: {
    backgroundColor: '#111111', borderRadius: 14, padding: 14,
    borderWidth: 0.5, borderColor: '#222222', gap: 0,
  },
  hiddenRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  hiddenRowBorder: { borderTopWidth: 0.5, borderTopColor: '#1a1a1a' },
  hiddenName: { fontSize: 13, color: 'rgba(255,255,255,0.55)' },
  hiddenKcal: { fontSize: 13, color: '#ffb547', fontWeight: '600' },

  ctaArea: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, paddingBottom: 34,
    backgroundColor: '#0a0a0a', borderTopWidth: 0.5, borderTopColor: '#222222',
  },
  ctaBtn: {
    backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
  },
  ctaBtnDisabled: { opacity: 0.35 },
  ctaBtnText: { color: '#000', fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
});
