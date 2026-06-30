import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { PinchGestureHandler, State } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';

import { type InventoryLocation, useInventory } from '@/context/inventory-context';
import { capturedPhoto } from '@/lib/captured-photo';
import { fetchProductByBarcode } from '@/services/open-food-facts';
import {
  analyzeInventoryPhoto,
  estimateShelfLife,
  type InventoryPhotoItem,
} from '@/services/anthropic';
import { lookupShelfLife } from '@/constants/shelfLife';

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

const LOCATIONS: InventoryLocation[] = ['Kühlschrank', 'Vorrat', 'Tiefkühler'];

const EDIT_UNITS = ['g', 'kg', 'ml', 'L', 'Stück'] as const;
type EditUnit = typeof EDIT_UNITS[number];

const ADD_UNITS = ['g', 'kg', 'ml', 'L', 'Stück', 'Packung', 'Dose'] as const;
const CATS = ['protein', 'gemüse', 'obst', 'milch', 'carbs', 'fett', 'sonstiges'] as const;

type CheckedItem = InventoryPhotoItem & {
  id: string;
  checked: boolean;
  editedQuantity?: number;
  editedUnit?: EditUnit;
  editedLocation?: InventoryLocation;
  editedOpened?: boolean | null;
  manuallyEdited?: boolean;
  expiresAt?: string | null;
  isManual?: boolean;
};

type TagGroup = {
  id: string;
  items: CheckedItem[];
  cx: number;    // display position x% (clamped)
  cy: number;    // display position y% (clamped)
  rawCx: number; // actual bounding box center x%
  rawCy: number; // actual bounding box center y%
};

