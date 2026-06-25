import DateTimePicker from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useInventory } from '@/context/inventory-context';
import { capturedPhoto } from '@/lib/captured-photo';
import {
  analyzeInventoryPhoto,
  estimateShelfLife,
  type InventoryPhotoItem,
} from '@/services/anthropic';

const ACCENT = '#c8ff00';

const CAT_COLOR: Record<string, string> = {
  protein:   '#4f8bff',
  carbs:     '#ffb547',
  gemüse:    '#26de81',
  obst:      '#ff7a4d',
  fett:      '#ffb547',
  milch:     '#a78bff',
  sonstiges: 'rgba(255,255,255,0.5)',
};

const EXPIRY_CHIPS = [
  { label: '1T',  days: 1  },
  { label: '3T',  days: 3  },
  { label: '7T',  days: 7  },
  { label: '14T', days: 14 },
  { label: '1M',  days: 30 },
] as const;

type CheckedItem = InventoryPhotoItem & { id: string; checked: boolean; editedQty?: string; expiresAt?: string | null };

function makeExpiresAt(days: number): string {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days);
  return d.toISOString();
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return [String(d.getDate()).padStart(2,'0'), String(d.getMonth()+1).padStart(2,'0'), d.getFullYear()].join('.');
}

function daysFromToday(iso: string | null): number | null {
  if (!iso) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(iso); target.setHours(0,0,0,0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export default function AiInventoryScreen() {
  const { addItems } = useInventory();
  const photo = capturedPhoto.get();

  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [items, setItems]       = useState<CheckedItem[]>([]);

  // Inline edit state (single-item-at-a-time)
  const [editingId, setEditingId]         = useState<string | null>(null);
  const [editQty, setEditQty]             = useState('');
  const [editExpiryMode, setEditMode]     = useState<'ai' | 'manual'>('ai');
  const [editAiDays, setEditAiDays]       = useState<number | null>(null);
  const [editAiLoading, setEditAiLoading] = useState(false);
  const [editDraftDate, setEditDraftDate] = useState<string | null>(null);
  const [editShowPicker, setEditPicker]   = useState(false);
  const fetchRef = useRef(0);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!photo.base64) { setError('Kein Foto verfügbar.'); return; }
      const result = await analyzeInventoryPhoto(photo.base64);
      setItems(result.map((item, i) => ({ ...item, id: String(i), checked: true })));
    } catch (e: any) {
      setError(e.message ?? 'Analyse fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, [photo.base64]);

  useEffect(() => { analyze(); }, []);

  // Fetch AI estimate when editing item changes
  useEffect(() => {
    if (!editingId || editExpiryMode !== 'ai') return;
    const item = items.find(i => i.id === editingId);
    if (!item) return;
    const id = ++fetchRef.current;
    setEditAiLoading(true);
    setEditAiDays(null);
    estimateShelfLife(item.name, 'Kühlschrank')
      .then(r => {
        if (fetchRef.current !== id) return;
        setEditAiDays(r.days);
        setEditAiLoading(false);
      })
      .catch(() => {
        if (fetchRef.current !== id) return;
        setEditAiDays(5);
        setEditAiLoading(false);
      });
  }, [editingId, editExpiryMode]);

  const openEdit = (item: CheckedItem) => {
    if (editingId === item.id) { setEditingId(null); return; }
    setEditingId(item.id);
    setEditQty(item.editedQty ?? item.qty);
    setEditMode('ai');
    setEditAiDays(null);
    setEditDraftDate(null);
    setEditPicker(false);
  };

  const confirmEdit = () => {
    if (!editingId) return;
    let expiresAt: string | null = null;
    if (editExpiryMode === 'ai' && editAiDays) expiresAt = makeExpiresAt(editAiDays);
    else if (editExpiryMode === 'manual' && editDraftDate) expiresAt = editDraftDate;
    setItems(prev => prev.map(i =>
      i.id === editingId ? { ...i, editedQty: editQty.trim() || i.qty, expiresAt } : i,
    ));
    setEditingId(null);
  };

  const checkedItems = items.filter(i => i.checked);

  const handleAdd = useCallback(async () => {
    if (checkedItems.length === 0) return;
    try {
      await addItems(
        checkedItems.map(i => ({
          name: i.name,
          qty: i.editedQty ?? i.qty,
          cat: i.category,
          location: 'Kühlschrank' as const,
          expiresAt: i.expiresAt ?? null,
        })),
      );
      capturedPhoto.clear();
      router.back();
    } catch {
      Alert.alert('Fehler', 'Artikel konnten nicht gespeichert werden.');
    }
  }, [checkedItems, addItems]);

  const activeChip = daysFromToday(editDraftDate);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.headerBack}>← Zurück</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Inventar-Scan</Text>
        <View style={{ width: 80 }} />
      </View>

      {/* Photo */}
      {!!photo.uri && (
        <View style={styles.photoWrapper}>
          <Image source={{ uri: photo.uri }} style={styles.photo} resizeMode="cover" />
          {loading && (
            <View style={styles.photoOverlay}>
              <ActivityIndicator color={ACCENT} size="large" />
              <Text style={styles.photoOverlayText}>Inhalt wird erkannt…</Text>
            </View>
          )}
          {!loading && items.slice(0, 5).map((item, i) => {
            const color = CAT_COLOR[item.category] ?? ACCENT;
            return (
              <View
                key={item.id}
                style={[
                  styles.segLabel,
                  { top: `${14 + i * 15}%`, left: `${10 + (i % 3) * 28}%`, backgroundColor: color } as any,
                ]}
              >
                <Text style={styles.segLabelText} numberOfLines={1}>{item.name}</Text>
              </View>
            );
          })}
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
            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>Erkannte Produkte</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{items.length} Artikel</Text>
              </View>
            </View>

            <View style={styles.card}>
              {items.map((item, idx) => {
                const color = CAT_COLOR[item.category] ?? ACCENT;
                const isEditing = editingId === item.id;
                const hasCustom = !!item.editedQty || item.expiresAt !== undefined;

                return (
                  <View key={item.id}>
                    {/* Item row */}
                    <View style={styles.itemRow}>
                      <TouchableOpacity
                        style={[styles.checkbox, item.checked && { backgroundColor: color, borderColor: color }]}
                        onPress={() =>
                          setItems(prev => prev.map(i => i.id === item.id ? { ...i, checked: !i.checked } : i))
                        }
                      >
                        {item.checked && <Text style={styles.checkmark}>✓</Text>}
                      </TouchableOpacity>

                      <View style={[styles.glyph, { backgroundColor: `${color}20`, borderColor: `${color}40` }]}>
                        <Text style={[styles.glyphText, { color }]}>{item.name[0].toUpperCase()}</Text>
                      </View>

                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.itemName, !item.checked && styles.faded]} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={styles.itemSub} numberOfLines={1}>
                          {item.editedQty ?? item.qty} · {Math.round(item.confidence * 100)}% sicher
                          {hasCustom ? ' · ✓ bearbeitet' : ''}
                        </Text>
                      </View>

                      {/* Pencil icon */}
                      <TouchableOpacity
                        style={[styles.editBtn, isEditing && styles.editBtnActive]}
                        onPress={() => openEdit(item)}
                        hitSlop={8}
                      >
                        <Text style={[styles.editBtnIcon, isEditing && styles.editBtnIconActive]}>✎</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Inline edit panel */}
                    {isEditing && (
                      <View style={styles.editPanel}>
                        {/* Qty */}
                        <View style={styles.editField}>
                          <Text style={styles.editFieldLabel}>MENGE</Text>
                          <TextInput
                            style={styles.editInput}
                            value={editQty}
                            onChangeText={setEditQty}
                            placeholder={item.qty}
                            placeholderTextColor="rgba(255,255,255,0.2)"
                            returnKeyType="done"
                          />
                        </View>

                        {/* Expiry toggle */}
                        <View style={styles.editField}>
                          <Text style={styles.editFieldLabel}>HALTBARKEIT</Text>
                          <View style={styles.segControl}>
                            {(['ai', 'manual'] as const).map(m => (
                              <TouchableOpacity
                                key={m}
                                style={[styles.segOpt, editExpiryMode === m && styles.segOptActive]}
                                onPress={() => setEditMode(m)}
                                activeOpacity={0.8}
                              >
                                <Text style={[styles.segOptText, editExpiryMode === m && styles.segOptTextActive]}>
                                  {m === 'ai' ? 'AI-Schätzung' : 'Manuell'}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>

                          {editExpiryMode === 'ai' && (
                            <View style={styles.aiCard}>
                              {editAiLoading ? (
                                <View style={styles.aiLoadRow}>
                                  <ActivityIndicator size="small" color={ACCENT} />
                                  <Text style={styles.aiLoadText}>Wird geschätzt…</Text>
                                </View>
                              ) : (
                                <>
                                  <View style={styles.aiTopRow}>
                                    <Text style={styles.aiLabel}>✦ KI-Schätzung · Kühlschrank</Text>
                                    {editAiDays != null && (
                                      <Text style={styles.aiUntil}>bis {formatDate(makeExpiresAt(editAiDays))}</Text>
                                    )}
                                  </View>
                                  {editAiDays != null && (
                                    <Text style={styles.aiDays}>~{editAiDays} Tage</Text>
                                  )}
                                </>
                              )}
                            </View>
                          )}

                          {editExpiryMode === 'manual' && (
                            <View style={styles.manualSection}>
                              <TouchableOpacity
                                style={styles.dateField}
                                onPress={() => setEditPicker(v => !v)}
                                activeOpacity={0.8}
                              >
                                <Text style={{ fontSize: 16 }}>📅</Text>
                                <Text style={styles.dateText}>{formatDate(editDraftDate)}</Text>
                                <View style={{ flex: 1 }} />
                                <Text style={styles.dateChevron}>{editShowPicker ? '▲' : '▼'}</Text>
                              </TouchableOpacity>

                              {editShowPicker && Platform.OS === 'ios' && (
                                <View style={styles.iosPickerWrap}>
                                  <DateTimePicker
                                    value={editDraftDate ? new Date(editDraftDate) : new Date()}
                                    mode="date"
                                    display="inline"
                                    themeVariant="dark"
                                    onChange={(_, date) => {
                                      if (date) { const d = new Date(date); d.setHours(0,0,0,0); setEditDraftDate(d.toISOString()); }
                                    }}
                                    style={{ height: 320, backgroundColor: '#111111' }}
                                  />
                                </View>
                              )}
                              {editShowPicker && Platform.OS === 'android' && (
                                <DateTimePicker
                                  value={editDraftDate ? new Date(editDraftDate) : new Date()}
                                  mode="date"
                                  display="default"
                                  onChange={(event, date) => {
                                    setEditPicker(false);
                                    if (event.type === 'set' && date) { const d = new Date(date); d.setHours(0,0,0,0); setEditDraftDate(d.toISOString()); }
                                  }}
                                />
                              )}

                              <View style={styles.chipRow}>
                                {EXPIRY_CHIPS.map(c => (
                                  <TouchableOpacity
                                    key={c.label}
                                    style={[styles.expiryChip, activeChip === c.days && styles.expiryChipActive]}
                                    onPress={() => setEditDraftDate(makeExpiresAt(c.days))}
                                    activeOpacity={0.75}
                                  >
                                    <Text style={[styles.expiryChipText, activeChip === c.days && styles.expiryChipTextActive]}>
                                      {c.label}
                                    </Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            </View>
                          )}
                        </View>

                        {/* Confirm button */}
                        <TouchableOpacity style={styles.confirmBtn} onPress={confirmEdit} activeOpacity={0.85}>
                          <Text style={styles.confirmBtnText}>✓ Übernehmen</Text>
                        </TouchableOpacity>

                        {idx < items.length - 1 && <View style={styles.itemRowBorder} />}
                      </View>
                    )}

                    {idx < items.length - 1 && !isEditing && <View style={styles.itemRowBorder} />}
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      {!loading && !error && items.length > 0 && (
        <View style={styles.ctaArea}>
          <TouchableOpacity
            style={[styles.ctaBtn, checkedItems.length === 0 && styles.ctaBtnDisabled]}
            onPress={handleAdd}
            disabled={checkedItems.length === 0}
            activeOpacity={0.85}
          >
            <Text style={styles.ctaBtnText}>
              {checkedItems.length} Artikel ins Inventar
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
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

  photoWrapper: { width: '100%', height: 210, backgroundColor: '#111111', position: 'relative' },
  photo: { width: '100%', height: '100%' },
  photoOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  photoOverlayText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  segLabel: {
    position: 'absolute', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, maxWidth: 100,
  },
  segLabelText: { fontSize: 10, color: '#000', fontWeight: '700' },

  scroll: { padding: 16, paddingBottom: 110, gap: 12 },

  stateCard: {
    backgroundColor: '#111111', borderRadius: 18, padding: 24,
    borderWidth: 0.5, borderColor: '#222222', gap: 12, alignItems: 'center',
  },
  stateText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center' },
  retryBtn: {
    backgroundColor: '#222222', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10,
  },
  retryBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4,
  },
  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.8, textTransform: 'uppercase',
  },
  countBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 99, backgroundColor: '#1a1a1a' },
  countBadgeText: { fontSize: 10, color: 'rgba(255,255,255,0.45)', fontWeight: '600' },

  card: {
    backgroundColor: '#111111', borderRadius: 18, borderWidth: 0.5, borderColor: '#222222', overflow: 'hidden',
  },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  itemRowBorder: { height: 0.5, backgroundColor: '#1a1a1a', marginHorizontal: 14 },
  checkbox: {
    width: 22, height: 22, borderRadius: 7, borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  checkmark: { fontSize: 11, color: '#000', fontWeight: '800' },
  glyph: {
    width: 34, height: 34, borderRadius: 10, borderWidth: 0.5,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  glyphText: { fontSize: 14, fontWeight: '700' },
  itemName: { fontSize: 14, fontWeight: '500', color: '#fff', letterSpacing: -0.1 },
  faded: { opacity: 0.3 },
  itemSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },

  editBtn: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  editBtnActive: { backgroundColor: `${ACCENT}20` },
  editBtnIcon: { fontSize: 16, color: 'rgba(255,255,255,0.45)' },
  editBtnIconActive: { color: ACCENT },

  // Inline edit panel
  editPanel: {
    backgroundColor: '#181818', borderTopWidth: 0.5, borderTopColor: '#222222',
    paddingHorizontal: 14, paddingVertical: 14, gap: 14,
  },
  editField: { gap: 8 },
  editFieldLabel: {
    fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1, textTransform: 'uppercase',
  },
  editInput: {
    backgroundColor: '#111111', borderRadius: 12, borderWidth: 0.5, borderColor: '#222222',
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#fff',
  },

  segControl: {
    flexDirection: 'row', backgroundColor: '#111111',
    borderRadius: 10, borderWidth: 0.5, borderColor: '#222222', padding: 3, gap: 3,
  },
  segOpt: { flex: 1, paddingVertical: 8, borderRadius: 7, alignItems: 'center' },
  segOptActive: { backgroundColor: '#fff' },
  segOptText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.4)' },
  segOptTextActive: { color: '#000' },

  aiCard: {
    backgroundColor: 'rgba(200,255,0,0.04)',
    borderRadius: 12, borderWidth: 0.5, borderColor: 'rgba(200,255,0,0.12)', padding: 14, gap: 4,
  },
  aiLoadRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  aiLoadText: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  aiTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aiLabel: { fontSize: 10, fontWeight: '700', color: ACCENT, letterSpacing: 1, textTransform: 'uppercase' },
  aiUntil: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  aiDays: { fontSize: 26, fontWeight: '800', color: '#fff', letterSpacing: -1, lineHeight: 30 },

  manualSection: { gap: 8 },
  dateField: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#111111', borderRadius: 12, borderWidth: 0.5, borderColor: '#222222', padding: 12,
  },
  dateText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  dateChevron: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  iosPickerWrap: { marginHorizontal: -28, transform: [{ scale: 0.9 }], marginVertical: -16 },

  chipRow: { flexDirection: 'row', gap: 6 },
  expiryChip: {
    flex: 1, paddingVertical: 8, borderRadius: 9,
    backgroundColor: '#111111', borderWidth: 0.5, borderColor: '#222222', alignItems: 'center',
  },
  expiryChipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  expiryChipText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.45)' },
  expiryChipTextActive: { color: '#000' },

  confirmBtn: {
    backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 13, alignItems: 'center',
  },
  confirmBtnText: { color: '#000', fontSize: 14, fontWeight: '800', letterSpacing: -0.2 },

  ctaArea: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, paddingBottom: 34,
    backgroundColor: '#0a0a0a', borderTopWidth: 0.5, borderTopColor: '#222222',
  },
  ctaBtn: { backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  ctaBtnDisabled: { opacity: 0.35 },
  ctaBtnText: { color: '#000', fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
});
