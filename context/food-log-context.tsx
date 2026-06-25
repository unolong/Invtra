import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export interface FoodEntry {
  id: string;
  meal: string;
  name: string;
  brand: string;
  grams: number;
  unit?: 'g' | 'ml';
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  sugar?: number;
  fiber?: number;
  sodium?: number;
  saturatedFat?: number;
}

export interface MacroTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  sugar: number;
  fiber: number;
  sodium: number;
  saturatedFat: number;
}

export interface Goals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface ProfileData {
  name: string;
  age: number;
  weight: number;
  height: number;
  goal: string;
  gender?: 'male' | 'female';
}

interface FoodLogContextValue {
  entries: FoodEntry[];
  goals: Goals;
  totals: MacroTotals;
  profile: ProfileData;
  addEntry: (entry: Omit<FoodEntry, 'id'>) => Promise<void>;
  removeEntry: (id: string) => Promise<void>;
  updateEntry: (id: string, changes: Partial<Pick<FoodEntry, 'grams' | 'calories' | 'protein' | 'carbs' | 'fat'>>) => Promise<void>;
  updateGoals: (goals: Goals) => Promise<void>;
  updateProfile: (profile: ProfileData) => Promise<void>;
}

const DEFAULT_GOALS: Goals = {
  calories: 2000,
  protein: 150,
  carbs: 220,
  fat: 65,
};

const DEFAULT_PROFILE: ProfileData = {
  name: '',
  age: 25,
  weight: 75,
  height: 175,
  goal: 'Maintain',
};

const GOALS_KEY = '@fridgeai/goals';
const PROFILE_KEY = '@fridgeai/profile';

function todayKey() {
  return `@fridgeai/entries/${new Date().toISOString().split('T')[0]}`;
}

const FoodLogContext = createContext<FoodLogContextValue | null>(null);

export function FoodLogProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS);
  const [profile, setProfile] = useState<ProfileData>(DEFAULT_PROFILE);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(todayKey()),
      AsyncStorage.getItem(GOALS_KEY),
      AsyncStorage.getItem(PROFILE_KEY),
    ]).then(([rawEntries, rawGoals, rawProfile]) => {
      if (rawEntries) setEntries(JSON.parse(rawEntries));
      if (rawGoals) setGoals(JSON.parse(rawGoals));
      if (rawProfile) setProfile(JSON.parse(rawProfile));
    });
  }, []);

  const persist = useCallback(async (next: FoodEntry[]) => {
    setEntries(next);
    await AsyncStorage.setItem(todayKey(), JSON.stringify(next));
  }, []);

  const addEntry = useCallback(
    async (entry: Omit<FoodEntry, 'id'>) => {
      const newEntry: FoodEntry = { ...entry, id: Date.now().toString() };
      await persist([...entries, newEntry]);
    },
    [entries, persist],
  );

  const removeEntry = useCallback(
    async (id: string) => {
      await persist(entries.filter(e => e.id !== id));
    },
    [entries, persist],
  );

  const updateEntry = useCallback(
    async (id: string, changes: Partial<Pick<FoodEntry, 'grams' | 'calories' | 'protein' | 'carbs' | 'fat'>>) => {
      await persist(entries.map(e => e.id === id ? { ...e, ...changes } : e));
    },
    [entries, persist],
  );

  const totals = useMemo<MacroTotals>(
    () =>
      entries.reduce(
        (acc, e) => ({
          calories: acc.calories + e.calories,
          protein: acc.protein + e.protein,
          carbs: acc.carbs + e.carbs,
          fat: acc.fat + e.fat,
          sugar: acc.sugar + (e.sugar ?? 0),
          fiber: acc.fiber + (e.fiber ?? 0),
          sodium: acc.sodium + (e.sodium ?? 0),
          saturatedFat: acc.saturatedFat + (e.saturatedFat ?? 0),
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fiber: 0, sodium: 0, saturatedFat: 0 },
      ),
    [entries],
  );

  const updateGoals = useCallback(async (newGoals: Goals) => {
    setGoals(newGoals);
    await AsyncStorage.setItem(GOALS_KEY, JSON.stringify(newGoals));
  }, []);

  const updateProfile = useCallback(async (newProfile: ProfileData) => {
    setProfile(newProfile);
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(newProfile));
  }, []);

  return (
    <FoodLogContext.Provider value={{ entries, goals, totals, profile, addEntry, removeEntry, updateEntry, updateGoals, updateProfile }}>
      {children}
    </FoodLogContext.Provider>
  );
}

export function useFoodLog() {
  const ctx = useContext(FoodLogContext);
  if (!ctx) throw new Error('useFoodLog must be used within FoodLogProvider');
  return ctx;
}
