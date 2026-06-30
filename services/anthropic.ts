import { callGemini, callGeminiWithAudio, callGeminiWithImage } from '@/services/gemini';
import {
  lookupShelfLife,
  SHELF_LIFE_CATEGORIES,
  type ShelfLifeCategory,
} from '@/constants/shelfLife';

function cleanJson(text: string): string {
  return text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();
}

// ─── Vision: Dish analysis (component decomposition) ──────────

export type DishComponent = {
  name: string;
  amount: number;
  unit: string;
  caloriesPer100: number;
  proteinPer100: number;
  carbsPer100: number;
  fatPer100: number;
  isHiddenFat: boolean;
};

export type DishAnalysisResult = {
  dishName: string;
  components: DishComponent[];
};

export async function analyzeDishPhoto(
  base64: string,
  meal: string,
  remaining: { calories: number; protein: number; carbs: number; fat: number },
): Promise<DishAnalysisResult> {
  const prompt = `Du bist ein Ernährungsexperte. Erkenne das Gericht auf dem Foto.

AUFGABE: Zerlege das Gericht in alle sichtbaren Komponenten (Nudeln, Soße, Fleisch, Beilage, Gemüse etc.).
REGEL: Gib das Gericht NIEMALS als eine einzige Komponente zurück. Immer in mindestens 3 Einzelteile aufteilen.
REGEL: Schätze für jede Komponente die tatsächlich sichtbare Menge in Gramm/ml auf dem Teller.
REGEL: Berücksichtige versteckte Fette (Öl, Butter, Sahne zur Zubereitung) als extra Komponente mit isHiddenFat:true.
REGEL: Nährwerte IMMER als pro 100g bzw. 100ml angeben, nicht als Gesamtwert.
REGEL: Wenn du Öl, Butter oder Sahne als separate Komponente mit isHiddenFat:true ausgibst, berechne die Nährwerte der anderen Komponenten OHNE dieses Zubereitungsfett. Das Fett wird ausschließlich in der separaten Öl/Butter-Komponente erfasst — keine Doppelzählung.
Bei Restaurant-Gerichten Fettmenge großzügiger schätzen.
Mahlzeit: ${meal}. Restmakros: ${Math.round(remaining.calories)}kcal, ${Math.round(remaining.protein)}g P, ${Math.round(remaining.carbs)}g C, ${Math.round(remaining.fat)}g F.

Antworte NUR mit JSON, kein anderer Text:
{"dishName":"Spaghetti Bolognese","components":[{"name":"Spaghetti","amount":200,"unit":"g","caloriesPer100":158,"proteinPer100":6,"carbsPer100":31,"fatPer100":1,"isHiddenFat":false},{"name":"Bolognese-Soße","amount":180,"unit":"g","caloriesPer100":120,"proteinPer100":8,"carbsPer100":5,"fatPer100":7,"isHiddenFat":false},{"name":"Parmesan","amount":20,"unit":"g","caloriesPer100":400,"proteinPer100":35,"carbsPer100":4,"fatPer100":28,"isHiddenFat":false},{"name":"Olivenöl","amount":10,"unit":"ml","caloriesPer100":880,"proteinPer100":0,"carbsPer100":0,"fatPer100":100,"isHiddenFat":true}]}
unit: "g"|"ml"|"Stück". Minimum 3 components.`;

  const raw = cleanJson(await callGeminiWithImage(base64, prompt));
  console.log('[analyzeDishPhoto] raw:', raw.slice(0, 500));

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');

  let parsed: any;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('[analyzeDishPhoto] parse error:', e, '\nraw:', raw.slice(0, 300));
    throw new Error('JSON parse failed');
  }

  const rawComponents: any[] = parsed.components ?? parsed.items ?? [];
  console.log('[analyzeDishPhoto] dishName:', parsed.dishName, 'components:', rawComponents.length);

  return {
    dishName: String(parsed.dishName ?? ''),
    components: rawComponents.map((c: any) => ({
      name:           String(c.name ?? ''),
      amount:         Math.max(1, Number(c.amount) || 1),
      unit:           (['g', 'ml', 'Stück'].includes(c.unit) ? c.unit : 'g') as string,
      caloriesPer100: Math.max(0, Math.round(Number(c.caloriesPer100) || 0)),
      proteinPer100:  Math.max(0, Math.round(Number(c.proteinPer100)  || 0)),
      carbsPer100:    Math.max(0, Math.round(Number(c.carbsPer100)    || 0)),
      fatPer100:      Math.max(0, Math.round(Number(c.fatPer100)      || 0)),
      isHiddenFat:    c.isHiddenFat === true,
    })),
  };
}

