import { router } from 'expo-router';
import { useCallback, useState } from 'react';
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

import { useFoodLog } from '@/context/food-log-context';

const ACCENT = '#c8ff00';

export default function GoalsEditScreen() {
  const { goals, updateGoals } = useFoodLog();

  const [calories, setCalories] = useState(String(goals.calories));
  const [protein, setProtein] = useState(String(goals.protein));
  const [carbs, setCarbs] = useState(String(goals.carbs));
  const [fat, setFat] = useState(String(goals.fat));

  const handleSave = useCallback(async () => {
    const cal = parseInt(calories, 10);
    const pro = parseInt(protein, 10);
    const carb = parseInt(carbs, 10);
    const f = parseInt(fat, 10);

    if ([cal, pro, carb, f].some(v => isNaN(v) || v <= 0)) {
      Alert.alert('Ungültige Eingabe', 'Alle Ziele müssen positive Zahlen sein.');
      return;
    }

    await updateGoals({ calories: cal, protein: pro, carbs: carb, fat: f });
    router.back();
  }, [calories, protein, carbs, fat, updateGoals]);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.cancelBtn}>Abbrechen</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Tagesziele</Text>
          <TouchableOpacity onPress={handleSave} hitSlop={12}>
            <Text style={styles.saveBtn}>Speichern</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          <Text style={styles.hint}>Ziele manuell anpassen</Text>

          <View style={styles.card}>
            <GoalRow label="Kalorien" unit="kcal" value={calories} onChange={setCalories} />
            <View style={styles.divider} />
            <GoalRow label="Protein" unit="g" value={protein} onChange={setProtein} color="#4f8bff" />
            <View style={styles.divider} />
            <GoalRow label="Carbs" unit="g" value={carbs} onChange={setCarbs} color="#ffb547" />
            <View style={styles.divider} />
            <GoalRow label="Fett" unit="g" value={fat} onChange={setFat} color="#ff5e5e" />
          </View>

          <TouchableOpacity style={styles.accentBtn} onPress={handleSave}>
            <Text style={styles.accentBtnText}>Speichern</Text>
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function GoalRow({
  label, unit, value, onChange, color = '#fff',
}: {
  label: string; unit: string; value: string; onChange: (v: string) => void; color?: string;
}) {
  return (
    <View style={styles.goalRow}>
      <Text style={[styles.goalLabel, { color }]}>{label}</Text>
      <View style={styles.goalInputRow}>
        <TextInput
          style={styles.goalInput}
          value={value}
          onChangeText={onChange}
          keyboardType="numeric"
          selectTextOnFocus
          autoCapitalize="none"
        />
        <Text style={styles.goalUnit}>{unit}</Text>
      </View>
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
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  cancelBtn: { fontSize: 15, color: 'rgba(255,255,255,0.4)', fontWeight: '500', width: 80 },
  saveBtn: { fontSize: 15, color: ACCENT, fontWeight: '700', width: 80, textAlign: 'right' },
  scroll: { padding: 16, paddingBottom: 48, gap: 10 },
  hint: {
    fontSize: 11, color: 'rgba(255,255,255,0.4)', paddingHorizontal: 4,
    fontWeight: '500', marginBottom: 2,
  },
  card: {
    backgroundColor: '#111111', borderRadius: 20, paddingHorizontal: 16,
    borderWidth: 0.5, borderColor: '#222222', overflow: 'hidden',
  },
  divider: { height: 0.5, backgroundColor: 'rgba(255,255,255,0.06)' },
  goalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14,
  },
  goalLabel: { fontSize: 15, fontWeight: '500', flexShrink: 1 },
  goalInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  goalInput: {
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
    fontSize: 16, fontWeight: '600', color: '#fff', minWidth: 72, textAlign: 'center',
  },
  goalUnit: { fontSize: 14, color: 'rgba(255,255,255,0.4)', width: 36 },
  accentBtn: {
    backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginTop: 6,
  },
  accentBtnText: { color: '#000', fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
});