function groupTagsByProximity(items: CheckedItem[], threshold = 8): TagGroup[] {
  const withBB = items.filter(i => !i.isManual && i.boundingBox);

  if (withBB.length === 0) {
    return items.filter(i => !i.isManual).slice(0, 5).map((item, i) => {
      const rawCx = 10 + (i % 3) * 28;
      const rawCy = 14 + i * 15;
      return { id: item.id, items: [item], cx: rawCx, cy: rawCy, rawCx, rawCy };
    });
  }

  const assigned = new Set<string>();
  const groups: TagGroup[] = [];

  for (const item of withBB) {
    if (assigned.has(item.id)) continue;
    const group: CheckedItem[] = [item];
    assigned.add(item.id);

    const ax = item.boundingBox!.x + item.boundingBox!.width / 2;
    const ay = item.boundingBox!.y + item.boundingBox!.height / 2;

    for (const other of withBB) {
      if (assigned.has(other.id)) continue;
      const bx = other.boundingBox!.x + other.boundingBox!.width / 2;
      const by = other.boundingBox!.y + other.boundingBox!.height / 2;
      if (Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2) < threshold) {
        group.push(other);
        assigned.add(other.id);
      }
    }

    const rawCx = group.reduce((s, gi) => s + gi.boundingBox!.x + gi.boundingBox!.width / 2, 0) / group.length;
    const rawCy = group.reduce((s, gi) => s + gi.boundingBox!.y + gi.boundingBox!.height / 2, 0) / group.length;

    // Single items: anchor tag at bounding box top-left. Groups: use center.
    const displayX = group.length === 1 ? item.boundingBox!.x : rawCx;
    const displayY = group.length === 1 ? item.boundingBox!.y : rawCy;

    groups.push({
      id: item.id,
      items: group,
      cx: Math.max(3, Math.min(85, displayX)),
      cy: Math.max(3, Math.min(90, displayY)),
      rawCx,
      rawCy,
    });
  }

  return groups;
}

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

  // Overlay & fullscreen state
  const [openGroupId, setOpenGroupId]         = useState<string | null>(null);
  const [fullscreenOpen, setFullscreenOpen]   = useState(false);

  // Inline edit state
  const [editingId, setEditingId]             = useState<string | null>(null);
  const [editQuantityStr, setEditQuantityStr] = useState('');
  const [editUnit, setEditUnit]               = useState<EditUnit>('g');
  const [editExpiryMode, setEditMode]         = useState<'ai' | 'manual'>('ai');
  const [editAiDays, setEditAiDays]           = useState<number | null>(null);
  const [editAiLoading, setEditAiLoading]     = useState(false);
  const [editDraftDate, setEditDraftDate]     = useState<string | null>(null);
  const [editShowPicker, setEditPicker]       = useState(false);
  const [editName, setEditName]               = useState('');
  const [editLocation, setEditLocation]       = useState<InventoryLocation>('Kühlschrank');
  const [editOpened, setEditOpened]           = useState<boolean | null>(null);
  const [editAiWarning, setEditAiWarning]       = useState<string | null>(null);
  const [editAiIdealStorage, setEditAiIdealStorage] = useState<string | null>(null);
  const [shelfLifeCache, setShelfLifeCache]   = useState<Record<string, { days: number; date: string; warning?: string; idealStorage?: string; category?: string }>>({});
  const [categoryCache, setCategoryCache]     = useState<Record<string, { category: string; idealStorage: string }>>({});
  const fetchRef = useRef(0);

  const tagGroups = useMemo(() => groupTagsByProximity(items), [items]);

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

  // AI shelf life estimate — cache key: `${itemName}_${location}_${opened}`
  useEffect(() => {
    if (!editingId || editExpiryMode !== 'ai') return;
    const item = items.find(i => i.id === editingId);
    if (!item) return;

    const cacheKey = `${item.name}_${editLocation}_${editOpened}`;

    // Full cache hit
    const cached = shelfLifeCache[cacheKey];
    if (cached) {
      setEditAiDays(cached.days);
      setEditAiWarning(cached.warning ?? null);
      setEditAiIdealStorage(cached.idealStorage ?? null);
      return;
    }

    // Category known → instant local lookup, no API call
    const knownCat = categoryCache[item.name];
    if (knownCat) {
      const { days, unsuitable } = lookupShelfLife(knownCat.category, editLocation, editOpened);
      const warning = unsuitable ? `Nicht zur Lagerung im ${editLocation} geeignet.` : undefined;
      setEditAiDays(days);
      setEditAiWarning(warning ?? null);
      setEditAiIdealStorage(knownCat.idealStorage);
      setShelfLifeCache(prev => ({
        ...prev,
        [cacheKey]: { days, date: days > 0 ? makeExpiresAt(days) : '', warning, idealStorage: knownCat.idealStorage, category: knownCat.category },
      }));
      return;
    }

    const id = ++fetchRef.current;
    setEditAiLoading(true);
    setEditAiDays(null);
    setEditAiWarning(null);
    setEditAiIdealStorage(null);
    estimateShelfLife(item.name, editLocation, editOpened)
      .then(r => {
        if (fetchRef.current !== id) return;
        setEditAiDays(r.days);
        setEditAiWarning(r.warning ?? null);
        setEditAiIdealStorage(r.idealStorage ?? null);
        if (r.category && r.idealStorage) {
          setCategoryCache(prev => ({ ...prev, [item.name]: { category: r.category!, idealStorage: r.idealStorage! } }));
        }
        setShelfLifeCache(prev => ({
          ...prev,
          [cacheKey]: { days: r.days, date: r.days > 0 ? makeExpiresAt(r.days) : '', warning: r.warning, idealStorage: r.idealStorage, category: r.category },
        }));
        setEditAiLoading(false);
      })
      .catch(() => {
        if (fetchRef.current !== id) return;
        const fallbackDays = editLocation === 'Tiefkühler' ? 180 : editLocation === 'Vorrat' ? 30 : 7;
        setEditAiDays(fallbackDays);
        setEditAiWarning(null);
        setEditAiIdealStorage(null);
        setShelfLifeCache(prev => ({ ...prev, [cacheKey]: { days: fallbackDays, date: makeExpiresAt(fallbackDays) } }));
        setEditAiLoading(false);
      });
  }, [editingId, editExpiryMode, editLocation, editOpened]);

  // Sync expiresAt live to items whenever AI days or manual date change
  useEffect(() => {
    if (!editingId) return;
    if (editExpiryMode === 'ai') {
      if (editAiDays == null) return;
      setItems(prev => prev.map(i =>
        i.id === editingId ? { ...i, expiresAt: makeExpiresAt(editAiDays) } : i,
      ));
    } else if (editExpiryMode === 'manual') {
      if (editDraftDate == null) return;
      setItems(prev => prev.map(i =>
        i.id === editingId ? { ...i, expiresAt: editDraftDate } : i,
      ));
    }
  }, [editingId, editExpiryMode, editAiDays, editDraftDate]);

  const openEdit = (item: CheckedItem) => {
    if (editingId === item.id) { setEditingId(null); return; }
    setEditingId(item.id);
    setEditName(item.name);
    setEditQuantityStr(String(item.editedQuantity ?? item.quantity));
    setEditUnit((item.editedUnit ?? item.unit) as EditUnit);
    setEditLocation(item.editedLocation ?? item.idealStorage ?? 'Kühlschrank');
    setEditOpened(item.editedOpened !== undefined ? item.editedOpened : (item.opened ?? null));
    setEditMode('ai');
    setEditAiDays(null);
    setEditAiWarning(null);
    setEditAiIdealStorage(null);
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
    // All fields already written live; only name needs commit here (avoids rewriting on every keystroke)
    if (editName.trim()) {
      setItems(prev => prev.map(i =>
        i.id === editingId ? { ...i, name: editName.trim(), manuallyEdited: true } : i,
      ));
    }
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
          location: i.editedLocation ?? i.idealStorage ?? 'Kühlschrank',
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
        <>
        <View style={styles.photoWrapper}>
          <Image source={{ uri: photo.uri }} style={styles.photo} resizeMode="contain" />

          {/* Tap-to-fullscreen overlay (below tags so tags stay interactive) */}
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => {
              if (openGroupId !== null) { setOpenGroupId(null); return; }
              setFullscreenOpen(true);
            }}
          />

          {loading && (
            <View style={styles.photoOverlay}>
              <ActivityIndicator color={ACCENT} size="large" />
              <Text style={styles.photoOverlayText}>Inhalt wird erkannt…</Text>
            </View>
          )}

          {!loading && (
            <>
              {/* SVG connector lines (clamped position → actual bounding box center) */}
              <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
                {tagGroups.map(group => {
                  if (group.items.length !== 1) return null;
                  const dx = Math.abs(group.cx - group.rawCx);
                  const dy = Math.abs(group.cy - group.rawCy);
                  if (dx < 2 && dy < 2) return null;
                  return (
                    <Line
                      key={group.id}
                      x1={`${group.cx}%`} y1={`${group.cy}%`}
                      x2={`${group.rawCx}%`} y2={`${group.rawCy}%`}
                      stroke={ACCENT} strokeWidth={1} opacity={0.6}
                    />
                  );
                })}
              </Svg>

              {/* Tag labels */}
              {tagGroups.map(group => {
                const isItemActive = group.items.some(i => i.id === editingId);
                const isDimmed = editingId !== null && !isItemActive;
                const isGroup = group.items.length > 1;
                const isGroupOpen = openGroupId === group.id;
                const color = isGroup ? '#2a2a2a' : (CAT_COLOR[group.items[0].category] ?? ACCENT);
                const bgColor = isItemActive ? ACCENT : color;
                const textColor = isItemActive ? '#0a0a0a' : (isGroup ? '#f0f0f0' : '#000');
                const activeItem = group.items.find(i => i.id === editingId);

                return (
                  <View
                    key={group.id}
                    style={[
                      styles.segLabel,
                      {
                        top: `${group.cy}%`,
                        left: `${group.cx}%`,
                        backgroundColor: bgColor,
                        borderWidth: isItemActive ? 2 : isGroupOpen ? 1 : 0,
                        borderColor: ACCENT,
                        opacity: isDimmed ? 0.4 : 1,
                      } as any,
                    ]}
                  >
                    <TouchableOpacity
                      onPress={() => isGroup ? setOpenGroupId(isGroupOpen ? null : group.id) : undefined}
                      activeOpacity={isGroup ? 0.8 : 1}
                    >
                      <Text style={[styles.segLabelText, { color: textColor }]} numberOfLines={1}>
                        {activeItem ? editName :
                         isGroup ? `${group.items.length} Produkte ▾` :
                         group.items[0].name}
                      </Text>
                    </TouchableOpacity>

                    {isGroup && isGroupOpen && (
                      <View style={styles.groupDropdown}>
                        {group.items.map((gItem, gIdx) => (
                          <TouchableOpacity
                            key={gItem.id}
                            style={[
                              styles.groupDropdownItem,
                              gIdx < group.items.length - 1 && styles.groupDropdownDivider,
                            ]}
                            onPress={() => { openEdit(gItem); setOpenGroupId(null); }}
                          >
                            <Text style={styles.groupDropdownText}>{gItem.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}
        </View>
        {!loading && (
          <Text style={styles.positionHint}>Positionen sind Schätzungen</Text>
        )}
        </>
      )}

      {/* Fullscreen photo modal */}
      {fullscreenOpen && !!photo.uri && (
        <FullscreenPhotoModal
          uri={photo.uri}
          tagGroups={tagGroups}
          onClose={() => setFullscreenOpen(false)}
        />
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
                        <Text style={[styles.itemName, !item.checked && styles.faded]}>
                          {isEditing ? editName : item.name}
                        </Text>
                        <Text style={styles.itemSub} numberOfLines={1}>
                          {formatQty(item)}
                          {item.isManual && <Text style={{ color: ACCENT }}>{' · '}✎ manuell</Text>}
                        </Text>
                        {!isEditing && !item.isManual && (
                          <Text style={item.manuallyEdited ? styles.manuallyEditedHint : styles.estimateHint}>
                            {item.manuallyEdited ? 'Manuell angepasst ✓' : 'KI-Schätzung · tippe zum Anpassen'}
                          </Text>
                        )}
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
                        {/* Name */}
                        <View style={styles.editField}>
                          <Text style={styles.editFieldLabel}>NAME</Text>
                          <TextInput
                            style={styles.nameEditInput}
                            value={editName}
                            onChangeText={setEditName}
                            onBlur={() => {
                              if (editingId && editName.trim()) {
                                setItems(prev => prev.map(i => i.id === editingId ? { ...i, name: editName.trim(), manuallyEdited: true } : i));
                              }
                            }}
                            returnKeyType="done"
                            autoCorrect={false}
                            selectTextOnFocus
                          />
                        </View>

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
                                setItems(prev => prev.map(i => i.id === editingId ? { ...i, editedQuantity: next, editedUnit: editUnit, manuallyEdited: true } : i));
                              }}
                              disabled={(Number(editQuantityStr) || 0) <= 0}
                              hitSlop={4}
                            >
                              <Text style={styles.stepBtnText}>−</Text>
                            </TouchableOpacity>

                            <TextInput
                              style={styles.stepInput}
                              value={editQuantityStr}
                              onChangeText={str => {
                                setEditQuantityStr(str);
                                const num = Math.max(1, Math.round(Number(str) || 1));
                                if (!isNaN(Number(str)) && Number(str) > 0) {
                                  setItems(prev => prev.map(i => i.id === editingId ? { ...i, editedQuantity: num, editedUnit: editUnit, manuallyEdited: true } : i));
                                }
                              }}
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
                                setItems(prev => prev.map(i => i.id === editingId ? { ...i, editedQuantity: next, editedUnit: editUnit, manuallyEdited: true } : i));
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
                                onPress={() => {
                                  setEditUnit(u);
                                  setItems(prev => prev.map(i => i.id === editingId ? { ...i, editedUnit: u, manuallyEdited: true } : i));
                                }}
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

                        {/* Location */}
                        <View style={styles.editField}>
                          <Text style={styles.editFieldLabel}>LAGERORT</Text>
                          <View style={styles.locationBtnRow}>
                            {LOCATIONS.map(loc => (
                              <TouchableOpacity
                                key={loc}
                                style={[styles.locationBtn, editLocation === loc && styles.locationBtnActive]}
                                onPress={() => {
                                  if (loc === editLocation) return;
                                  setEditLocation(loc);
                                  if (editExpiryMode === 'ai') setEditAiDays(null);
                                  setItems(prev => prev.map(i => i.id === editingId ? { ...i, editedLocation: loc, manuallyEdited: true } : i));
                                }}
                                activeOpacity={0.75}
                              >
                                <Text style={[styles.locationBtnText, editLocation === loc && styles.locationBtnTextActive]}>
                                  {loc}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>

                        {/* Zustand */}
                        <View style={styles.editField}>
                          <Text style={styles.editFieldLabel}>ZUSTAND</Text>
                          <View style={styles.locationBtnRow}>
                            {([false, true] as const).map(o => {
                              const isActive = o ? editOpened === true : editOpened !== true;
                              return (
                                <TouchableOpacity
                                  key={String(o)}
                                  style={[styles.locationBtn, isActive && styles.locationBtnActive]}
                                  onPress={() => {
                                    setEditOpened(o);
                                    if (editExpiryMode === 'ai') setEditAiDays(null);
                                    setItems(prev => prev.map(i => i.id === editingId ? { ...i, editedOpened: o, manuallyEdited: true } : i));
                                  }}
                                  activeOpacity={0.75}
                                >
                                  <Text style={[styles.locationBtnText, isActive && styles.locationBtnTextActive]}>
                                    {o ? 'Geöffnet' : 'Ungeöffnet'}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                          {item.opened === null && !item.isManual && (
                            <Text style={styles.zustandHint}>Nicht erkannt · Standard: Ungeöffnet</Text>
                          )}
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
                            <View style={[styles.aiCard, editAiWarning != null && styles.aiCardWarn]}>
                              {editAiLoading ? (
                                <View style={styles.aiLoadRow}>
                                  <ActivityIndicator size="small" color={ACCENT} />
                                  <Text style={styles.aiLoadText}>Richtwert wird ermittelt…</Text>
                                </View>
                              ) : editAiWarning ? (
                                <>
                                  <Text style={styles.aiLabelWarn}>⚠ Ungeeigneter Lagerort</Text>
                                  <Text style={styles.aiWarningText}>Nicht zur Lagerung hier geeignet.</Text>
                                  {editAiIdealStorage && (
                                    <Text style={styles.aiIdealStorageText}>Empfehlung: {editAiIdealStorage}</Text>
                                  )}
                                </>
                              ) : (
                                <>
                                  <Text style={styles.aiLabel} numberOfLines={1} ellipsizeMode="tail">
                                    ✦ Richtwert · {editLocation}
                                  </Text>
                                  {editAiDays != null && editAiDays > 0 && (
                                    <View style={styles.aiBottomRow}>
                                      <Text style={styles.aiUntil} numberOfLines={1}>
                                        bis {formatDate(makeExpiresAt(editAiDays))}
                                      </Text>
                                      <Text style={styles.aiDays}>~{editAiDays} Tage</Text>
                                    </View>
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
                          <Text style={styles.confirmBtnText}>Fertig</Text>
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

// ─── Fullscreen Photo Modal ────────────────────────────────────

function FullscreenPhotoModal({
  uri,
  tagGroups,
  onClose,
}: {
  uri: string;
  tagGroups: TagGroup[];
  onClose: () => void;
}) {
  const pinchScale = useRef(new Animated.Value(1)).current;
  const baseScale  = useRef(new Animated.Value(1)).current;
  const lastScale  = useRef(1);
  const compositeScale = Animated.multiply(pinchScale, baseScale);

  const onPinchGesture = Animated.event(
    [{ nativeEvent: { scale: pinchScale } }],
    { useNativeDriver: true },
  );

  const onPinchStateChange = ({ nativeEvent }: any) => {
    if (nativeEvent.oldState === State.ACTIVE) {
      const next = Math.max(1, Math.min(5, lastScale.current * nativeEvent.scale));
      lastScale.current = next;
      baseScale.setValue(next);
      pinchScale.setValue(1);
    }
  };

  return (
    <Modal
      visible
      animationType="slide"
      statusBarTranslucent
      transparent={false}
      onRequestClose={onClose}
    >
      <StatusBar hidden />
      <View style={fsStyles.container}>
        <PinchGestureHandler
          onGestureEvent={onPinchGesture}
          onHandlerStateChange={onPinchStateChange}
        >
          <Animated.View style={[fsStyles.imgWrap, { transform: [{ scale: compositeScale }] }]}>
            <Image source={{ uri }} style={fsStyles.img} resizeMode="contain" />
          </Animated.View>
        </PinchGestureHandler>

        {/* Tag overlays at bounding box positions */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {tagGroups.map(group => {
            const isGroup = group.items.length > 1;
            const color = isGroup
              ? '#2a2a2a'
              : (CAT_COLOR[group.items[0].category] ?? ACCENT);
            return (
              <View
                key={group.id}
                style={[
                  styles.segLabel,
                  {
                    top: `${group.cy}%`,
                    left: `${group.cx}%`,
                    backgroundColor: color,
                  } as any,
                ]}
              >
                <Text
                  style={[styles.segLabelText, { color: isGroup ? '#f0f0f0' : '#000' }]}
                  numberOfLines={1}
                >
                  {isGroup
                    ? `${group.items.length} Produkte`
                    : group.items[0].name}
                </Text>
              </View>
            );
          })}
        </View>

        <SafeAreaView style={fsStyles.topBar} edges={['top']}>
          <TouchableOpacity style={fsStyles.closeBtn} onPress={onClose} hitSlop={12}>
            <Text style={fsStyles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </SafeAreaView>

        <View style={fsStyles.hintBar}>
          <Text style={fsStyles.hintText}>Zusammenkneifen zum Zoomen</Text>
          <Text style={fsStyles.positionHintText}>Positionen sind Schätzungen</Text>
        </View>
      </View>
    </Modal>
  );
}

const fsStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  imgWrap:   { flex: 1 },
  img:       { flex: 1, width: '100%', height: '100%' },
  topBar:    { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16 },
  closeBtn: {
    alignSelf: 'flex-end', marginTop: 12,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { fontSize: 16, color: '#f0f0f0', fontWeight: '700' },
  hintBar: { position: 'absolute', bottom: 32, left: 0, right: 0, alignItems: 'center', gap: 4 },
  hintText: { fontSize: 12, color: 'rgba(255,255,255,0.35)', fontWeight: '500' },
  positionHintText: { fontSize: 11, color: '#666666' },
});

// ─── Styles ───────────────────────────────────────────────────

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
  segLabel: { position: 'absolute', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, maxWidth: 120 },
  segLabelText: { fontSize: 10, color: '#000', fontWeight: '700' },
  groupDropdown: {
    position: 'absolute', top: '100%', left: 0,
    backgroundColor: '#1a1a1a', borderRadius: 8,
    borderWidth: 0.5, borderColor: '#333',
    minWidth: 130, marginTop: 3, zIndex: 99,
    overflow: 'hidden',
  },
  groupDropdownItem: { paddingHorizontal: 10, paddingVertical: 8 },
  groupDropdownDivider: { borderBottomWidth: 0.5, borderBottomColor: '#2a2a2a' },
  groupDropdownText: { fontSize: 11, color: '#f0f0f0', fontWeight: '600' },

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
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  itemRowBorder: { height: 0.5, backgroundColor: '#1a1a1a', marginHorizontal: 14 },
  checkbox: {
    width: 22, height: 22, borderRadius: 7, borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    marginTop: 1,
  },
  checkmark: { fontSize: 11, color: '#000', fontWeight: '800' },
  glyph: { width: 34, height: 34, borderRadius: 10, borderWidth: 0.5, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  glyphText: { fontSize: 14, fontWeight: '700' },
  itemName: { fontSize: 14, fontWeight: '500', color: '#fff', letterSpacing: -0.1 },
  faded: { opacity: 0.3 },
  itemSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },

  editBtn: {
    width: 30, height: 30, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
  },
  editBtnActive: { backgroundColor: `${ACCENT}20` },
  editBtnIcon: { fontSize: 16, color: 'rgba(255,255,255,0.45)' },
  editBtnIconActive: { color: ACCENT },

  editPanel: {
    backgroundColor: '#181818', borderTopWidth: 0.5, borderTopColor: '#222222',
    paddingHorizontal: 14, paddingVertical: 14, gap: 14,
  },
  nameEditInput: {
    backgroundColor: '#111111',
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: '#222222',
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: '#f0f0f0',
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
  estimateHint: { fontSize: 11, color: '#666666', marginTop: 1 },
  manuallyEditedHint: { fontSize: 11, color: '#26de81', marginTop: 1 },
  positionHint: { fontSize: 11, color: '#666666', textAlign: 'center', paddingVertical: 4 },

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
    borderRadius: 12, borderWidth: 0.5, borderColor: 'rgba(200,255,0,0.12)',
    padding: 14, gap: 4, width: '100%', overflow: 'hidden',
  },
  aiLoadRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  aiLoadText: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  aiCardWarn: { backgroundColor: 'rgba(247,79,79,0.07)', borderColor: 'rgba(247,79,79,0.25)' },
  aiLabel: { fontSize: 10, fontWeight: '700', color: ACCENT, letterSpacing: 1, textTransform: 'uppercase', flexShrink: 1 },
  aiLabelWarn: { fontSize: 10, fontWeight: '700', color: '#F74F4F', letterSpacing: 1, textTransform: 'uppercase' },
  aiWarningText: { fontSize: 12, color: '#F74F4F', lineHeight: 18, fontWeight: '500' },
  aiIdealStorageText: { fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 4, fontWeight: '500' },
  aiBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', width: '100%' },
  aiUntil: { fontSize: 11, color: 'rgba(255,255,255,0.3)', flexShrink: 1 },
  aiDays: { fontSize: 26, fontWeight: '800', color: '#fff', letterSpacing: -1, lineHeight: 30, flexShrink: 0 },

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

  zustandHint: { fontSize: 10, color: '#666666', marginTop: 2 },
  locationBtnRow: { flexDirection: 'row', gap: 6 },
  locationBtn: {
    flex: 1, backgroundColor: '#222222', borderRadius: 8,
    paddingVertical: 9, alignItems: 'center', justifyContent: 'center',
  },
  locationBtnActive: { backgroundColor: ACCENT },
  locationBtnText: { fontSize: 11, fontWeight: '700', color: '#666666' },
  locationBtnTextActive: { color: '#0a0a0a' },

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
