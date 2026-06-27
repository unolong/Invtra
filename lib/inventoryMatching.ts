import type { InventoryItem } from '@/context/inventory-context';
import type { RecipeSuggestion } from '@/services/anthropic';
import { isBasicIngredient } from '@/lib/recipe-match';

export interface InventoryMatch {
  inventoryItem: InventoryItem;
  trackedName: string;
  trackedAmountGrams: number;
}

export function parseGrams(qty: string): number {
  if (!qty) return 0;
  const m = qty.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)?/i);
  if (!m) return 0;
  const val = parseFloat(m[1].replace(',', '.'));
  const unit = (m[2] ?? 'g').toLowerCase();
  if (unit === 'kg' || unit === 'l') return val * 1000;
  return val;
}

function namesMatch(a: string, b: string): boolean {
  const aN = a.toLowerCase().trim();
  const bN = b.toLowerCase().trim();
  if (!aN || !bN) return false;
  if (aN.includes(bN) || bN.includes(aN)) return true;
  const aWords = aN.split(/\s+/).filter(w => w.length > 3);
  return aWords.some(w => bN.includes(w));
}

function extractIngredientGrams(ingredient: string): number {
  const m = ingredient.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)\b/i);
  if (!m) return 0;
  const val = parseFloat(m[1].replace(',', '.'));
  const unit = m[2].toLowerCase();
  if (unit === 'kg' || unit === 'l') return val * 1000;
  return val;
}

function extractIngredientName(ingredient: string): string {
  // "200g Hähnchenbrust" → "hähnchenbrust", "1 EL Olivenöl" → "olivenöl"
  return ingredient
    .replace(/^\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|EL|TL|x)\.?\s*/i, '')
    .toLowerCase()
    .trim();
}

// Scenario 1: match a tracked food item against inventory
export function findInventoryMatches(
  foodName: string,
  grams: number,
  inventoryItems: InventoryItem[],
): InventoryMatch[] {
  const cleanName = foodName
    .replace(/\s*\d+\s*(?:g|kg|ml|l)\.?\s*$/i, '')
    .trim();

  return inventoryItems
    .filter(item => namesMatch(cleanName, item.name))
    .map(item => ({
      inventoryItem: item,
      trackedName: foodName,
      trackedAmountGrams: grams,
    }));
}

// Scenario 2: match recipe's used inventory items to actual inventory items
export function findRecipeInventoryMatches(
  recipe: RecipeSuggestion,
  inventoryItems: InventoryItem[],
): InventoryMatch[] {
  const results: InventoryMatch[] = [];
  const usedIds = new Set<string>();

  for (const usedName of recipe.usedInventoryItems) {
    if (isBasicIngredient(usedName.toLowerCase())) continue;
    for (const item of inventoryItems) {
      if (usedIds.has(item.id)) continue;
      if (namesMatch(usedName, item.name)) {
        const ingredient = recipe.ingredients.find(ing =>
          namesMatch(extractIngredientName(ing), usedName) ||
          namesMatch(extractIngredientName(ing), item.name),
        );
        const grams = ingredient ? extractIngredientGrams(ingredient) : 0;
        usedIds.add(item.id);
        results.push({
          inventoryItem: item,
          trackedName: usedName,
          trackedAmountGrams: grams,
        });
        break;
      }
    }
  }

  return results;
}

// Apply deductions to inventory
export async function applyInventoryDeductions(
  selected: InventoryMatch[],
  updateItem: (id: string, changes: Partial<Omit<InventoryItem, 'id'>>) => Promise<void>,
  removeItem: (id: string) => Promise<void>,
): Promise<void> {
  for (const match of selected) {
    const currentGrams = parseGrams(match.inventoryItem.qty);
    const deductGrams = match.trackedAmountGrams;
    const remaining = Math.max(0, currentGrams - deductGrams);

    if (remaining === 0 || deductGrams <= 0) {
      await removeItem(match.inventoryItem.id);
    } else {
      const isLiquid = /ml|l\b/i.test(match.inventoryItem.qty);
      const unit = isLiquid ? 'ml' : 'g';
      await updateItem(match.inventoryItem.id, { qty: `${Math.round(remaining)}${unit}` });
    }
  }
}
