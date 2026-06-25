import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';
const GEMINI_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '';

function getApiKey(): string {
  if (!API_KEY) throw new Error('EXPO_PUBLIC_ANTHROPIC_API_KEY nicht gesetzt');
  return API_KEY;
}

function getGeminiClient() {
  if (!GEMINI_KEY) throw new Error('EXPO_PUBLIC_GEMINI_API_KEY nicht gesetzt');
  return new GoogleGenerativeAI(GEMINI_KEY);
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
  const apiKey = getApiKey();
  const prompt = `Analysiere dieses Foto und erkenne alle sichtbaren Lebensmittel/Gerichte. Schätze Portionsgrößen und Makronährstoffe realistisch.

Noch verfügbare Tagesmakros: ${Math.round(remaining.calories)} kcal, ${Math.round(remaining.protein)}g Protein, ${Math.round(remaining.carbs)}g Carbs, ${Math.round(remaining.fat)}g Fett.

Antworte AUSSCHLIESSLICH mit diesem JSON (kein anderer Text):
{
  "items": [
    { "name": "...", "grams": 150, "calories": 200, "protein": 25, "carbs": 5, "fat": 8, "confidence": 0.92 }
  ],
  "hidden": [
    { "name": "Öl/Fett (geschätzt)", "calories": 40 }
  ]
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `API Fehler ${res.status}`);
  }

  const data = await res.json();
  const text: string = data.content?.[0]?.text ?? '{}';
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
  inventoryMatch: number; // 0.0 – 1.0
  usedInventoryItems: string[];
  vegetarian: boolean;
};

export async function getRecipeSuggestions(
  inventoryItems: Array<{ name: string; qty: string }>,
  remaining: { calories: number; protein: number; carbs: number; fat: number },
): Promise<RecipeSuggestion[]> {
  const inventoryList = inventoryItems.length > 0
    ? inventoryItems.map(i => `- ${i.name}: ${i.qty}`).join('\n')
    : '(Inventar leer – erstelle allgemeine Rezepte)';

  const prompt = `Du bist Ernährungsberater und Koch. Erstelle genau 4 verschiedene Rezeptvorschläge für heute.

Noch verfügbare Tagesmakros:
- Kalorien: ${Math.round(remaining.calories)} kcal
- Protein: ${Math.round(remaining.protein)}g
- Kohlenhydrate: ${Math.round(remaining.carbs)}g
- Fett: ${Math.round(remaining.fat)}g

Inventar:
${inventoryList}

Erstelle 4 Rezepte die unterschiedliche Stile abdecken (z.B. schnell, protein-reich, vegetarisch, etc.).
Priorisiere Inventar-Zutaten. Nährwerte sollen realistisch zur Portion passen.

Antworte AUSSCHLIESSLICH mit diesem JSON (kein anderer Text):
{
  "recipes": [
    {
      "name": "Rezeptname",
      "description": "1-2 Sätze Beschreibung",
      "prepTime": 20,
      "difficulty": "einfach",
      "calories": 450,
      "protein": 35,
      "carbs": 30,
      "fat": 15,
      "fiber": 5,
      "sugar": 8,
      "ingredients": ["200g Hähnchenbrust", "100g Reis", "1 EL Olivenöl"],
      "steps": ["Schritt eins.", "Schritt zwei.", "Schritt drei."],
      "inventoryMatch": 0.75,
      "usedInventoryItems": ["Hähnchenbrust", "Reis"],
      "vegetarian": false
    }
  ]
}`;

  try {
    const genAI = getGeminiClient();
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? '{}');
    return parsed.recipes ?? [];
  } catch {
    throw new Error('Rezepte konnten nicht geladen werden. Bitte versuche es erneut.');
  }
}

// ─── Vision: Inventory scan ────────────────────────────────────

export type InventoryPhotoItem = {
  name: string;
  qty: string;
  category: string;
  confidence: number;
};

export async function analyzeInventoryPhoto(
  base64: string,
): Promise<InventoryPhotoItem[]> {
  const apiKey = getApiKey();
  const prompt = `Erkenne alle sichtbaren Lebensmittel in diesem Bild. Schätze Mengen.

Antworte AUSSCHLIESSLICH mit diesem JSON:
{
  "items": [
    { "name": "Hähnchenbrust", "qty": "500g", "category": "protein", "confidence": 0.92 }
  ]
}

Kategorien: protein, carbs, gemüse, obst, milch, fett, sonstiges`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `API Fehler ${res.status}`);
  }

  const data = await res.json();
  const text: string = data.content?.[0]?.text ?? '{}';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? '{}');
  return parsed.items ?? [];
}

// ─── AI Shelf Life Estimation ──────────────────────────────────

export async function estimateShelfLife(
  productName: string,
  location: 'Kühlschrank' | 'Vorrat' | 'Tiefkühler',
): Promise<{ days: number; warning?: string }> {
  try {
    const genAI = getGeminiClient();
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
    const prompt = `Schätze die Haltbarkeit von "${productName}" bei Lagerung in: ${location}.
Antworte NUR mit JSON, kein anderer Text:
{"days": 7, "warning": null}
days = geschätzte Haltbarkeit in Tagen (ganze Zahl, 1-730)
warning = null oder kurzer Hinweis auf Deutsch wenn Lagerort ungeeignet (max 60 Zeichen)`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
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
