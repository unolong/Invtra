import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export interface FoodEntry {
  id: string;
  name: string;
  brand: string;
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface MacroTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface Goals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface FoodLogContextValue {
  entries: FoodEntry[];
  goals: Goals;
  totals: MacroTotals;
  addEntry: (entry: Omit<FoodEntry, 'id'>) => Promise<void>;
  removeEntry: (id: string) => Promise<void>;
  updateGoals: (goals: Goals) => Promise<void>;
}

const DEFAULT_GOALS: Goals = {
  calories: 2000,
  protein: 150,
  carbs: 220,
  fat: 65,
};

const GOALS_KEY = '@fridgeai/goals';

function todayKey() {
  return `@fridgeai/entries/${new Date().toISOString().split('T')[0]}`;
}

const FoodLogContext = createContext<FoodLogContextValue | null>(null);

export function FoodLogProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(todayKey()),
      AsyncStorage.getItem(GOALS_KEY),
    ]).then(([rawEntries, rawGoals]) => {
      if (rawEntries) setEntries(JSON.parse(rawEntries));
      if (rawGoals) setGoals(JSON.parse(rawGoals));
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

  const totals = useMemo<MacroTotals>(
    () =>
      entries.reduce(
        (acc, e) => ({
          calories: acc.calories + e.calories,
          protein: acc.protein + e.protein,
          carbs: acc.carbs + e.carbs,
          fat: acc.fat + e.fat,
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 },
      ),
    [entries],
  );

  const updateGoals = useCallback(async (newGoals: Goals) => {
    setGoals(newGoals);
    await AsyncStorage.setItem(GOALS_KEY, JSON.stringify(newGoals));
  }, []);

  return (
    <FoodLogContext.Provider value={{ entries, goals, totals, addEntry, removeEntry, updateGoals }}>
      {children}
    </FoodLogContext.Provider>
  );
}

export function useFoodLog() {
  const ctx = useContext(FoodLogContext);
  if (!ctx) throw new Error('useFoodLog must be used within FoodLogProvider');
  return ctx;
}