// ─── Vision: Food recognition (legacy) ────────────────────────

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
  matchPercent?: number;        // 0-100, AI-estimated
  missingIngredients?: string[];
  inventoryMatch?: number;      // legacy decimal kept for compat
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

  const prompt = `Erstelle GENAU 8 Rezepte mit bewusst unterschiedlichem Inventar-Match.

PFLICHT-VERTEILUNG (strikt einhalten):
- Mind. 2 Rezepte mit matchPercent = 100 (alle Hauptzutaten im Inventar vorhanden)
- Mind. 2 Rezepte mit matchPercent 60–99 (1–2 Zutaten fehlen, in missingIngredients nennen)
- Mind. 2 Rezepte mit matchPercent unter 60 (mehrere Zutaten fehlen)
- Mind. 2 Rezepte mit prepTime über 15 Minuten

Restmakros heute: ${Math.round(remaining.calories)}kcal, ${Math.round(remaining.protein)}g P, ${Math.round(remaining.carbs)}g C, ${Math.round(remaining.fat)}g F
Inventar (max 20 Artikel): ${inventoryList}

matchPercent: ganze Zahl 0–100. missingIngredients: fehlende Hauptzutaten (leer wenn 100%).
usedInventoryItems: nur Inventar-Artikel die tatsächlich im Rezept verwendet werden.
Abwechslungsreiche Stile: schnell, vegetarisch, proteinreich, saisonal, klassisch.

Antworte NUR mit JSON:
{"recipes":[{"name":"","description":"","prepTime":0,"difficulty":"einfach","calories":0,"protein":0,"carbs":0,"fat":0,"ingredients":[""],"steps":[""],"matchPercent":85,"missingIngredients":[],"usedInventoryItems":[""],"vegetarian":false}]}`;

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

export type BoundingBox = {
  x: number;      // top-left x, 0-100 percent of image width
  y: number;      // top-left y, 0-100 percent of image height
  width: number;  // percent of image width
  height: number; // percent of image height
};

export type InventoryPhotoItem = {
  name: string;
  quantity: number;
  unit: 'g' | 'ml' | 'Stück';
  originalDescription: string;
  category: string;
  confidence: number;
  idealStorage?: 'Kühlschrank' | 'Vorrat' | 'Tiefkühler';
  opened?: boolean | null;
  boundingBox?: BoundingBox;
};

