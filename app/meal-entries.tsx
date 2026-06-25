import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
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

import { type FoodEntry, useFoodLog } from '@/context/food-log-context';

const ACCENT = '#c8ff00';
const MEALS = ['Frühstück', 'Mittagessen', 'Snacks', 'Abendessen'];

export default function MealEntriesScreen() {
  const { meal: mealParam } = useLocalSearchParams<{ meal?: string }>();
  const { entries, removeEntry, updateEntry } = useFoodLog();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editGrams, setEditGrams] = useState('');

  const activeMeal = mealParam && MEALS.includes(mealParam) ? mealParam : null;
  const filtered = activeMeal
    ? entries.filter(e => e.meal === activeMeal)
    : entries;

  const grouped = MEALS.reduce<Record<string, FoodEntry[]>>((acc, m) => {
    acc[m] = filtered.filter(e => e.meal === m);
    return acc;
  }, {} as Record<string, FoodEntry[]>);

  const totalKcal = filtered.reduce((s, e) => s + e.calories, 0);

  function startEdit(entry: FoodEntry) {
    setEditingId(entry.id);
    setEditGrams(String(entry.grams));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditGrams('');
  }

  async function confirmEdit(entry: FoodEntry) {
    const newGrams = parseFloat(editGrams);
    if (!newGrams || newGrams <= 0) {
      cancelEdit();
      return;
    }
    const f = newGrams / entry.grams;
    await updateEntry(entry.id, {
      grams:    newGrams,
      calories: Math.round(entry.calories * f),
      protein:  Math.round(entry.protein  * f * 10) / 10,
      carbs:    Math.round(entry.carbs    * f * 10) / 10,
      fat:      Math.round(entry.fat      * f * 10) / 10,
    });
    cancelEdit();
  }

  function confirmDelete(entry: FoodEntry) {
    Alert.alert(
      entry.name,
      'Eintrag entfernen?',
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Entfernen', style: 'destructive', onPress: () => removeEntry(entry.id) },
      ],
    );
  }

  const sectionsToShow = activeMeal
    ? [[activeMeal, grouped[activeMeal]] as [string, FoodEntry[]]]
    : MEALS.map(m => [m, grouped[m]] as [string, FoodEntry[]]).filter(([, items]) => items.length > 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.closeBtn}>Fertig</Text>
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.headerTitle}>
              {activeMeal ?? 'Alle Mahlzeiten'}
            </Text>
            {filtered.length > 0 && (
              <Text style={styles.headerSub}>{Math.round(totalKcal)} kcal gesamt</Text>
            )}
          </View>
          <View style={{ width: 48 }} />
        </View>

        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🍽</Text>
            <Text style={styles.emptyText}>Noch keine Einträge</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {sectionsToShow.map(([mealName, items]) => (
              <View key={mealName} style={styles.section}>
                {!activeMeal && (
                  <Text style={styles.sectionLabel}>{mealName}</Text>
                )}
                <View style={styles.card}>
                  {items.map((entry, idx) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      isLast={idx === items.length - 1}
                      isEditing={editingId === entry.id}
                      editGrams={editGrams}
                      onEditGramsChange={setEditGrams}
                      onStartEdit={() => startEdit(entry)}
                      onConfirmEdit={() => confirmEdit(entry)}
                      onCancelEdit={cancelEdit}
                      onDelete={() => confirmDelete(entry)}
                    />
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function EntryRow({
  entry,
  isLast,
  isEditing,
  editGrams,
  onEditGramsChange,
  onStartEdit,
  onConfirmEdit,
  onCancelEdit,
  onDelete,
}: {
  entry: FoodEntry;
  isLast: boolean;
  isEditing: boolean;
  editGrams: string;
  onEditGramsChange: (v: string) => void;
  onStartEdit: () => void;
  onConfirmEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={[styles.row, !isLast && styles.rowBorder]}>
      <View style={styles.rowMain}>
        <View style={styles.glyph}>
          <Text style={styles.glyphText}>{entry.name[0].toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.entryName} numberOfLines={1}>{entry.name}</Text>
          {entry.brand ? (
            <Text style={styles.entrySub} numberOfLines={1}>{entry.brand}</Text>
          ) : null}
        </View>
        <Text style={styles.entryKcal}>
          {entry.calories}<Text style={styles.entryKcalUnit}> kcal</Text>
        </Text>
      </View>

      {isEditing ? (
        <View style={styles.editRow}>
          <TextInput
            style={styles.gramsInput}
            value={editGrams}
            onChangeText={onEditGramsChange}
            keyboardType="decimal-pad"
            selectTextOnFocus
            autoFocus
            returnKeyType="done"
            onSubmitEditing={onConfirmEdit}
          />
          <Text style={styles.gramsUnit}>g</Text>
          <TouchableOpacity style={styles.confirmBtn} onPress={onConfirmEdit}>
            <Text style={styles.confirmBtnText}>OK</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={onCancelEdit} hitSlop={8}>
            <Text style={styles.cancelBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.gramsChip} onPress={onStartEdit} activeOpacity={0.7}>
            <Text style={styles.gramsChipText}>{entry.grams}g</Text>
            <Text style={styles.gramsChipEdit}>✎</Text>
          </TouchableOpacity>
          <Text style={styles.macroLine}>
            <Text style={{ color: '#4f8bff' }}>{entry.protein}g P</Text>
            {'  '}
            <Text style={{ color: '#ffb547' }}>{entry.carbs}g K</Text>
            {'  '}
            <Text style={{ color: '#ff5e5e' }}>{entry.fat}g F</Text>
          </Text>
          <TouchableOpacity onPress={onDelete} hitSlop={10} style={styles.deleteBtn}>
            <Text style={styles.deleteBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: '#222222',
  },
  closeBtn: { fontSize: 15, color: ACCENT, fontWeight: '700', width: 48 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },

  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  emptyEmoji: { fontSize: 44 },
  emptyText: { fontSize: 15, color: 'rgba(255,255,255,0.4)', fontWeight: '500' },

  scroll: { padding: 16, paddingBottom: 48, gap: 16 },

  section: { gap: 8 },
  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.8, textTransform: 'uppercase', paddingHorizontal: 4,
  },

  card: {
    backgroundColor: '#111111', borderRadius: 18,
    borderWidth: 0.5, borderColor: '#222222', overflow: 'hidden',
  },

  row: { paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  rowBorder: { borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },

  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  glyph: {
    width: 34, height: 34, borderRadius: 10, flexShrink: 0,
    backgroundColor: `${ACCENT}18`, borderWidth: 0.5, borderColor: `${ACCENT}30`,
    alignItems: 'center', justifyContent: 'center',
  },
  glyphText: { fontSize: 14, fontWeight: '700', color: ACCENT },
  entryName: { fontSize: 14, fontWeight: '500', color: '#fff', letterSpacing: -0.1 },
  entrySub: { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 1 },
  entryKcal: { fontSize: 14, fontWeight: '700', color: '#fff' },
  entryKcalUnit: { fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: '400' },

  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 46,
  },
  gramsChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.1)',
  },
  gramsChipText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  gramsChipEdit: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  macroLine: { flex: 1, fontSize: 11, fontWeight: '500' },
  deleteBtn: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: 'rgba(255,94,94,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  deleteBtnText: { fontSize: 12, color: '#ff5e5e', fontWeight: '600' },

  editRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 46,
  },
  gramsInput: {
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8,
    fontSize: 16, fontWeight: '600', color: '#fff',
    minWidth: 80, textAlign: 'center',
    borderWidth: 0.5, borderColor: ACCENT,
  },
  gramsUnit: { fontSize: 14, color: 'rgba(255,255,255,0.5)', fontWeight: '500' },
  confirmBtn: {
    backgroundColor: ACCENT, borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  confirmBtnText: { color: '#000', fontSize: 13, fontWeight: '700' },
  cancelBtn: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 13, color: 'rgba(255,255,255,0.45)' },
});
