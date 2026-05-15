import { router } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useFoodLog } from '@/context/food-log-context';

export default function HomeScreen() {
  const { totals, goals, entries } = useFoodLog();

  const remainingCalories = goals.calories - totals.calories;
  const calorieProgress = Math.min(totals.calories / goals.calories, 1);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headlineRow}>
          <Text style={styles.headline}>Heute</Text>
          <TouchableOpacity onPress={() => router.push('/settings')} hitSlop={12}>
            <Text style={styles.settingsIcon}>⚙️</Text>
          </TouchableOpacity>
        </View>

        {/* Kalorien-Card */}
        <View style={styles.card}>
          <View style={styles.calorieRow}>
            <View style={styles.calorieBlock}>
              <Text style={styles.calorieValue}>{Math.round(totals.calories)}</Text>
              <Text style={styles.calorieLabel}>gegessen</Text>
            </View>
            <View style={styles.calorieDivider} />
            <View style={styles.calorieBlock}>
              <Text style={[styles.calorieValue, remainingCalories < 0 && styles.over]}>
                {Math.abs(Math.round(remainingCalories))}
              </Text>
              <Text style={styles.calorieLabel}>
                {remainingCalories < 0 ? 'überschritten' : 'übrig'}
              </Text>
            </View>
            <View style={styles.calorieDivider} />
            <View style={styles.calorieBlock}>
              <Text style={styles.calorieValue}>{goals.calories}</Text>
              <Text style={styles.calorieLabel}>Ziel</Text>
            </View>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${calorieProgress * 100}%`, backgroundColor: '#4F8EF7' }]} />
          </View>
        </View>

        {/* Makro-Cards */}
        <View style={styles.macroRow}>
          <MacroCard
            label="Protein"
            eaten={totals.protein}
            goal={goals.protein}
            unit="g"
            color="#4F8EF7"
          />
          <MacroCard
            label="Kohlenhydrate"
            eaten={totals.carbs}
            goal={goals.carbs}
            unit="g"
            color="#F7A94F"
          />
          <MacroCard
            label="Fett"
            eaten={totals.fat}
            goal={goals.fat}
            unit="g"
            color="#F74F4F"
          />
        </View>

        {/* Eingetragene Mahlzeiten */}
        {entries.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Heute gegessen</Text>
            {entries.map((entry, i) => (
              <View key={entry.id}>
                {i > 0 && <View style={styles.separator} />}
                <View style={styles.entryRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.entryName}>{entry.name}</Text>
                    {entry.brand ? <Text style={styles.entryBrand}>{entry.brand}</Text> : null}
                  </View>
                  <View style={styles.entryMacros}>
                    <Text style={styles.entryCalories}>{entry.calories} kcal</Text>
                    <Text style={styles.entryDetail}>
                      {entry.protein}g P · {entry.carbs}g K · {entry.fat}g F
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Buttons */}
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/log-food')}>
          <Text style={styles.primaryBtnText}>+ Essen eintragen</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push('/cook')}>
          <Text style={styles.secondaryBtnText}>Was kann ich kochen?</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function MacroCard({
  label,
  eaten,
  goal,
  unit,
  color,
}: {
  label: string;
  eaten: number;
  goal: number;
  unit: string;
  color: string;
}) {
  const progress = Math.min(eaten / goal, 1);
  return (
    <View style={styles.macroCard}>
      <Text style={[styles.macroValue, { color }]}>{Math.round(eaten * 10) / 10}{unit}</Text>
      <Text style={styles.macroGoal}>von {goal}{unit}</Text>
      <Text style={styles.macroLabel}>{label}</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scroll: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  headlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headline: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111',
  },
  settingsIcon: {
    fontSize: 22,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  calorieRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  calorieBlock: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  calorieValue: {
    fontSize: 26,
    fontWeight: '700',
    color: '#111',
  },
  over: {
    color: '#F74F4F',
  },
  calorieLabel: {
    fontSize: 12,
    color: '#999',
  },
  calorieDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#eee',
  },
  progressTrack: {
    height: 8,
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  macroRow: {
    flexDirection: 'row',
    gap: 8,
  },
  macroCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    gap: 3,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  macroValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  macroGoal: {
    fontSize: 11,
    color: '#bbb',
  },
  macroLabel: {
    fontSize: 11,
    color: '#888',
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  separator: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginVertical: 8,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  entryName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
  },
  entryBrand: {
    fontSize: 12,
    color: '#aaa',
  },
  entryMacros: {
    alignItems: 'flex-end',
  },
  entryCalories: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  entryDetail: {
    fontSize: 11,
    color: '#bbb',
  },
  primaryBtn: {
    backgroundColor: '#4F8EF7',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryBtn: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  secondaryBtnText: {
    color: '#333',
    fontSize: 17,
    fontWeight: '600',
  },
});
