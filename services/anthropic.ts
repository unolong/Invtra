import { callGemini, callGeminiWithImage } from '@/services/gemini';

function cleanJson(text: string): string {
  return text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();
}

// ─── Vision: Food recognition ──────────────────────────────────

export type FoodPhotoItem = {
  name: string;
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
};

export type FoodPhotoResult = {
  items: FoodPhotoItem[];
  hidden: Array<{ name: string; calories: number }>;
};

export async function analyzeFoodPhoto(
  base64: string,
  meal: string,
  remaining: { calories: number; protein: number; carbs: number; fat: number },
): Promise<FoodPhotoResult> {
  const prompt = `Erkenne Lebensmittel im Foto. Restmakros heute: ${Math.round(remaining.calories)}kcal, ${Math.round(remaining.protein)}g P, ${Math.round(remaining.carbs)}g C, ${Math.round(remaining.fat)}g F.
Antworte NUR mit JSON:
{"items":[{"name":"","grams":0,"calories":0,"protein":0,"carbs":0,"fat":0,"confidence":0}],"hidden":[{"name":"","calories":0}]}`;

  const text = cleanJson(await callGeminiWithImage(base64, prompt));
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? '{}');
  return { items: parsed.items ?? [], hidden: parsed.hidden ?? [] };
}

// ─── Structured recipe suggestions ────────────────────────────

export type RecipeSuggestion = {
  name: string;
  description: string;
  prepTime: number;
  difficulty?: 'einfach' | 'mittel' | 'schwer';
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sugar?: number;
  ingredients: string[];
  steps: string[];
  inventoryMatch?: number;
  usedInventoryItems: string[];
  vegetarian: boolean;
};

export async function getRecipeSuggestions(
  inventoryItems: Array<{ name: string; qty: string }>,
  remaining: { calories: number; protein: number; carbs: number; fat: number },
): Promise<RecipeSuggestion[]> {
  // Max 20 items, names only — no qty to save tokens
  const topItems = inventoryItems.slice(0, 20);
  const inventoryList = topItems.length > 0
    ? topItems.map(i => i.name).join(', ')
    : 'leer';

  const prompt = `Erstelle 4 Rezepte. Restmakros: ${Math.round(remaining.calories)}kcal, ${Math.round(remaining.protein)}g P, ${Math.round(remaining.carbs)}g C, ${Math.round(remaining.fat)}g F.
Inventar (max 20): ${inventoryList}
Stile: schnell, proteinreich, vegetarisch, saisonal. Inventar bevorzugen.
inventoryMatch: Dezimalzahl 0.0–1.0 (nicht Prozent). usedInventoryItems: nur Inventar-Zutaten die im Rezept verwendet werden.
Antworte NUR mit JSON:
{"recipes":[{"name":"","description":"","prepTime":0,"difficulty":"einfach","calories":0,"protein":0,"carbs":0,"fat":0,"ingredients":[""],"steps":[""],"inventoryMatch":0.85,"usedInventoryItems":[""],"vegetarian":false}]}`;

  let rawText = '';
  try {
    rawText = await callGemini(prompt);
  } catch (err: unknown) {
    console.error('[Rezepte] Gemini API-Fehler:', err);
    throw new Error('Rezepte konnten nicht geladen werden. Bitte versuche es erneut.');
  }

  try {
    const cleaned = cleanJson(rawText);
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Kein JSON gefunden');
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.recipes)) throw new Error('Kein recipes-Array');
    return parsed.recipes;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Rezepte] JSON-Fehler:', err, '\nRohtext:', rawText.slice(0, 300));
    throw new Error(`Antwort konnte nicht verarbeitet werden: ${msg}`);
  }
}

// ─── Vision: Inventory scan ────────────────────────────────────

export type InventoryPhotoItem = {
  name: string;
  quantity: number;
  unit: 'g' | 'ml' | 'Stück';
  originalDescription: string;
  category: string;
  confidence: number;
};

export async function analyzeInventoryPhoto(
  base64: string,
): Promise<InventoryPhotoItem[]> {
  const prompt = `Erkenne Lebensmittel im Kühlschrank-Foto. Berechne Gesamtmenge (2×200g=400g).
Antworte NUR mit JSON:
{"items":[{"name":"","quantity":0,"unit":"g","originalDescription":"","category":"protein","confidence":0}]}
unit: "g"|"ml"|"Stück". category: protein|carbs|gemüse|obst|milch|fett|sonstiges.`;

  const text = cleanJson(await callGeminiWithImage(base64, prompt));
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? '{}');
  return (parsed.items ?? []).map((item: any) => ({
    name: item.name ?? '',
    quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
    unit: (['g', 'ml', 'Stück'].includes(item.unit) ? item.unit : 'g') as 'g' | 'ml' | 'Stück',
    originalDescription: item.originalDescription ?? '',
    category: item.category ?? 'sonstiges',
    confidence: Number(item.confidence) || 0,
  }));
}

// ─── AI Shelf Life Estimation ──────────────────────────────────

export async function estimateShelfLife(
  productName: string,
  location: 'Kühlschrank' | 'Vorrat' | 'Tiefkühler',
): Promise<{ days: number; warning?: string }> {
  try {
    const prompt = `Haltbarkeit von "${productName}" in ${location}? Antworte NUR: {"days":7,"warning":null}`;
    const text = cleanJson(await callGemini(prompt));
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error('No JSON');
    const data = JSON.parse(jsonMatch[0]);
    return {
      days: Math.max(1, Math.round(Number(data.days) || 7)),
      warning: data.warning || undefined,
    };
  } catch {
    const fallback: Record<string, number> = { Kühlschrank: 5, Vorrat: 30, Tiefkühler: 180 };
    return { days: fallback[location] ?? 7 };
  }
}
