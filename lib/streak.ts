import AsyncStorage from '@react-native-async-storage/async-storage';

function dayKey(offsetFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetFromToday);
  return `@fridgeai/entries/${d.toISOString().split('T')[0]}`;
}

export async function loadStreak(): Promise<number> {
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const raw = await AsyncStorage.getItem(dayKey(i));
    const hasEntries = raw ? (JSON.parse(raw) as unknown[]).length > 0 : false;
    if (hasEntries) {
      streak++;
    } else if (i === 0) {
      // today has no entries yet — start counting from yesterday
      continue;
    } else {
      break;
    }
  }
  return streak;
}