export async function analyzeInventoryPhoto(
  base64: string,
): Promise<InventoryPhotoItem[]> {
  const prompt = `Erkenne alle sichtbaren Lebensmittel im Kühlschrank-Foto. Berechne Gesamtmenge (2×200g=400g).
Schätze die tatsächlich noch vorhandene Menge basierend auf dem sichtbaren Füllstand. Beispiel: halbvolle 1L Milchflasche → 500ml, angebrochene 500g Packung → ~250g.
WICHTIG: Wenn nicht erkennbar ist ob ein Produkt angebrochen ist, gehe immer davon aus dass es voll/ungeöffnet ist und verwende die volle Standardmenge des Produkts.
idealStorage-Regeln (wähle den idealen Lagerort für jedes Produkt):
- Tiefkühlprodukte (erkennbar an Verpackung/Name/TK-Schriftzug) → "Tiefkühler"
- Frisches Fleisch, Fisch, Milchprodukte, Eier, angebrochene Getränke → "Kühlschrank"
- Obst und Gemüse → "Kühlschrank" (Ausnahme: Bananen, Kartoffeln → "Vorrat")
- Konserven, Nudeln, Reis, Mehl, Öl, Soßen/Dressings im Glas, Brot → "Vorrat"
opened-Regeln (Zustand des Produkts):
- true: Produkt ist sichtbar angebrochen (offene Verpackung, angebrochenes Glas, angefangene Packung)
- false: Produkt ist ungeöffnet/originalverpackt
- null: Zustand nicht erkennbar
Antworte NUR mit JSON:
{"items":[{"name":"Red Bull","quantity":250,"unit":"ml","originalDescription":"Eine Dose Red Bull 250ml","category":"sonstiges","confidence":90,"idealStorage":"Kühlschrank","opened":false,"boundingBox":{"x":45,"y":20,"width":15,"height":25}}]}
unit: "g"|"ml"|"Stück". category: protein|carbs|gemüse|obst|milch|fett|sonstiges. confidence: 0-100.
idealStorage: "Kühlschrank"|"Vorrat"|"Tiefkühler" (Pflicht für jedes Produkt).
opened: true|false|null (Pflicht für jedes Produkt).
boundingBox PFLICHT für jedes Produkt (ungefähre Schätzung, keine pixelgenauen Koordinaten):
  x: linke Kante in Prozent (0-100) relativ zur Bildbreite
  y: obere Kante in Prozent (0-100) relativ zur Bildhöhe
  width: Breite des Produkts in Prozent der Bildbreite
  height: Höhe des Produkts in Prozent der Bildhöhe
Die Tags dienen zur visuellen Orientierung, nicht zur exakten Markierung – grobe Schätzungen sind ausreichend.`;

  const text = cleanJson(await callGeminiWithImage(base64, prompt));
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? '{}');
  return (parsed.items ?? []).map((item: any) => {
    const bb = item.boundingBox;
    const boundingBox: BoundingBox | undefined =
      bb && typeof bb.x === 'number' && typeof bb.y === 'number'
        ? { x: bb.x, y: bb.y, width: bb.width ?? 20, height: bb.height ?? 20 }
        : undefined;
    const VALID_LOCATIONS = ['Kühlschrank', 'Vorrat', 'Tiefkühler'];
    return {
      name: item.name ?? '',
      quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
      unit: (['g', 'ml', 'Stück'].includes(item.unit) ? item.unit : 'g') as 'g' | 'ml' | 'Stück',
      originalDescription: item.originalDescription ?? '',
      category: item.category ?? 'sonstiges',
      confidence: (Number(item.confidence) || 0) / 100,
      idealStorage: (VALID_LOCATIONS.includes(item.idealStorage) ? item.idealStorage : 'Kühlschrank') as 'Kühlschrank' | 'Vorrat' | 'Tiefkühler',
      opened: item.opened === true ? true : item.opened === false ? false : null,
      boundingBox,
    };
  });
}

// ─── AI Shelf Life Estimation ──────────────────────────────────

export type ShelfLifeResult = {
  days: number;
  warning?: string;
  idealStorage?: 'Kühlschrank' | 'Vorrat' | 'Tiefkühler';
  category?: string;
};

export async function estimateShelfLife(
  productName: string,
  location: 'Kühlschrank' | 'Vorrat' | 'Tiefkühler',
  opened: boolean | null,
): Promise<ShelfLifeResult> {
  try {
    const prompt = `Kategorisiere "${productName}" in genau eine dieser Kategorien:
${SHELF_LIFE_CATEGORIES}

Bestimme außerdem den idealen Lagerort: "Kühlschrank" | "Vorrat" | "Tiefkühler"

Antworte NUR mit JSON: {"category":"gemüse","idealStorage":"Kühlschrank"}`;

    const text = cleanJson(await callGemini(prompt));
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error('No JSON');
    const data = JSON.parse(jsonMatch[0]);

    const category = (data.category as ShelfLifeCategory) ?? 'sonstiges';
    const VALID = ['Kühlschrank', 'Vorrat', 'Tiefkühler'] as const;
    const idealStorage = (VALID.includes(data.idealStorage) ? data.idealStorage : 'Kühlschrank') as 'Kühlschrank' | 'Vorrat' | 'Tiefkühler';

    const { days, unsuitable } = lookupShelfLife(category, location, opened);

    return {
      days,
      warning: unsuitable ? `Nicht zur Lagerung im ${location} geeignet.` : undefined,
      idealStorage,
      category,
    };
  } catch {
    const fallback: Record<string, number> = { Kühlschrank: 7, Vorrat: 30, Tiefkühler: 180 };
    return { days: fallback[location] ?? 7 };
  }
}

// ─── Voice: Meal tracking ──────────────────────────────────────

export type VoiceMealComponent = {
  name: string;
  amount: number;
  unit: string;
};

export type VoiceMealResult = {
  mealDescription: string;
  components: VoiceMealComponent[];
  mealType: 'Frühstück' | 'Mittagessen' | 'Abendessen' | 'Snacks';
};

