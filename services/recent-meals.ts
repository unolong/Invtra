import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@fridgeai/recent-meals';
const MAX_ITEMS = 8;

export interface RecentMeal {
  name: string;
  brand: string;
  grams: number;
  unit?: 'g' | 'ml';
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export async function getRecentMeals(): Promise<RecentMeal[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function addRecentMeal(meal: RecentMeal): Promise<void> {
  try {
    const current = await getRecentMeals();
    const deduped = current.filter(
      m => m.name.toLowerCase() !== meal.name.toLowerCase(),
    );
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([meal, ...deduped].slice(0, MAX_ITEMS)),
    );
  } catch {}
}
