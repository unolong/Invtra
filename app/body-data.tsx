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

import { type Goals, type ProfileData, useFoodLog } from '@/context/food-log-context';

const ACCENT = '#c8ff00';

const GENDER_OPTIONS = [
  { key: 'male' as const, label: 'Männlich' },
  { key: 'female' as const, label: 'Weiblich' },
];

const GOAL_OPTIONS = [
  { key: 'Abnehmen', label: 'Abnehmen' },
  { key: 'Halten', label: 'Halten' },
  { key: 'Zunehmen', label: 'Zunehmen' },
];

function calcGoals(p: ProfileData): Goals {
  const weight = p.weight || 75;
  const height = p.height || 175;
  const age = p.age || 25;
  const bmr =
    p.gender === 'female'
      ? 10 * weight + 6.25 * height - 5 * age - 161
      : 10 * weight + 6.25 * height - 5 * age + 5;
  const tdee = Math.round(bmr * 1.55);
  const calories =
    p.goal === 'Abnehmen' ? tdee - 400 : p.goal === 'Zunehmen' ? tdee + 300 : tdee;
  const protein = Math.round(weight * 2);
  const fat = Math.round((calories * 0.25) / 9);
  const carbs = Math.max(Math.round((calories - protein * 4 - fat * 9) / 4), 0);
  return { calories, protein, carbs, fat };
}

export default function BodyDataScreen() {
  const { updateGoals, profile, updateProfile } = useFoodLog();

  const [name, setName] = useState(profile.name);
  const [age, setAge] = useState(profile.age > 0 ? String(profile.age) : '');
  const [weight, setWeight] = useState(profile.weight > 0 ? String(profile.weight) : '');
  const [height, setHeight] = useState(profile.height > 0 ? String(profile.height) : '');
  const [gender, setGender] = useState<'male' | 'female'>(profile.gender ?? 'male');
  const [goal, setGoal] = useState(profile.goal || 'Halten');

  const buildProfile = useCallback(
    (): ProfileData => ({
      name: name.trim(),
      age: parseInt(age, 10) || 0,
      weight: parseFloat(weight) || 0,
      height: parseInt(height, 10) || 0,
      goal,
      gender,
    }),
    [name, age, weight, height, goal, gender],
  );

  const handleSave = useCallback(async () => {
    await updateProfile(buildProfile());
    router.back();
  }, [buildProfile, updateProfile]);

  const handleAutoCalc = useCallback(async () => {
    const p = buildProfile();
    if (p.weight === 0 || p.height === 0 || p.age === 0) {
      Alert.alert('Fehlende Angaben', 'Bitte Alter, Gewicht und Größe eingeben.');
      return;
    }
    const newGoals = calcGoals(p);
    await updateProfile(p);
    await updateGoals(newGoals);
    Alert.alert(
      'Ziele berechnet',
      `${newGoals.calories} kcal · ${newGoals.protein}g Protein · ${newGoals.carbs}g Carbs · ${newGoals.fat}g Fett`,
      [{ text: 'OK', onPress: () => router.back() }],
    );
  }, [buildProfile, updateProfile, updateGoals]);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.cancelBtn}>Abbrechen</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Körperdaten</Text>
          <TouchableOpacity onPress={handleSave} hitSlop={12}>
            <Text style={styles.saveBtn}>Speichern</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          <Text style={styles.sectionLabel}>Persönlich</Text>
          <View style={styles.card}>
            <InputRow label="Name" value={name} onChange={setName} isText />
            <View style={styles.divider} />
            <InputRow label="Alter" unit="J." value={age} onChange={setAge} />
            <View style={styles.divider} />
            <InputRow label="Gewicht" unit="kg" value={weight} onChange={setWeight} isDecimal />
            <View style={styles.divider} />
            <InputRow label="Größe" unit="cm" value={height} onChange={setHeight} />
          </View>

          <Text style={styles.sectionLabel}>Geschlecht</Text>
          <View style={[styles.card, { paddingVertical: 14 }]}>
            <View style={styles.chipRow}>
              {GENDER_OPTIONS.map(g => (
                <TouchableOpacity
                  key={g.key}
                  style={[styles.chip, gender === g.key && styles.chipActive]}
                  onPress={() => setGender(g.key)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.chipText, gender === g.key && styles.chipTextActive]}>
                    {g.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <Text style={styles.sectionLabel}>Ziel</Text>
          <View style={[styles.card, { paddingVertical: 14 }]}>
            <View style={styles.chipRow}>
              {GOAL_OPTIONS.map(g => (
                <TouchableOpacity
                  key={g.key}
                  style={[styles.chip, goal === g.key && styles.chipActive]}
                  onPress={() => setGoal(g.key)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.chipText, goal === g.key && styles.chipTextActive]}>
                    {g.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity style={styles.accentBtn} onPress={handleAutoCalc}>
            <Text style={styles.accentBtnText}>Tagesziele automatisch berechnen</Text>
          </TouchableOpacity>

          <Text style={styles.hint}>
            Berechnet auf Basis von Mifflin-St Jeor + moderater Aktivität
          </Text>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function InputRow({
  label, unit = '', value, onChange, isText = false, isDecimal = false,
}: {
  label: string; unit?: string; value: string; onChange: (v: string) => void;
  isText?: boolean; isDecimal?: boolean;
}) {
  return (
    <View style={styles.inputRow}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.inputRight}>
        <TextInput
          style={[styles.input, isText && styles.inputWide]}
          value={value}
          onChangeText={onChange}
          keyboardType={isText ? 'default' : isDecimal ? 'decimal-pad' : 'numeric'}
          selectTextOnFocus
          autoCapitalize={isText ? 'words' : 'none'}
          placeholderTextColor="rgba(255,255,255,0.2)"
        />
        {unit ? <Text style={styles.inputUnit}>{unit}</Text> : null}
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
  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.8, textTransform: 'uppercase', paddingHorizontal: 4, marginTop: 6,
  },
  card: {
    backgroundColor: '#111111', borderRadius: 20, paddingHorizontal: 16,
    borderWidth: 0.5, borderColor: '#222222', overflow: 'hidden',
  },
  divider: { height: 0.5, backgroundColor: 'rgba(255,255,255,0.06)' },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14,
  },
  inputLabel: { fontSize: 15, fontWeight: '500', color: '#fff', flexShrink: 1 },
  inputRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
    fontSize: 16, fontWeight: '600', color: '#fff', minWidth: 72, textAlign: 'center',
  },
  inputWide: { minWidth: 130, textAlign: 'right' },
  inputUnit: { fontSize: 14, color: 'rgba(255,255,255,0.4)', width: 28 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 0.5, borderColor: '#222222',
  },
  chipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.6)' },
  chipTextActive: { color: '#000' },
  accentBtn: {
    backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginTop: 6,
  },
  accentBtnText: { color: '#000', fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
  hint: {
    fontSize: 11, color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 2,
  },
});