export async function analyzeVoiceMeal(uri: string): Promise<VoiceMealResult> {
  const prompt = `Du bist ein Ernährungsassistent. Transkribiere und analysiere diese Sprachaufnahme.
Der Nutzer beschreibt was er gegessen hat oder essen möchte.

WICHTIG: Wenn die Audioaufnahme leer ist, zu leise ist, nur Hintergrundgeräusche enthält, oder kein klares Lebensmittel/Gericht genannt wird, gib IMMER zurück: {"error":"Nichts erkannt"}
Erfinde NIEMALS Produkte oder rate was gemeint sein könnte wenn die Sprache nicht klar und deutlich ein Lebensmittel nennt.
Lieber {"error":"Nichts erkannt"} zurückgeben als etwas Falsches.

Extrahiere:
1. Alle Lebensmittel/Gerichte mit geschätzter Menge
2. Die Mahlzeit-Art (Frühstück/Mittagessen/Abendessen/Snacks) falls erwähnt, sonst schätze basierend auf Kontext

Antworte NUR mit JSON:
{"mealDescription":"Chicken Bowl mit Reis","components":[{"name":"Hühnerbrust","amount":150,"unit":"g"},{"name":"Basmatireis","amount":200,"unit":"g"}],"mealType":"Mittagessen"}

unit: "g"|"ml"|"Stück". Schätze vernünftige Mengen falls nicht explizit genannt.`;

  const raw = cleanJson(await callGeminiWithAudio(uri, prompt));
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Keine Spracheingabe erkannt');
  const parsed = JSON.parse(jsonMatch[0]);
  if (parsed.error || !parsed.components || parsed.components.length === 0) {
    throw new Error('Nichts erkannt');
  }
  const VALID_MEALS = ['Frühstück', 'Mittagessen', 'Abendessen', 'Snacks'] as const;
  return {
    mealDescription: String(parsed.mealDescription ?? ''),
    components: (parsed.components ?? []).map((c: any) => ({
      name: String(c.name ?? ''),
      amount: Math.max(1, Number(c.amount) || 1),
      unit: String(c.unit ?? 'g'),
    })),
    mealType: VALID_MEALS.includes(parsed.mealType) ? parsed.mealType : 'Snacks',
  };
}

// ─── Voice: Inventory input ────────────────────────────────────

export type VoiceInventoryItem = {
  name: string;
  amount: number;
  unit: string;
  idealStorage: 'Kühlschrank' | 'Vorrat' | 'Tiefkühler';
};

export async function analyzeVoiceInventory(uri: string): Promise<VoiceInventoryItem[]> {
  const prompt = `Du bist ein Kühlschrank-Assistent. Transkribiere und analysiere diese Sprachaufnahme.
Der Nutzer nennt Lebensmittel die er ins Inventar eintragen möchte.

WICHTIG: Wenn die Audioaufnahme leer ist, zu leise ist, nur Hintergrundgeräusche enthält, oder kein klares Lebensmittel genannt wird, gib IMMER zurück: {"error":"Nichts erkannt"}
Erfinde NIEMALS Produkte oder rate was gemeint sein könnte wenn die Sprache nicht klar und deutlich ein Lebensmittel nennt.
Lieber {"error":"Nichts erkannt"} zurückgeben als etwas Falsches.

Extrahiere alle genannten Produkte mit Menge und idealem Lagerort.

idealStorage-Regeln:
- Frisches Fleisch, Fisch, Milchprodukte, Eier, angebrochene Getränke → "Kühlschrank"
- Konserven, Nudeln, Reis, Mehl, Öl, Brot → "Vorrat"
- Tiefkühlprodukte → "Tiefkühler"

Antworte NUR mit JSON:
{"items":[{"name":"Hühnerbrust","amount":500,"unit":"g","idealStorage":"Kühlschrank"},{"name":"Pasta","amount":500,"unit":"g","idealStorage":"Vorrat"}]}

unit: "g"|"ml"|"Stück". Schätze Standardmengen falls nicht genannt.`;

  const raw = cleanJson(await callGeminiWithAudio(uri, prompt));
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  const parsed = JSON.parse(jsonMatch[0]);
  if (parsed.error || !parsed.items) return [];
  const VALID_LOCATIONS = ['Kühlschrank', 'Vorrat', 'Tiefkühler'] as const;
  return (parsed.items as any[]).map(item => ({
    name: String(item.name ?? ''),
    amount: Math.max(1, Number(item.amount) || 1),
    unit: String(item.unit ?? 'g'),
    idealStorage: VALID_LOCATIONS.includes(item.idealStorage) ? item.idealStorage : 'Kühlschrank',
  }));
}
