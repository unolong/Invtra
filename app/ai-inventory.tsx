import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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

import { useInventory } from '@/context/inventory-context';
import { capturedPhoto } from '@/lib/captured-photo';
import { fetchProductByBarcode } from '@/services/open-food-facts';
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

const EDIT_UNITS = ['g', 'kg', 'ml', 'L', 'Stück'] as const;
type EditUnit = typeof EDIT_UNITS[number];

const ADD_UNITS = ['g', 'kg', 'ml', 'L', 'Stück', 'Packung', 'Dose'] as const;
const CATS = ['protein', 'gemüse', 'obst', 'milch', 'carbs', 'fett', 'sonstiges'] as const;

type CheckedItem = InventoryPhotoItem & {
  id: string;
  checked: boolean;
  editedQuantity?: number;
  editedUnit?: EditUnit;
  manuallyEdited?: boolean;
  expiresAt?: string | null;
  isManual?: boolean;
};

function confColor(conf: number): string {
  if (conf >= 0.9)  return '#26de81';
  if (conf >= 0.75) return '#F7A94F';
  return '#F74F4F';
}

function stepSize(unit: EditUnit): number {
  if (unit === 'kg' || unit === 'L') return 0.1;
  if (unit === 'Stück') return 1;
  return 100;
}

function fmtQtyStr(val: number, unit: EditUnit): string {
  return (unit === 'kg' || unit === 'L') ? val.toFixed(1) : String(Math.round(val));
}

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

function formatQty(item: CheckedItem): string {
  const q = item.editedQuantity ?? item.quantity;
  const u = item.editedUnit ?? item.unit;
  return `${q}${u}`;
}

