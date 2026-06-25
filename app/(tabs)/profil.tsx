import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type FoodEntry, useFoodLog } from '@/context/food-log-context';
import { loadStreak } from '@/lib/streak';

const ACCENT = '#c8ff00';
const DAY_ABBR = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

interface DayData {
  label: string;
  calories: number;
  isToday: boolean;
  hasData: boolean;
}

function dayKey(offsetFromToday: number) {
  const d = new Date();
  d.setDate(d.getDate() - offsetFromToday);
  return `@fridgeai/entries/${d.toISOString().split('T')[0]}`;
}

async function fetchWeekData(): Promise<DayData[]> {
  const result: DayData[] = [];
  for (let i = 6; i >= 0; i--) {
    const raw = await AsyncStorage.getItem(dayKey(i));
    const entries: FoodEntry[] = raw ? JSON.parse(raw) : [];
    const cal = entries.reduce((s, e) => s + e.calories, 0);
    const d = new Date();
    d.setDate(d.getDate() - i);
    result.push({ label: DAY_ABBR[d.getDay()], calories: cal, isToday: i === 0, hasData: entries.length > 0 });
  }
  return result;
}

export default function ProfilScreen() {
  const { goals, profile } = useFoodLog();
  const [weekData, setWeekData] = useState<DayData[]>([]);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    fetchWeekData().then(setWeekData);
    loadStreak().then(setStreak);
  }, []);

  const displayName = profile.name || 'Kein Name';
  const avatarLetter = (profile.name || '?')[0].toUpperCase();
  const bodyStats = [
    profile.age    > 0 ? `${profile.age} J.`   : null,
    profile.weight > 0 ? `${profile.weight} kg` : null,
    profile.height > 0 ? `${profile.height} cm` : null,
  ].filter(Boolean).join(', ');
  const userSub = [profile.goal, bodyStats].filter(Boolean).join(' · ');

  const macroDistribution = useMemo(() => {
    const pKcal = goals.protein * 4;
    const kKcal = goals.carbs * 4;
    const fKcal = goals.fat * 9;
    const total = pKcal + kKcal + fKcal;
    if (total === 0) return '—';
    const p = Math.round(pKcal / total * 100);
    const k = Math.round(kKcal / total * 100);
    const f = 100 - p - k;
    return `${p}/${k}/${f}`;
  }, [goals]);

  const weekStats = useMemo(() => {
    const withData = weekData.filter(d => d.hasData);
    const avgKcal = withData.length > 0
      ? Math.round(withData.reduce((s, d) => s + d.calories, 0) / withData.length)
      : 0;
    const goalDays = weekData.filter(d => d.calories >= goals.calories * 0.8).length;
    const goalRate = withData.length > 0
      ? Math.round(goalDays / Math.max(withData.length, 1) * 100)
      : 0;
    return { avgKcal, goalRate, trackedDays: withData.length };
  }, [weekData, goals]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <Text style={styles.headline}>Profil</Text>

        {/* Avatar card */}
        <View style={styles.card}>
          <View style={styles.avatarRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarLetter}>{avatarLetter}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.userName}>{displayName}</Text>
              {userSub ? <Text style={styles.userSub} numberOfLines={2}>{userSub}</Text> : null}
            </View>
            <TouchableOpacity style={styles.editBtn} onPress={() => router.push('/body-data')} hitSlop={8}>
              <Text style={styles.editBtnText}>Bearbeiten</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Goals card */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>Tagesziele</Text>
            <TouchableOpacity onPress={() => router.push('/goals-edit')}>
              <Text style={styles.sectionAction}>Anpassen</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.goalsGrid}>
            <GoalBox label="Kalorien" value={goals.calories} unit="kcal" color="#fff" />
            <GoalBox label="Protein"  value={goals.protein}  unit="g"    color="#4f8bff" />
            <GoalBox label="Carbs"    value={goals.carbs}    unit="g"    color="#ffb547" />
            <GoalBox label="Fett"     value={goals.fat}      unit="g"    color="#ff5e5e" />
          </View>
        </View>

        {/* Week stats card */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Diese Woche</Text>
          <View style={styles.barChart}>
            {weekData.length === 0
              ? Array.from({ length: 7 }).map((_, i) => (
                  <View key={i} style={styles.barCol}>
                    <View style={styles.barWrapper} />
                    <Text style={styles.barDay}>–</Text>
                  </View>
                ))
              : weekData.map((day, i) => {
                  const pct = goals.calories > 0 ? day.calories / goals.calories : 0;
                  const barH = Math.min(Math.round(pct * 80), 80);
                  const barColor = day.isToday
                    ? ACCENT
                    : day.calories >= goals.calories * 0.8
                      ? 'rgba(38,222,129,0.55)'
                      : day.hasData
                        ? 'rgba(255,255,255,0.18)'
                        : 'rgba(255,255,255,0.05)';
                  return (
                    <View key={i} style={styles.barCol}>
                      <View style={styles.barWrapper}>
                        {barH > 0 && (
                          <View style={[styles.bar, { height: barH, backgroundColor: barColor }]} />
                        )}
                      </View>
                      <Text style={[styles.barDay, day.isToday && { color: ACCENT }]}>
                        {day.label}
                      </Text>
                    </View>
                  );
                })}
          </View>

          <View style={styles.weekStatsRow}>
            <View>
              {weekStats.trackedDays > 0 ? (
                <>
                  <Text style={styles.weekAvg}>
                    {weekStats.avgKcal.toLocaleString('de-DE')}
                    <Text style={styles.weekAvgUnit}> Ø kcal</Text>
                  </Text>
                  <Text style={[
                    styles.weekGoalRate,
                    weekStats.goalRate < 50 && { color: 'rgba(255,255,255,0.4)' },
                  ]}>
                    {weekStats.goalRate >= 50 ? '↗' : '↘'} {weekStats.goalRate}% der Ziele erreicht
                  </Text>
                </>
              ) : (
                <Text style={styles.weekEmpty}>Noch keine Einträge diese Woche</Text>
              )}
            </View>
            {streak > 0 && (
              <View style={styles.streakBadge}>
                <Text style={styles.streakNum}>{streak}</Text>
                <Text style={styles.streakLabel}>Tage{'\n'}Streak 🔥</Text>
              </View>
            )}
          </View>
        </View>

        {/* Settings rows */}
        <View style={styles.settingsList}>
          <SettingRow
            icon="🎯"
            label="Makro-Verteilung"
            detail={`P/K/F: ${macroDistribution}`}
            onPress={() => router.push('/settings')}
          />
          <SettingRow
            icon="⚙️"
            label="Einstellungen"
            onPress={() => router.push('/settings')}
            isLast
          />
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function GoalBox({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <View style={styles.goalBox}>
      <Text style={styles.goalBoxLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: 4 }}>
        <Text style={[styles.goalBoxValue, { color }]}>{value}</Text>
        <Text style={styles.goalBoxUnit}>{unit}</Text>
      </View>
    </View>
  );
}

