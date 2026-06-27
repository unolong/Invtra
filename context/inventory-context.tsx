import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type InventoryLocation = 'Kühlschrank' | 'Vorrat' | 'Tiefkühler';

export interface InventoryItem {
  id: string;
  name: string;
  qty: string;
  cat: string;
  location: InventoryLocation;
  expiresAt: string | null; // ISO date string
}

interface InventoryContextValue {
  items: InventoryItem[];
  addItems: (items: Omit<InventoryItem, 'id'>[]) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  updateItem: (id: string, changes: Partial<Omit<InventoryItem, 'id'>>) => Promise<void>;
}

const STORAGE_KEY = '@fridgeai/inventory';

const InventoryContext = createContext<InventoryContextValue | null>(null);

export function InventoryProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<InventoryItem[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (raw) setItems(JSON.parse(raw));
    });
  }, []);

  const persist = useCallback(async (next: InventoryItem[]) => {
    setItems(next);
    await AsyncStorage.multiSet([
      [STORAGE_KEY, JSON.stringify(next)],
      ['inventory_last_changed', Date.now().toString()],
    ]);
  }, []);

  const addItems = useCallback(
    async (newItems: Omit<InventoryItem, 'id'>[]) => {
      const stamped = newItems.map(item => ({
        ...item,
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      }));
      await persist([...items, ...stamped]);
    },
    [items, persist],
  );

  const removeItem = useCallback(
    async (id: string) => {
      await persist(items.filter(i => i.id !== id));
    },
    [items, persist],
  );

  const updateItem = useCallback(
    async (id: string, changes: Partial<Omit<InventoryItem, 'id'>>) => {
      await persist(items.map(i => (i.id === id ? { ...i, ...changes } : i)));
    },
    [items, persist],
  );

  return (
    <InventoryContext.Provider value={{ items, addItems, removeItem, updateItem }}>
      {children}
    </InventoryContext.Provider>
  );
}

export function useInventory() {
  const ctx = useContext(InventoryContext);
  if (!ctx) throw new Error('useInventory must be used within InventoryProvider');
  return ctx;
}

export function daysUntil(isoDate: string | null): number {
  if (!isoDate) return 9999;
  const diff = new Date(isoDate).getTime() - Date.now();
  return Math.ceil(diff / 86400000);
}