export default function AiInventoryScreen() {
  const { addItems } = useInventory();
  const photo = capturedPhoto.get();

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [items, setItems]       = useState<CheckedItem[]>([]);

  // Inline edit state
  const [editingId, setEditingId]             = useState<string | null>(null);
  const [editQuantityStr, setEditQuantityStr] = useState('');
  const [editUnit, setEditUnit]               = useState<EditUnit>('g');
  const [editExpiryMode, setEditMode]         = useState<'ai' | 'manual'>('ai');
  const [editAiDays, setEditAiDays]           = useState<number | null>(null);
  const [editAiLoading, setEditAiLoading]     = useState(false);
  const [editDraftDate, setEditDraftDate]     = useState<string | null>(null);
  const [editShowPicker, setEditPicker]       = useState(false);
  const fetchRef = useRef(0);

  // Add item modal state
  const [showAddModal, setShowAddModal]         = useState(false);
  const [showBarcodeCamera, setShowBarcodeCamera] = useState(false);
  const [barcodeLoading, setBarcodeLoading]     = useState(false);
  const [addName, setAddName]                   = useState('');
  const [addQty, setAddQty]                     = useState('');
  const [addUnit, setAddUnit]                   = useState<string>('g');
  const [addCat, setAddCat]                     = useState<string>('sonstiges');
  const barcodeScanRef = useRef(false);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!photo.base64) { setError('Kein Foto verfügbar.'); return; }
      const result = await analyzeInventoryPhoto(photo.base64);
      setItems(result.map((item, i) => ({ ...item, id: String(i), checked: true })));
    } catch {
      setError('Scan fehlgeschlagen. Bitte versuche es erneut.');
    } finally {
      setLoading(false);
    }
  }, [photo.base64]);

  useEffect(() => { analyze(); }, []);

  // AI shelf life estimate when editing
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
    setEditQuantityStr(String(item.editedQuantity ?? item.quantity));
    setEditUnit((item.editedUnit ?? item.unit) as EditUnit);
    setEditMode('ai');
    setEditAiDays(null);
    setEditDraftDate(null);
    setEditPicker(false);
  };

  const openDatePicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: editDraftDate ? new Date(editDraftDate) : new Date(),
        mode: 'date',
        onChange: (event, date) => {
          if (event.type === 'set' && date) {
            const d = new Date(date);
            d.setHours(0, 0, 0, 0);
            setEditDraftDate(d.toISOString());
          }
        },
      });
    } else {
      setEditPicker(v => !v);
    }
  };

  const confirmEdit = () => {
    if (!editingId) return;
    const newQty = Math.max(1, Math.round(Number(editQuantityStr) || 1));
    let expiresAt: string | null = null;
    if (editExpiryMode === 'ai' && editAiDays) expiresAt = makeExpiresAt(editAiDays);
    else if (editExpiryMode === 'manual' && editDraftDate) expiresAt = editDraftDate;
    setItems(prev => prev.map(i =>
      i.id === editingId
        ? { ...i, editedQuantity: newQty, editedUnit: editUnit, manuallyEdited: true, expiresAt }
        : i,
    ));
    setEditingId(null);
  };

  const handleModalBarcode = useCallback(async ({ data }: { data: string }) => {
    if (barcodeScanRef.current) return;
    barcodeScanRef.current = true;
    setShowBarcodeCamera(false);
    setBarcodeLoading(true);
    try {
      const product = await fetchProductByBarcode(data);
      if (product) {
        setAddName(product.name + (product.brand ? ` (${product.brand})` : ''));
        setAddQty('1');
        setAddUnit('Stück');
      } else {
        Alert.alert('Nicht gefunden', 'Produkt wurde nicht in der Datenbank gefunden.');
      }
    } finally {
      setBarcodeLoading(false);
      barcodeScanRef.current = false;
    }
  }, []);

  const handleAddManual = () => {
    if (!addName.trim()) return;
    const qty = Math.max(1, Number(addQty.trim()) || 1);
    setItems(prev => [...prev, {
      id: `manual-${Date.now()}`,
      name: addName.trim(),
      quantity: qty,
      unit: 'g' as const,
      originalDescription: `${qty} ${addUnit}`,
      category: addCat,
      confidence: 1,
      checked: true,
      isManual: true,
      editedUnit: addUnit as EditUnit,
    }]);
    setAddName('');
    setAddQty('');
    setAddUnit('g');
    setAddCat('sonstiges');
    setShowAddModal(false);
  };

  const openBarcodeScanner = async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('Kamera', 'Kamera-Zugriff wird benötigt um Barcodes zu scannen.');
        return;
      }
    }
    barcodeScanRef.current = false;
    setShowBarcodeCamera(true);
  };

  const checkedItems = items.filter(i => i.checked);

  const handleAdd = useCallback(async () => {
    if (checkedItems.length === 0) return;
    try {
      await addItems(
        checkedItems.map(i => ({
          name: i.name,
          qty: formatQty(i),
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
      {!!photo.uri && !photo.uri.startsWith('barcode:') && (
        <View style={styles.photoWrapper}>
          <Image source={{ uri: photo.uri }} style={styles.photo} resizeMode="cover" />
          {loading && (
            <View style={styles.photoOverlay}>
              <ActivityIndicator color={ACCENT} size="large" />
              <Text style={styles.photoOverlayText}>Inhalt wird erkannt…</Text>
            </View>
          )}
          {!loading && items.filter(i => !i.isManual).slice(0, 5).map((item, i) => {
            const color = CAT_COLOR[item.category] ?? ACCENT;
            return (
              <View
                key={item.id}
                style={[styles.segLabel, { top: `${14 + i * 15}%`, left: `${10 + (i % 3) * 28}%`, backgroundColor: color } as any]}
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

                return (
                  <View key={item.id}>
                    <View style={styles.itemRow}>
                      <TouchableOpacity
                        style={[styles.checkbox, item.checked && { backgroundColor: color, borderColor: color }]}
                        onPress={() => setItems(prev => prev.map(i => i.id === item.id ? { ...i, checked: !i.checked } : i))}
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
                          {formatQty(item)}
                          {' · '}
                          {item.isManual
                            ? <Text style={{ color: ACCENT }}>✎ manuell</Text>
                            : item.manuallyEdited
                              ? <Text style={{ color: 'rgba(255,255,255,0.5)' }}>Manuell angepasst</Text>
                              : <Text style={{ color: confColor(item.confidence) }}>
                                  {Math.round(item.confidence * 100)}% sicher
                                </Text>
                          }
                        </Text>
                      </View>

                      <TouchableOpacity
                        style={[styles.editBtn, isEditing && styles.editBtnActive]}
                        onPress={() => openEdit(item)}
                        hitSlop={8}
                      >
                        <Text style={[styles.editBtnIcon, isEditing && styles.editBtnIconActive]}>✎</Text>
                      </TouchableOpacity>
                    </View>

                    {isEditing && (
                      <View style={styles.editPanel}>
                        {/* Qty + Unit */}
                        <View style={styles.editField}>
                          <Text style={styles.editFieldLabel}>MENGE</Text>
                          <View style={styles.stepperRow}>
                            <TouchableOpacity
                              style={[
                                styles.stepBtn,
                                (Number(editQuantityStr) || 0) <= 0 && styles.stepBtnDisabled,
                              ]}
                              onPress={() => {
                                const cur = Number(editQuantityStr) || 0;
                                const next = Math.max(0, cur - stepSize(editUnit));
                                setEditQuantityStr(fmtQtyStr(next, editUnit));
                              }}
                              disabled={(Number(editQuantityStr) || 0) <= 0}
                              hitSlop={4}
                            >
                              <Text style={styles.stepBtnText}>−</Text>
                            </TouchableOpacity>

                            <TextInput
                              style={styles.stepInput}
                              value={editQuantityStr}
                              onChangeText={setEditQuantityStr}
                              keyboardType="numeric"
                              returnKeyType="done"
                              selectTextOnFocus
                            />

                            <TouchableOpacity
                              style={styles.stepBtn}
                              onPress={() => {
                                const cur = Number(editQuantityStr) || 0;
                                const next = cur + stepSize(editUnit);
                                setEditQuantityStr(fmtQtyStr(next, editUnit));
                              }}
                              hitSlop={4}
                            >
                              <Text style={styles.stepBtnText}>+</Text>
                            </TouchableOpacity>
                          </View>
                          <View style={styles.unitChips}>
                            {EDIT_UNITS.map(u => (
                              <TouchableOpacity
                                key={u}
                                style={[styles.unitChip, editUnit === u && styles.unitChipActive]}
                                onPress={() => setEditUnit(u)}
                                activeOpacity={0.75}
                              >
                                <Text style={[styles.unitChipText, editUnit === u && styles.unitChipTextActive]}>
                                  {u}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                          {!item.isManual && item.originalDescription ? (
                            <Text style={styles.originalDesc}>Erkannt: {item.originalDescription}</Text>
                          ) : null}
                        </View>

                        {/* Expiry */}
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
                                onPress={openDatePicker}
                                activeOpacity={0.8}
                              >
                                <Text style={{ fontSize: 16 }}>📅</Text>
                                <Text style={styles.dateText}>{formatDate(editDraftDate)}</Text>
                                <View style={{ flex: 1 }} />
                                <Text style={styles.dateChevron}>
                                  {Platform.OS !== 'android' ? (editShowPicker ? '▲' : '▼') : '›'}
                                </Text>
                              </TouchableOpacity>

                              {editShowPicker && Platform.OS === 'web' && (
                                <input
                                  type="date"
                                  value={editDraftDate ? new Date(editDraftDate).toISOString().split('T')[0] : ''}
                                  onChange={(e: any) => {
                                    if (e.target.value) {
                                      const d = new Date(e.target.value + 'T00:00:00');
                                      d.setHours(0, 0, 0, 0);
                                      setEditDraftDate(d.toISOString());
                                    }
                                  }}
                                  style={{
                                    backgroundColor: '#111111',
                                    border: '1px solid #333',
                                    borderRadius: 10,
                                    color: '#fff',
                                    fontSize: 14,
                                    padding: '10px 14px',
                                    width: '100%',
                                    colorScheme: 'dark',
                                  } as any}
                                />
                              )}
                              {editShowPicker && Platform.OS === 'ios' && (
                                <View style={styles.iosPickerWrap}>
                                  <DateTimePicker
                                    value={editDraftDate ? new Date(editDraftDate) : new Date()}
                                    mode="date" display="inline" themeVariant="dark"
                                    onChange={(_, date) => {
                                      if (date) { const d = new Date(date); d.setHours(0,0,0,0); setEditDraftDate(d.toISOString()); }
                                    }}
                                    style={{ height: 320, backgroundColor: '#111111' }}
                                  />
                                </View>
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

        {!loading && (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => setShowAddModal(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.addBtnText}>+ Artikel hinzufügen</Text>
          </TouchableOpacity>
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
            <Text style={styles.ctaBtnText}>{checkedItems.length} Artikel ins Inventar</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Add item modal */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (showBarcodeCamera) {
            setShowBarcodeCamera(false);
          } else {
            setShowAddModal(false);
          }
        }}
      >
        {showBarcodeCamera ? (
          /* ── Embedded barcode camera ── */
          <View style={styles.barcodeCameraContainer}>
            <CameraView
              style={StyleSheet.absoluteFill}
              barcodeScannerSettings={{
                barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'],
              }}
              onBarcodeScanned={handleModalBarcode}
            />
            {/* Frame overlay */}
            <View style={styles.barcodeCameraOverlay} pointerEvents="none">
              <View style={styles.barcodeCameraFrame} />
              <Text style={styles.barcodeCameraHint}>Barcode in den Rahmen halten</Text>
            </View>
            {/* Cancel button */}
            <SafeAreaView style={styles.barcodeCameraTop} edges={['top']}>
              <TouchableOpacity
                style={styles.barcodeCameraCancel}
                onPress={() => setShowBarcodeCamera(false)}
              >
                <Text style={styles.barcodeCameraCancelText}>← Abbrechen</Text>
              </TouchableOpacity>
            </SafeAreaView>
            {barcodeLoading && (
              <View style={styles.barcodeCameraLoading}>
                <ActivityIndicator color={ACCENT} size="large" />
                <Text style={styles.barcodeCameraLoadingText}>Produkt wird geladen…</Text>
              </View>
            )}
          </View>
        ) : (
          /* ── Normal modal sheet ── */
          <>
            <TouchableOpacity
              style={styles.modalOverlay}
              activeOpacity={1}
              onPress={() => setShowAddModal(false)}
            />
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Artikel hinzufügen</Text>

              <TouchableOpacity style={styles.barcodeBtn} onPress={openBarcodeScanner} activeOpacity={0.8}>
                <Text style={styles.barcodeBtnIcon}>▦</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.barcodeBtnTitle}>Barcode scannen</Text>
                  <Text style={styles.barcodeBtnSub}>Produkt aus Open Food Facts laden</Text>
                </View>
                <Text style={styles.barcodeBtnArrow}>›</Text>
              </TouchableOpacity>

              <View style={styles.modalDivider}>
                <View style={styles.modalDividerLine} />
                <Text style={styles.modalDividerText}>oder manuell eingeben</Text>
                <View style={styles.modalDividerLine} />
              </View>

              <Text style={styles.formLabel}>NAME</Text>
              <TextInput
                style={styles.formInput}
                value={addName}
                onChangeText={setAddName}
                placeholder="z.B. Hähnchenbrust"
                placeholderTextColor="rgba(255,255,255,0.2)"
                returnKeyType="next"
                autoFocus={false}
              />

              <Text style={[styles.formLabel, { marginTop: 12 }]}>MENGE</Text>
              <View style={styles.qtyRow}>
                <TextInput
                  style={[styles.formInput, { flex: 1 }]}
                  value={addQty}
                  onChangeText={setAddQty}
                  placeholder="500"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  keyboardType="numeric"
                  returnKeyType="done"
                  autoFocus={false}
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexShrink: 0 }}>
                  <View style={styles.unitRow}>
                    {ADD_UNITS.map(u => (
                      <TouchableOpacity
                        key={u}
                        style={[styles.unitChip, addUnit === u && styles.unitChipActive]}
                        onPress={() => setAddUnit(u)}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.unitChipText, addUnit === u && styles.unitChipTextActive]}>{u}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>

              <Text style={[styles.formLabel, { marginTop: 12 }]}>KATEGORIE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.catRow}>
                  {CATS.map(c => {
                    const col = CAT_COLOR[c] ?? ACCENT;
                    const active = addCat === c;
                    return (
                      <TouchableOpacity
                        key={c}
                        style={[styles.catChip, active && { backgroundColor: `${col}25`, borderColor: `${col}60` }]}
                        onPress={() => setAddCat(c)}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.catChipText, active && { color: col }]}>
                          {c.charAt(0).toUpperCase() + c.slice(1)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              <TouchableOpacity
                style={[styles.modalAddBtn, !addName.trim() && styles.modalAddBtnDisabled]}
                onPress={handleAddManual}
                disabled={!addName.trim()}
                activeOpacity={0.85}
              >
                <Text style={styles.modalAddBtnText}>Hinzufügen</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </Modal>
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
    backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  photoOverlayText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  segLabel: { position: 'absolute', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, maxWidth: 100 },
  segLabelText: { fontSize: 10, color: '#000', fontWeight: '700' },

  scroll: { padding: 16, paddingBottom: 120, gap: 12 },

  stateCard: {
    backgroundColor: '#111111', borderRadius: 18, padding: 24,
    borderWidth: 0.5, borderColor: '#222222', gap: 12, alignItems: 'center',
  },
  stateText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, textAlign: 'center' },
  retryBtn: { backgroundColor: '#222222', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
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

  card: { backgroundColor: '#111111', borderRadius: 18, borderWidth: 0.5, borderColor: '#222222', overflow: 'hidden' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  itemRowBorder: { height: 0.5, backgroundColor: '#1a1a1a', marginHorizontal: 14 },
  checkbox: {
    width: 22, height: 22, borderRadius: 7, borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  checkmark: { fontSize: 11, color: '#000', fontWeight: '800' },
  glyph: { width: 34, height: 34, borderRadius: 10, borderWidth: 0.5, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  glyphText: { fontSize: 14, fontWeight: '700' },
  itemName: { fontSize: 14, fontWeight: '500', color: '#fff', letterSpacing: -0.1 },
  faded: { opacity: 0.3 },
  itemSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },

  editBtn: {
    width: 30, height: 30, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  editBtnActive: { backgroundColor: `${ACCENT}20` },
  editBtnIcon: { fontSize: 16, color: 'rgba(255,255,255,0.45)' },
  editBtnIconActive: { color: ACCENT },

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
  qtyEditRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  qtyInput: { width: 90, flexShrink: 0 },
  unitChips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1 },
  unitChip: {
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9,
    backgroundColor: '#111111', borderWidth: 0.5, borderColor: '#222222',
  },
  unitChipActive: { backgroundColor: `${ACCENT}20`, borderColor: `${ACCENT}50` },
  unitChipText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.4)' },
  unitChipTextActive: { color: ACCENT },
  originalDesc: { fontSize: 11, color: '#666666', marginTop: 2 },

  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: '#222222', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stepBtnDisabled: { opacity: 0.3 },
  stepBtnText: { fontSize: 22, fontWeight: '600', color: '#f0f0f0', lineHeight: 26 },
  stepInput: {
    flex: 1, height: 44, borderRadius: 12,
    backgroundColor: '#111111', borderWidth: 0.5, borderColor: '#333',
    textAlign: 'center', fontSize: 18, fontWeight: '700', color: '#fff',
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

  confirmBtn: { backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  confirmBtnText: { color: '#000', fontSize: 14, fontWeight: '800', letterSpacing: -0.2 },

  addBtn: {
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#222222', borderStyle: 'dashed',
  },
  addBtnText: { color: 'rgba(255,255,255,0.45)', fontSize: 14, fontWeight: '600' },

  ctaArea: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, paddingBottom: 34,
    backgroundColor: '#0a0a0a', borderTopWidth: 0.5, borderTopColor: '#222222',
  },
  ctaBtn: { backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  ctaBtnDisabled: { opacity: 0.35 },
  ctaBtnText: { color: '#000', fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },

  // Modal
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#111111', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 0.5, borderColor: '#222222', padding: 20, paddingBottom: 40,
  },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#333', alignSelf: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#fff', marginBottom: 16, letterSpacing: -0.3 },

  barcodeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#181818', borderRadius: 14, borderWidth: 0.5, borderColor: '#222222', padding: 14,
  },
  barcodeBtnIcon: { fontSize: 24, color: ACCENT },
  barcodeBtnTitle: { fontSize: 14, fontWeight: '600', color: '#fff' },
  barcodeBtnSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  barcodeBtnArrow: { fontSize: 20, color: 'rgba(255,255,255,0.3)' },

  modalDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 },
  modalDividerLine: { flex: 1, height: 0.5, backgroundColor: '#222222' },
  modalDividerText: { fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: '500' },

  formLabel: {
    fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6,
  },
  formInput: {
    backgroundColor: '#181818', borderRadius: 12, borderWidth: 0.5, borderColor: '#222222',
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#fff',
  },
  qtyRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  unitRow: { flexDirection: 'row', gap: 6 },

  catRow: { flexDirection: 'row', gap: 6, paddingBottom: 2 },
  catChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#181818', borderWidth: 0.5, borderColor: '#222222',
  },
  catChipText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.4)' },

  modalAddBtn: { marginTop: 20, backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  modalAddBtnDisabled: { opacity: 0.35 },
  modalAddBtnText: { color: '#000', fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },

  // Embedded barcode camera in modal
  barcodeCameraContainer: { flex: 1, backgroundColor: '#000' },
  barcodeCameraOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  barcodeCameraFrame: {
    width: 260, height: 150,
    borderWidth: 2, borderColor: ACCENT, borderRadius: 12,
  },
  barcodeCameraHint: {
    color: '#fff', fontSize: 14, fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8,
  },
  barcodeCameraTop: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingTop: 8,
  },
  barcodeCameraCancel: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.25)',
  },
  barcodeCameraCancelText: { fontSize: 15, fontWeight: '600', color: '#f0f0f0' },
  barcodeCameraLoading: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  barcodeCameraLoadingText: { color: '#fff', fontSize: 14, fontWeight: '500' },
});