function SettingRow({
  icon, label, detail, onPress, isLast = false,
}: {
  icon: string; label: string; detail?: string; onPress?: () => void; isLast?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.settingRow, !isLast && styles.settingRowBorder]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={styles.settingIcon}>
        <Text style={{ fontSize: 16 }}>{icon}</Text>
      </View>
      <Text style={styles.settingLabel}>{label}</Text>
      {detail ? <Text style={styles.settingDetail}>{detail}</Text> : null}
      <Text style={styles.settingChevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  scroll: { padding: 16, paddingBottom: 120, gap: 14 },

  headline: {
    fontSize: 32, fontWeight: '800', color: '#fff', letterSpacing: -1, paddingTop: 4,
  },

  card: {
    backgroundColor: '#111111', borderRadius: 20, padding: 16,
    borderWidth: 0.5, borderColor: '#222222', gap: 14,
  },

  // Avatar
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 60, height: 60, borderRadius: 18, backgroundColor: ACCENT,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarLetter: { fontSize: 24, fontWeight: '800', color: '#000' },
  userName: { fontSize: 18, fontWeight: '700', color: '#fff', letterSpacing: -0.4 },
  userSub: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  editBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.06)', flexShrink: 0,
  },
  editBtnText: { fontSize: 13, fontWeight: '600', color: '#fff' },

  // Section
  sectionHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.8, textTransform: 'uppercase',
  },
  sectionAction: { fontSize: 11, fontWeight: '600', color: ACCENT },

  // Goals grid
  goalsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  goalBox: {
    width: '47%', paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.04)',
  },
  goalBoxLabel: { fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: '500' },
  goalBoxValue: { fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  goalBoxUnit: { fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: '500' },

  // Bar chart
  barChart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 100 },
  barCol: {
    flex: 1, alignItems: 'center', gap: 6,
    height: '100%', justifyContent: 'flex-end',
  },
  barWrapper: { width: '100%', height: 80, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 6 },
  barDay: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.4)' },

  weekStatsRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: -4,
  },
  weekAvg: { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: -0.5 },
  weekAvgUnit: { fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: '400' },
  weekGoalRate: { fontSize: 11, color: '#26de81', fontWeight: '600', marginTop: 2 },
  weekEmpty: { fontSize: 13, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' },

  streakBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 0.5, borderColor: '#222222',
  },
  streakNum: {
    fontSize: 24, fontWeight: '800', color: ACCENT, letterSpacing: -0.5,
  },
  streakLabel: {
    fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: '600',
    lineHeight: 14,
  },

  // Settings
  settingsList: {
    backgroundColor: '#111111', borderRadius: 18,
    overflow: 'hidden', borderWidth: 0.5, borderColor: '#222222',
  },
  settingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  settingRowBorder: { borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  settingIcon: {
    width: 30, height: 30, borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center', justifyContent: 'center',
  },
  settingLabel: {
    flex: 1, fontSize: 14, color: '#fff', fontWeight: '500', letterSpacing: -0.1,
  },
  settingDetail: { fontSize: 13, color: 'rgba(255,255,255,0.45)', fontWeight: '500' },
  settingChevron: { fontSize: 18, color: 'rgba(255,255,255,0.2)' },
});
