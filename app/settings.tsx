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

import { type Goals, useFoodLog } from '@/context/food-log-context';
import { getApiKey, saveApiKey } from '@/services/anthropic';

export default function SettingsScreen() {
  const { goals, updateGoals } = useFoodLog();

  const [calories, setCalories] = useState(String(goals.calories));
  const [protein, setProtein] = useState(String(goals.protein));
  const [carbs, setCarbs] = useState(String(goals.carbs));
  const [fat, setFat] = useState(String(goals.fat));

  const [apiKey, setApiKey] = useState('');
  const [apiKeySet, setApiKeySet] = useState(false);

  useEffect(() => {
    getApiKey().then(k => {
      if (k) setApiKeySet(true);
    });
  }, []);

  const handleSave = useCallback(async () => {
    const cal = parseInt(calories, 10);
    const pro = parseInt(protein, 10);
    const carb = parseInt(carbs, 10);
    const f = parseInt(fat, 10);

    if ([cal, pro, carb, f].some(v => isNaN(v) || v <= 0)) {
      Alert.alert('Ungültige Eingabe', 'Alle Ziele müssen positive Zahlen sein.');
      return;
    }

    const newGoals: Goals = { calories: cal, protein: pro, carbs: carb, fat: f };
    await updateGoals(newGoals);

    if (apiKey.trim()) {
      await saveApiKey(apiKey.trim());
      setApiKeySet(true);
      setApiKey('');
    }

    router.back();
  }, [calories, protein, carbs, fat, apiKey, updateGoals]);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
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
        {/* Tagesziele */}
        <Text style={styles.sectionHeader}>TAGESZIELE</Text>
        <View style={styles.card}>
          <GoalRow label="Kalorien" unit="kcal" value={calories} onChange={setCalories} />
          <View style={styles.divider} />
          <GoalRow label="Protein" unit="g" value={protein} onChange={setProtein} color="#4F8EF7" />
          <View style={styles.divider} />
          <GoalRow label="Kohlenhydrate" unit="g" value={carbs} onChange={setCarbs} color="#F7A94F" />
          <View style={styles.divider} />
          <GoalRow label="Fett" unit="g" value={fat} onChange={setFat} color="#F74F4F" />
        </View>

        {/* API Key */}
        <Text style={styles.sectionHeader}>ANTHROPIC API KEY</Text>
        <View style={styles.card}>
          {apiKeySet && (
            <Text style={styles.apiKeyStatus}>✓ API Key gespeichert</Text>
          )}
          <TextInput
            style={styles.apiKeyInput}
            placeholder={apiKeySet ? 'Neuen Key eingeben um zu ändern…' : 'sk-ant-…'}
            placeholderTextColor="#bbb"
            value={apiKey}
            onChangeText={setApiKey}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.apiKeyHint}>
            Benötigt für „Was kann ich kochen?". Key wird nur lokal gespeichert.
          </Text>
        </View>

        <TouchableOpacity style={styles.saveFullBtn} onPress={handleSave}>
          <Text style={styles.saveFullBtnText}>Speichern</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function GoalRow({
  label,
  unit,
  value,
  onChange,
  color = '#111',
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  color?: string;
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
        />
        <Text style={styles.goalUnit}>{unit}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111',
  },
  cancelBtn: {
    fontSize: 16,
    color: '#4F8EF7',
    width: 80,
  },
  saveBtn: {
    fontSize: 16,
    color: '#4F8EF7',
    fontWeight: '600',
    width: 80,
    textAlign: 'right',
  },
  scroll: {
    padding: 16,
    paddingBottom: 40,
    gap: 8,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: '#aaa',
    letterSpacing: 0.8,
    marginTop: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    overflow: 'hidden',
  },
  divider: {
    height: 1,
    backgroundColor: '#f0f0f0',
  },
  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  goalLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  goalInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  goalInput: {
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
    minWidth: 72,
    textAlign: 'center',
  },
  goalUnit: {
    fontSize: 14,
    color: '#888',
    width: 28,
  },
  apiKeyStatus: {
    fontSize: 14,
    color: '#4CAF50',
    fontWeight: '500',
    paddingTop: 14,
  },
  apiKeyInput: {
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: '#111',
    marginVertical: 12,
  },
  apiKeyHint: {
    fontSize: 12,
    color: '#bbb',
    paddingBottom: 14,
  },
  saveFullBtn: {
    backgroundColor: '#4F8EF7',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveFullBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
});
