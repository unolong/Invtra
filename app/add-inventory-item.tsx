import DateTimePicker from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

import { type InventoryLocation, useInventory } from '@/context/inventory-context';
import { estimateShelfLife } from '@/services/anthropic';

const ACCENT = '#c8ff00';

type InvUnit = 'g' | 'kg' | 'ml' | 'L' | 'Stück' | 'Packung' | 'Dose';
const INV_UNITS: InvUnit[] = ['g', 'kg', 'ml', 'L', 'Stück', 'Packung', 'Dose'];

const CATEGORIES = [
  { key: 'protein',   label: 'Protein',   color: '#4f8bff' },
  { key: 'gemüse',    label: 'Gemüse',    color: '#26de81' },
  { key: 'obst',      label: 'Obst',      color: '#ff7a4d' },
  { key: 'milch',     label: 'Milch',     color: '#a78bff' },
  { key: 'carbs',     label: 'Carbs',     color: '#ffb547' },
  { key: 'fett',      label: 'Fett',      color: '#F74F4F' },
  { key: 'sonstiges', label: 'Sonst.',    color: 'rgba(255,255,255,0.45)' },
] as const;

const LOCATIONS: InventoryLocation[] = ['Kühlschrank', 'Vorrat', 'Tiefkühler'];
const LOCATION_META: Record<InventoryLocation, { icon: string; temp: string }> = {
  Kühlschrank: { icon: '🧊', temp: '2–8°C' },
  Vorrat:      { icon: '🏠', temp: 'Zimmertemp.' },
  Tiefkühler:  { icon: '❄️', temp: '−18°C' },
};

const EXPIRY_CHIPS = [
  { label: '1T',  days: 1  },
  { label: '3T',  days: 3  },
  { label: '7T',  days: 7  },
  { label: '14T', days: 14 },
  { label: '1M',  days: 30 },
] as const;

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

