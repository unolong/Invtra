import DateTimePicker from '@react-native-community/datetimepicker';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

import { type InventoryLocation } from '@/context/inventory-context';
import { estimateShelfLife } from '@/services/anthropic';

const ACCENT = '#c8ff00';

const EXPIRY_CHIPS = [
  { label: '1T',  days: 1  },
  { label: '3T',  days: 3  },
  { label: '7T',  days: 7  },
  { label: '14T', days: 14 },
  { label: '1M',  days: 30 },
] as const;

const UNITS = ['g', 'kg', 'ml', 'L', 'Stück', 'Packung', 'Dose'] as const;
type Unit = typeof UNITS[number];

const LOCATION_META: Record<InventoryLocation, { icon: string; temp: string }> = {
  Kühlschrank: { icon: '🧊', temp: '2–8°C' },
  Vorrat:      { icon: '🏠', temp: 'Zimmertemp.' },
  Tiefkühler:  { icon: '❄️', temp: '−18°C' },
};

export interface MacroInfo {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface Props {
  visible: boolean;
  productName: string;
  macros?: MacroInfo;
  initialQty?: string;
  onClose: () => void;
  onAdd: (data: {
    qty: string;
    location: InventoryLocation;
    expiresAt: string | null;
  }) => void | Promise<void>;
}

function makeExpiresAt(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return [
    String(d.getDate()).padStart(2, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    d.getFullYear(),
  ].join('.');
}

function daysFromToday(iso: string | null): number | null {
  if (!iso) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(iso); target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export default function ItemDetailSheet({
  visible, productName, macros, initialQty, onClose, onAdd,
}: Props) {
  const [qtyAmount, setQtyAmount]       = useState('100');
  const [unit, setUnit]                 = useState<Unit>('g');
  const [unitMenuVisible, setUnitMenu]  = useState(false);
  const [location, setLocation]         = useState<InventoryLocation>('Kühlschrank');
  const [expiryMode, setExpiryMode]     = useState<'ai' | 'manual'>('ai');
  const [aiDays, setAiDays]             = useState<number | null>(null);
  const [aiWarning, setAiWarning]       = useState<string | undefined>(undefined);
  const [aiLoading, setAiLoading]       = useState(false);
  const [draftDate, setDraftDate]       = useState<string | null>(null);
  const [showDatePicker, setShowPicker] = useState(false);
  const [saving, setSaving]             = useState(false);
  const fetchRef = useRef(0);

  // Reset state when sheet opens for a new product
  useEffect(() => {
    if (!visible) return;
    const numStr = initialQty?.match(/[\d.]+/)?.[0] ?? '100';
    setQtyAmount(numStr);
    if (initialQty?.toLowerCase().includes('ml')) setUnit('ml');
    else if (initialQty?.toLowerCase().includes('kg')) setUnit('kg');
    else setUnit('g');
    setLocation('Kühlschrank');
    setExpiryMode('ai');
    setDraftDate(null);
    setShowPicker(false);
    setAiDays(null);
    setAiWarning(undefined);
    setSaving(false);
  }, [visible, productName]);

  // Fetch AI shelf life when mode=ai and location/product changes
  useEffect(() => {
    if (!visible || !productName || expiryMode !== 'ai') return;
    const id = ++fetchRef.current;
    setAiLoading(true);
    setAiDays(null);
    setAiWarning(undefined);
    estimateShelfLife(productName, location)
      .then(r => {
        if (fetchRef.current !== id) return;
        setAiDays(r.days);
        setAiWarning(r.warning);
        setAiLoading(false);
      })
      .catch(() => {
        if (fetchRef.current !== id) return;
        setAiDays(7);
        setAiLoading(false);
      });
  }, [visible, productName, location, expiryMode]);

  const activeChip = daysFromToday(draftDate);

  const handleAdd = async () => {
    if (saving) return;
    setSaving(true);
    let expiresAt: string | null = null;
    if (expiryMode === 'ai' && aiDays) expiresAt = makeExpiresAt(aiDays);
    else if (expiryMode === 'manual' && draftDate) expiresAt = draftDate;
    await onAdd({ qty: `${qtyAmount.trim() || '1'} ${unit}`, location, expiresAt });
    setSaving(false);
  };

  const shortName = productName.split(' ').slice(0, 4).join(' ');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={s.sheetWrap}
        >
          <View style={s.sheet}>
            <View style={s.handle} />

            <ScrollView
              contentContainerStyle={s.scroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Product name */}
              <Text style={s.productName} numberOfLines={2}>{productName}</Text>

              {/* Macros (barcode only) */}
              {macros && (
                <>
                  <View style={s.macroPills}>
                    <MacroPill label="kcal" value={String(Math.round(macros.kcal))} color="#fff" />
                    <MacroPill label="P" value={`${macros.protein.toFixed(1)}g`} color="#4f8bff" />
                    <MacroPill label="K" value={`${macros.carbs.toFixed(1)}g`} color="#ffb547" />
                    <MacroPill label="F" value={`${macros.fat.toFixed(1)}g`} color="#ff5e5e" />
                  </View>
                  <Text style={s.per100}>Pro 100g</Text>
                </>
              )}

              {/* Menge */}
              <View style={s.field}>
                <Text style={s.fieldLabel}>MENGE</Text>
                <View style={s.qtyRow}>
                  <TextInput
                    style={[s.input, { flex: 1 }]}
                    value={qtyAmount}
                    onChangeText={setQtyAmount}
                    placeholder="100"
                    placeholderTextColor="rgba(255,255,255,0.2)"
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                  />
                  <TouchableOpacity style={s.unitBtn} onPress={() => setUnitMenu(true)} activeOpacity={0.75}>
                    <Text style={s.unitBtnText}>{unit}</Text>
                    <Text style={s.unitBtnChevron}>▾</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Lagerort */}
              <View style={s.field}>
                <Text style={s.fieldLabel}>LAGERORT</Text>
                <View style={s.locationRow}>
                  {(['Kühlschrank', 'Vorrat', 'Tiefkühler'] as InventoryLocation[]).map(loc => (
                    <TouchableOpacity
                      key={loc}
                      style={[s.locationCard, location === loc && s.locationCardActive]}
                      onPress={() => setLocation(loc)}
                      activeOpacity={0.75}
                    >
                      <Text style={s.locationIcon}>{LOCATION_META[loc].icon}</Text>
                      <Text style={[s.locationName, location === loc && s.locationNameActive]} numberOfLines={1}>
                        {loc}
                      </Text>
                      <Text style={[s.locationTemp, location === loc && s.locationTempActive]}>
                        {LOCATION_META[loc].temp}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Haltbarkeit */}
              <View style={s.field}>
                <Text style={s.fieldLabel}>HALTBARKEIT</Text>
                <View style={s.segControl}>
                  {(['ai', 'manual'] as const).map(m => (
                    <TouchableOpacity
                      key={m}
                      style={[s.segOpt, expiryMode === m && s.segOptActive]}
                      onPress={() => setExpiryMode(m)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.segOptText, expiryMode === m && s.segOptTextActive]}>
                        {m === 'ai' ? 'AI-Schätzung' : 'Manuell'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {expiryMode === 'ai' && (
                  <View style={s.aiCard}>
                    {aiLoading ? (
                      <View style={s.aiLoadRow}>
                        <ActivityIndicator size="small" color={ACCENT} />
                        <Text style={s.aiLoadText}>Wird geschätzt…</Text>
                      </View>
                    ) : (
                      <>
                        <View style={s.aiTopRow}>
                          <Text style={s.aiLabel}>✦ KI-Schätzung</Text>
                          {aiDays != null && (
                            <Text style={s.aiUntil}>bis {formatDate(makeExpiresAt(aiDays))}</Text>
                          )}
                        </View>
                        {aiDays != null && (
                          <Text style={s.aiDays}>~{aiDays} Tage</Text>
                        )}
                        {aiWarning && <Text style={s.aiWarning}>⚠️ {aiWarning}</Text>}
                      </>
                    )}
                  </View>
                )}

                {expiryMode === 'manual' && (
                  <View style={s.manualSection}>
                    <TouchableOpacity
                      style={s.dateField}
                      onPress={() => setShowPicker(v => !v)}
                      activeOpacity={0.8}
                    >
                      <Text style={{ fontSize: 16 }}>📅</Text>
                      <Text style={s.dateText}>{formatDate(draftDate)}</Text>
                      <View style={{ flex: 1 }} />
                      <Text style={s.dateChevron}>{showDatePicker ? '▲' : '▼'}</Text>
                    </TouchableOpacity>

                    {showDatePicker && Platform.OS === 'ios' && (
                      <View style={s.iosPickerWrap}>
                        <DateTimePicker
                          value={draftDate ? new Date(draftDate) : new Date()}
                          mode="date"
                          display="inline"
                          themeVariant="dark"
                          onChange={(_, date) => {
                            if (date) {
                              const d = new Date(date);
                              d.setHours(0, 0, 0, 0);
                              setDraftDate(d.toISOString());
                            }
                          }}
                          style={{ height: 320, backgroundColor: '#111111' }}
                        />
                      </View>
                    )}
                    {showDatePicker && Platform.OS === 'android' && (
                      <DateTimePicker
                        value={draftDate ? new Date(draftDate) : new Date()}
                        mode="date"
                        display="default"
                        onChange={(event, date) => {
                          setShowPicker(false);
                          if (event.type === 'set' && date) {
                            const d = new Date(date);
                            d.setHours(0, 0, 0, 0);
                            setDraftDate(d.toISOString());
                          }
                        }}
                      />
                    )}

                    <View style={s.chipRow}>
                      {EXPIRY_CHIPS.map(c => (
                        <TouchableOpacity
                          key={c.label}
                          style={[s.expiryChip, activeChip === c.days && s.expiryChipActive]}
                          onPress={() => setDraftDate(makeExpiresAt(c.days))}
                          activeOpacity={0.75}
                        >
                          <Text style={[s.expiryChipText, activeChip === c.days && s.expiryChipTextActive]}>
                            {c.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
              </View>

              {/* CTA */}
              <TouchableOpacity
                style={[s.ctaBtn, saving && { opacity: 0.6 }]}
                onPress={handleAdd}
                disabled={saving}
                activeOpacity={0.85}
              >
                <Text style={s.ctaBtnText} numberOfLines={1}>
                  {saving
                    ? 'Wird hinzugefügt…'
                    : `${shortName} ins ${location} hinzufügen`}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>

      {/* Unit dropdown */}
      <Modal visible={unitMenuVisible} transparent animationType="fade" onRequestClose={() => setUnitMenu(false)}>
        <TouchableOpacity style={s.unitOverlay} onPress={() => setUnitMenu(false)} activeOpacity={1}>
          <TouchableOpacity style={s.unitBox} activeOpacity={1}>
            <Text style={s.unitBoxTitle}>Einheit wählen</Text>
            {UNITS.map(u => (
              <TouchableOpacity
                key={u}
                style={[s.unitRow, unit === u && s.unitRowActive]}
                onPress={() => { setUnit(u); setUnitMenu(false); }}
              >
                <Text style={[s.unitRowText, unit === u && s.unitRowTextActive]}>{u}</Text>
                {unit === u && <Text style={s.unitCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </Modal>
  );
}

function MacroPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={s.macroPill}>
      <Text style={[s.macroPillValue, { color }]}>{value}</Text>
      <Text style={s.macroPillLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheetWrap: { maxHeight: '92%' },
  sheet: {
    backgroundColor: '#111111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 0.5,
    borderColor: '#222222',
    overflow: 'hidden',
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },
  scroll: { padding: 20, paddingBottom: 36, gap: 18 },

  productName: {
    fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: -0.6, lineHeight: 28,
  },

  macroPills: { flexDirection: 'row', gap: 8 },
  macroPill: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10, borderWidth: 0.5, borderColor: '#222222',
    padding: 10, alignItems: 'center', gap: 2,
  },
  macroPillValue: { fontSize: 15, fontWeight: '700', letterSpacing: -0.3 },
  macroPillLabel: { fontSize: 10, color: 'rgba(255,255,255,0.4)' },
  per100: { fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center', marginTop: -10 },

  field: { gap: 10 },
  fieldLabel: {
    fontSize: 10, fontWeight: '700',
    color: 'rgba(255,255,255,0.35)', letterSpacing: 1, textTransform: 'uppercase',
  },

  qtyRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    backgroundColor: '#181818', borderRadius: 14, borderWidth: 0.5,
    borderColor: '#222222', paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, color: '#fff', fontWeight: '500',
  },
  unitBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#181818', borderRadius: 14,
    borderWidth: 0.5, borderColor: '#222222',
    paddingHorizontal: 16, paddingVertical: 14, minWidth: 84,
  },
  unitBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  unitBtnChevron: { fontSize: 10, color: 'rgba(255,255,255,0.35)' },

  locationRow: { flexDirection: 'row', gap: 8 },
  locationCard: {
    flex: 1, backgroundColor: '#181818', borderRadius: 14,
    borderWidth: 0.5, borderColor: '#222222',
    paddingVertical: 12, paddingHorizontal: 8,
    alignItems: 'center', gap: 4,
  },
  locationCardActive: { backgroundColor: `${ACCENT}15`, borderColor: ACCENT },
  locationIcon: { fontSize: 20 },
  locationName: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)', textAlign: 'center' },
  locationNameActive: { color: ACCENT },
  locationTemp: { fontSize: 10, color: 'rgba(255,255,255,0.3)', textAlign: 'center' },
  locationTempActive: { color: `${ACCENT}99` },

  segControl: {
    flexDirection: 'row', backgroundColor: '#181818',
    borderRadius: 10, borderWidth: 0.5, borderColor: '#222222', padding: 3, gap: 3,
  },
  segOpt: {
    flex: 1, paddingVertical: 9, borderRadius: 7,
    alignItems: 'center', justifyContent: 'center',
  },
  segOptActive: { backgroundColor: '#fff' },
  segOptText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.4)' },
  segOptTextActive: { color: '#000' },

  aiCard: {
    backgroundColor: 'rgba(200,255,0,0.04)',
    borderRadius: 14, borderWidth: 0.5,
    borderColor: 'rgba(200,255,0,0.12)', padding: 16, gap: 5,
  },
  aiLoadRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  aiLoadText: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  aiTopRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 2,
  },
  aiLabel: {
    fontSize: 10, fontWeight: '700', color: ACCENT,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  aiUntil: { fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: '500' },
  aiDays: { fontSize: 30, fontWeight: '800', color: '#fff', letterSpacing: -1.5, lineHeight: 34 },
  aiWarning: { fontSize: 12, color: '#ffb547', marginTop: 4 },

  manualSection: { gap: 10 },
  dateField: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#181818', borderRadius: 12,
    borderWidth: 0.5, borderColor: '#222222', padding: 13,
  },
  dateText: { fontSize: 15, fontWeight: '700', color: '#fff', letterSpacing: -0.2 },
  dateChevron: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  iosPickerWrap: { marginHorizontal: -30, transform: [{ scale: 0.9 }], marginVertical: -16 },

  chipRow: { flexDirection: 'row', gap: 6 },
  expiryChip: {
    flex: 1, paddingVertical: 9, borderRadius: 9,
    backgroundColor: '#181818', borderWidth: 0.5, borderColor: '#222222',
    alignItems: 'center',
  },
  expiryChipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  expiryChipText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.45)' },
  expiryChipTextActive: { color: '#000' },

  ctaBtn: {
    backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
  },
  ctaBtnText: { color: '#000', fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },

  unitOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center',
  },
  unitBox: {
    backgroundColor: '#181818', borderRadius: 20,
    borderWidth: 0.5, borderColor: '#2a2a2a',
    paddingVertical: 8, width: 220, overflow: 'hidden',
  },
  unitBoxTitle: {
    fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.3)',
    letterSpacing: 0.8, textTransform: 'uppercase',
    textAlign: 'center', paddingVertical: 10,
  },
  unitRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 13,
  },
  unitRowActive: { backgroundColor: `${ACCENT}12` },
  unitRowText: { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  unitRowTextActive: { color: ACCENT },
  unitCheck: { fontSize: 14, color: ACCENT, fontWeight: '800' },
});
