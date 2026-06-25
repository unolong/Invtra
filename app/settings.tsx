import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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

const BODY_GOALS = [
  { key: 'Lean Bulk', label: 'Lean Bulk' },
  { key: 'Cut',       label: 'Cut' },
  { key: 'Maintain',  label: 'Maintain' },
  { key: 'Bulk',      label: 'Bulk' },
];

export default function SettingsScreen() {
  const { goals, updateGoals, profile, updateProfile } = useFoodLog();

  const [calories, setCalories] = useState(String(goals.calories));
  const [protein, setProtein]   = useState(String(goals.protein));
  const [carbs, setCarbs]       = useState(String(goals.carbs));
  const [fat, setFat]           = useState(String(goals.fat));

  const [name,   setName]   = useState(profile.name);
  const [age,    setAge]    = useState(profile.age   > 0 ? String(profile.age)    : '');
  const [weight, setWeight] = useState(profile.weight > 0 ? String(profile.weight) : '');
  const [height, setHeight] = useState(profile.height > 0 ? String(profile.height) : '');
  const [bodyGoal, setBodyGoal] = useState(profile.goal);


  const handleSave = useCallback(async () => {
    const cal  = parseInt(calories, 10);
    const pro  = parseInt(protein, 10);
    const carb = parseInt(carbs, 10);
    const f    = parseInt(fat, 10);

    if ([cal, pro, carb, f].some(v => isNaN(v) || v <= 0)) {
      Alert.alert('Ungültige Eingabe', 'Alle Ziele müssen positive Zahlen sein.');
      return;
    }

    const newGoals: Goals = { calories: cal, protein: pro, carbs: carb, fat: f };
    await updateGoals(newGoals);

    const newProfile: ProfileData = {
      name: name.trim(),
      age: parseInt(age, 10) || 0,
      weight: parseFloat(weight) || 0,
      height: parseInt(height, 10) || 0,
      goal: bodyGoal,
    };
    await updateProfile(newProfile);

    router.back();
  }, [calories, protein, carbs, fat, name, age, weight, height, bodyGoal, updateGoals, updateProfile]);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.cancelBtn}>Abbrechen</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Einstellungen</Text>
          <TouchableOpacity onPress={handleSave} hitSlop={12}>
            <Text style={styles.saveBtn}>Speichern</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          <Text style={styles.sectionLabel}>Tagesziele</Text>
          <View style={styles.card}>
            <GoalRow label="Kalorien"      unit="kcal" value={calories} onChange={setCalories} />
            <View style={styles.divider} />
            <GoalRow label="Protein"       unit="g"    value={protein}  onChange={setProtein}  color="#4f8bff" />
            <View style={styles.divider} />
            <GoalRow label="Kohlenhydrate" unit="g"    value={carbs}    onChange={setCarbs}    color="#ffb547" />
            <View style={styles.divider} />
            <GoalRow label="Fett"          unit="g"    value={fat}      onChange={setFat}      color="#ff5e5e" />
          </View>

          <Text style={styles.sectionLabel}>Körperdaten</Text>
          <View style={styles.card}>
            <GoalRow label="Name" unit="" value={name} onChange={setName} isText />
            <View style={styles.divider} />
            <GoalRow label="Alter" unit="J." value={age} onChange={setAge} />
            <View style={styles.divider} />
            <GoalRow label="Gewicht" unit="kg" value={weight} onChange={setWeight} isDecimal />
            <View style={styles.divider} />
            <GoalRow label="Größe" unit="cm" value={height} onChange={setHeight} />
          </View>

          <Text style={styles.sectionLabel}>Ziel</Text>
          <View style={[styles.card, { paddingVertical: 14 }]}>
            <View style={styles.goalChipsRow}>
              {BODY_GOALS.map(g => (
                <TouchableOpacity
                  key={g.key}
                  style={[styles.goalChip, bodyGoal === g.key && styles.goalChipActive]}
                  onPress={() => setBodyGoal(g.key)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.goalChipText, bodyGoal === g.key && styles.goalChipTextActive]}>
                    {g.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>


          <TouchableOpacity style={styles.accentBtn} onPress={handleSave}>
            <Text style={styles.accentBtnText}>Speichern</Text>
          </TouchableOpacity>

          <Text style={styles.attribution}>
            Nährwertdaten: Bundeslebensmittelschlüssel 4.0, Max Rubner-Institut, CC BY 4.0
          </Text>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function GoalRow({
  label, unit, value, onChange, color = '#fff', isText = false, isDecimal = false,
}: {
  label: string; unit: string; value: string; onChange: (v: string) => void;
  color?: string; isText?: boolean; isDecimal?: boolean;
}) {
  return (
    <View style={styles.goalRow}>
      <Text style={[styles.goalLabel, { color }]}>{label}</Text>
      <View style={styles.goalInputRow}>
        <TextInput
          style={[styles.goalInput, isText && styles.goalInputWide]}
          value={value}
          onChangeText={onChange}
          keyboardType={isText ? 'default' : isDecimal ? 'decimal-pad' : 'numeric'}
          selectTextOnFocus
          autoCapitalize={isText ? 'words' : 'none'}
        />
        {unit ? <Text style={styles.goalUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: '#222222',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.3,
  },
  cancelBtn: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '500',
    width: 80,
  },
  saveBtn: {
    fontSize: 15,
    color: ACCENT,
    fontWeight: '700',
    width: 80,
    textAlign: 'right',
  },
  scroll: {
    padding: 16,
    paddingBottom: 48,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
    marginTop: 6,
  },
  card: {
    backgroundColor: '#111111',
    borderRadius: 20,
    paddingHorizontal: 16,
    borderWidth: 0.5,
    borderColor: '#222222',
    overflow: 'hidden',
  },
  divider: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  goalLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#fff',
    flexShrink: 1,
  },
  goalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  goalInput: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    minWidth: 72,
    textAlign: 'center',
  },
  goalUnit: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
    width: 28,
  },
  accentBtn: {
    backgroundColor: ACCENT,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 6,
  },
  accentBtnText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  attribution: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.2)',
    textAlign: 'center',
    paddingVertical: 8,
    lineHeight: 15,
  },
  goalInputWide: {
    minWidth: 130,
    textAlign: 'right',
  },
  goalChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  goalChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 0.5,
    borderColor: '#222222',
  },
  goalChipActive: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  goalChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
  },
  goalChipTextActive: {
    color: '#000',
  },
});