export default function AddInventoryItemScreen() {
  const { addItems } = useInventory();

  const [name, setName]                   = useState('');
  const [qtyAmount, setQtyAmount]         = useState('');
  const [selectedUnit, setSelectedUnit]   = useState<InvUnit>('g');
  const [unitMenuVisible, setUnitMenu]    = useState(false);
  const [cat, setCat]                     = useState('sonstiges');
  const [location, setLocation]           = useState<InventoryLocation>('Kühlschrank');
  const [expiryMode, setExpiryMode]       = useState<'ai' | 'manual'>('ai');
  const [aiDays, setAiDays]               = useState<number | null>(null);
  const [aiWarning, setAiWarning]         = useState<string | undefined>(undefined);
  const [aiLoading, setAiLoading]         = useState(false);
  const [draftDate, setDraftDate]         = useState<string | null>(null);
  const [showDatePicker, setShowPicker]   = useState(false);
  const [saving, setSaving]               = useState(false);

  const fetchRef = useRef(0);

  // Fetch AI shelf life when name (debounced) or location changes
  useEffect(() => {
    const trimmed = name.trim();
    if (!trimmed || expiryMode !== 'ai') return;
    const id = ++fetchRef.current;
    const timer = setTimeout(async () => {
      setAiLoading(true);
      setAiDays(null);
      setAiWarning(undefined);
      try {
        const r = await estimateShelfLife(trimmed, location);
        if (fetchRef.current !== id) return;
        setAiDays(r.days);
        setAiWarning(r.warning);
      } catch {
        if (fetchRef.current !== id) return;
        setAiDays(7);
      } finally {
        if (fetchRef.current === id) setAiLoading(false);
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [name, location, expiryMode]);

  const canSave = name.trim().length > 0;
  const activeChip = daysFromToday(draftDate);

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      let expiresAt: string | null = null;
      if (expiryMode === 'ai' && aiDays) expiresAt = makeExpiresAt(aiDays);
      else if (expiryMode === 'manual' && draftDate) expiresAt = draftDate;

      await addItems([{
        name: name.trim(),
        qty: qtyAmount.trim() ? `${qtyAmount.trim()} ${selectedUnit}` : `1 ${selectedUnit}`,
        cat,
        location,
        expiresAt,
      }]);
      router.back();
    } catch {
      Alert.alert('Fehler', 'Artikel konnte nicht gespeichert werden.');
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        <View style={st.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={st.cancel}>Abbrechen</Text>
          </TouchableOpacity>
          <Text style={st.title}>Artikel hinzufügen</Text>
          <TouchableOpacity onPress={handleSave} disabled={!canSave || saving} hitSlop={12}>
            <Text style={[st.save, (!canSave || saving) && st.saveDisabled]}>Speichern</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={st.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Name */}
          <View style={st.field}>
            <Text style={st.fieldLabel}>PRODUKTNAME</Text>
            <TextInput
              style={st.input}
              value={name}
              onChangeText={setName}
              placeholder="z.B. Hähnchenbrust"
              placeholderTextColor="rgba(255,255,255,0.2)"
              autoFocus
              returnKeyType="next"
            />
          </View>

          {/* Menge */}
          <View style={st.field}>
            <Text style={st.fieldLabel}>MENGE</Text>
            <View style={st.qtyRow}>
              <TextInput
                style={[st.input, { flex: 1 }]}
                value={qtyAmount}
                onChangeText={setQtyAmount}
                placeholder="100"
                placeholderTextColor="rgba(255,255,255,0.2)"
                keyboardType="decimal-pad"
                returnKeyType="next"
              />
              <TouchableOpacity style={st.unitBtn} onPress={() => setUnitMenu(true)} activeOpacity={0.75}>
                <Text style={st.unitBtnText}>{selectedUnit}</Text>
                <Text style={st.unitBtnChevron}>▾</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Kategorie */}
          <View style={st.field}>
            <Text style={st.fieldLabel}>KATEGORIE</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={st.chipScrollRow}
            >
              {CATEGORIES.map(c => (
                <TouchableOpacity
                  key={c.key}
                  style={[st.chip, cat === c.key && { backgroundColor: c.color, borderColor: c.color }]}
                  onPress={() => setCat(c.key)}
                  activeOpacity={0.75}
                >
                  <Text style={[st.chipText, cat === c.key && { color: '#000' }]}>{c.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Lagerort */}
          <View style={st.field}>
            <Text style={st.fieldLabel}>LAGERORT</Text>
            <View style={st.locationRow}>
              {LOCATIONS.map(loc => (
                <TouchableOpacity
                  key={loc}
                  style={[st.locationCard, location === loc && st.locationCardActive]}
                  onPress={() => setLocation(loc)}
                  activeOpacity={0.75}
                >
                  <Text style={st.locationIcon}>{LOCATION_META[loc].icon}</Text>
                  <Text style={[st.locationName, location === loc && st.locationNameActive]} numberOfLines={1}>
                    {loc}
                  </Text>
                  <Text style={[st.locationTemp, location === loc && st.locationTempActive]}>
                    {LOCATION_META[loc].temp}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Haltbarkeit */}
          <View style={st.field}>
            <Text style={st.fieldLabel}>HALTBARKEIT</Text>
            <View style={st.segControl}>
              {(['ai', 'manual'] as const).map(m => (
                <TouchableOpacity
                  key={m}
                  style={[st.segOpt, expiryMode === m && st.segOptActive]}
                  onPress={() => setExpiryMode(m)}
                  activeOpacity={0.8}
                >
                  <Text style={[st.segOptText, expiryMode === m && st.segOptTextActive]}>
                    {m === 'ai' ? 'AI-Schätzung' : 'Manuell'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {expiryMode === 'ai' && (
              <View style={st.aiCard}>
                {!name.trim() ? (
                  <Text style={st.aiHint}>Produktname eingeben um eine Schätzung zu erhalten</Text>
                ) : aiLoading ? (
                  <View style={st.aiLoadRow}>
                    <ActivityIndicator size="small" color={ACCENT} />
                    <Text style={st.aiLoadText}>Wird geschätzt…</Text>
                  </View>
                ) : (
                  <>
                    <View style={st.aiTopRow}>
                      <Text style={st.aiLabel}>✦ KI-Schätzung</Text>
                      {aiDays != null && (
                        <Text style={st.aiUntil}>bis {formatDate(makeExpiresAt(aiDays))}</Text>
                      )}
                    </View>
                    {aiDays != null && <Text style={st.aiDays}>~{aiDays} Tage</Text>}
                    {aiWarning && <Text style={st.aiWarning}>⚠️ {aiWarning}</Text>}
                  </>
                )}
              </View>
            )}

            {expiryMode === 'manual' && (
              <View style={st.manualSection}>
                <TouchableOpacity
                  style={st.dateField}
                  onPress={() => setShowPicker(v => !v)}
                  activeOpacity={0.8}
                >
                  <Text style={{ fontSize: 16 }}>📅</Text>
                  <Text style={st.dateText}>{formatDate(draftDate)}</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={st.dateChevron}>{showDatePicker ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                {showDatePicker && Platform.OS === 'ios' && (
                  <View style={st.iosPickerWrap}>
                    <DateTimePicker
                      value={draftDate ? new Date(draftDate) : new Date()}
                      mode="date"
                      display="inline"
                      themeVariant="dark"
                      onChange={(_, date) => {
                        if (date) { const d = new Date(date); d.setHours(0,0,0,0); setDraftDate(d.toISOString()); }
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
                      if (event.type === 'set' && date) { const d = new Date(date); d.setHours(0,0,0,0); setDraftDate(d.toISOString()); }
                    }}
                  />
                )}

                <View style={st.chipRow}>
                  {EXPIRY_CHIPS.map(c => (
                    <TouchableOpacity
                      key={c.label}
                      style={[st.expiryChip, activeChip === c.days && st.expiryChipActive]}
                      onPress={() => setDraftDate(makeExpiresAt(c.days))}
                      activeOpacity={0.75}
                    >
                      <Text style={[st.expiryChipText, activeChip === c.days && st.expiryChipTextActive]}>
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
            style={[st.saveBtn, !canSave && st.saveBtnDisabled]}
            onPress={handleSave}
            disabled={!canSave || saving}
            activeOpacity={0.85}
          >
            <Text style={st.saveBtnText}>
              {saving ? 'Wird gespeichert…' : 'Artikel hinzufügen'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Unit dropdown */}
      <Modal visible={unitMenuVisible} transparent animationType="fade" onRequestClose={() => setUnitMenu(false)}>
        <TouchableOpacity style={st.unitOverlay} onPress={() => setUnitMenu(false)} activeOpacity={1}>
          <TouchableOpacity style={st.unitBox} activeOpacity={1}>
            <Text style={st.unitBoxTitle}>Einheit wählen</Text>
            {INV_UNITS.map(u => (
              <TouchableOpacity
                key={u}
                style={[st.unitRow, selectedUnit === u && st.unitRowActive]}
                onPress={() => { setSelectedUnit(u); setUnitMenu(false); }}
              >
                <Text style={[st.unitRowText, selectedUnit === u && st.unitRowTextActive]}>{u}</Text>
                {selectedUnit === u && <Text style={st.unitCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 0.5, borderBottomColor: '#222222',
  },
  cancel: { fontSize: 15, color: 'rgba(255,255,255,0.45)', fontWeight: '500', width: 80 },
  title:  { fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  save:   { fontSize: 15, color: ACCENT, fontWeight: '700', width: 80, textAlign: 'right' },
  saveDisabled: { opacity: 0.3 },

  scroll: { padding: 20, gap: 22, paddingBottom: 40 },

  field: { gap: 10 },
  fieldLabel: {
    fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.35)', letterSpacing: 1,
  },
  input: {
    backgroundColor: '#111111', borderRadius: 14, borderWidth: 0.5, borderColor: '#222222',
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: '#fff', fontWeight: '500',
  },

  qtyRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  unitBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#111111', borderRadius: 14, borderWidth: 0.5, borderColor: '#222222',
    paddingHorizontal: 16, paddingVertical: 14, minWidth: 84,
  },
  unitBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  unitBtnChevron: { fontSize: 10, color: 'rgba(255,255,255,0.35)' },

  chipScrollRow: { gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
    backgroundColor: '#111111', borderWidth: 0.5, borderColor: '#222222',
  },
  chipText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },

  locationRow: { flexDirection: 'row', gap: 8 },
  locationCard: {
    flex: 1, backgroundColor: '#111111', borderRadius: 14,
    borderWidth: 0.5, borderColor: '#222222',
    paddingVertical: 14, paddingHorizontal: 8,
    alignItems: 'center', gap: 4,
  },
  locationCardActive: { backgroundColor: `${ACCENT}15`, borderColor: ACCENT },
  locationIcon: { fontSize: 22 },
  locationName: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.6)', textAlign: 'center' },
  locationNameActive: { color: ACCENT },
  locationTemp: { fontSize: 10, color: 'rgba(255,255,255,0.3)', textAlign: 'center' },
  locationTempActive: { color: `${ACCENT}99` },

  segControl: {
    flexDirection: 'row', backgroundColor: '#111111',
    borderRadius: 10, borderWidth: 0.5, borderColor: '#222222', padding: 3, gap: 3,
  },
  segOpt: { flex: 1, paddingVertical: 9, borderRadius: 7, alignItems: 'center' },
  segOptActive: { backgroundColor: '#fff' },
  segOptText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.4)' },
  segOptTextActive: { color: '#000' },

  aiCard: {
    backgroundColor: 'rgba(200,255,0,0.04)',
    borderRadius: 14, borderWidth: 0.5, borderColor: 'rgba(200,255,0,0.12)', padding: 16, gap: 5,
  },
  aiLoadRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  aiLoadText: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  aiTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  aiLabel: { fontSize: 10, fontWeight: '700', color: ACCENT, letterSpacing: 1.2, textTransform: 'uppercase' },
  aiUntil: { fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: '500' },
  aiDays:  { fontSize: 30, fontWeight: '800', color: '#fff', letterSpacing: -1.5, lineHeight: 34 },
  aiWarning: { fontSize: 12, color: '#ffb547', marginTop: 4 },
  aiHint: { fontSize: 12, color: 'rgba(255,255,255,0.35)', lineHeight: 18 },

  manualSection: { gap: 10 },
  dateField: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#111111', borderRadius: 12, borderWidth: 0.5, borderColor: '#222222', padding: 13,
  },
  dateText: { fontSize: 15, fontWeight: '700', color: '#fff', letterSpacing: -0.2 },
  dateChevron: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  iosPickerWrap: { marginHorizontal: -30, transform: [{ scale: 0.9 }], marginVertical: -16 },

  chipRow: { flexDirection: 'row', gap: 6 },
  expiryChip: {
    flex: 1, paddingVertical: 9, borderRadius: 9,
    backgroundColor: '#111111', borderWidth: 0.5, borderColor: '#222222', alignItems: 'center',
  },
  expiryChipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  expiryChipText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.45)' },
  expiryChipTextActive: { color: '#000' },

  saveBtn: { backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  saveBtnDisabled: { opacity: 0.35 },
  saveBtnText: { color: '#000', fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },

  unitOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  unitBox: {
    backgroundColor: '#181818', borderRadius: 20, borderWidth: 0.5, borderColor: '#2a2a2a',
    paddingVertical: 8, width: 220, overflow: 'hidden',
  },
  unitBoxTitle: {
    fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.3)',
    letterSpacing: 0.8, textTransform: 'uppercase', textAlign: 'center', paddingVertical: 10,
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
