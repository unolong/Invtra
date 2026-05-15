import AsyncStorage from '@react-native-async-storage/async-storage';

const API_KEY_STORAGE = '@fridgeai/anthropic-key';

export async function getApiKey(): Promise<string | null> {
  return AsyncStorage.getItem(API_KEY_STORAGE);
}

export async function saveApiKey(key: string): Promise<void> {
  await AsyncStorage.setItem(API_KEY_STORAGE, key.trim());
}

export async function getRecipeSuggestion(
  ingredients: string[],
  remaining: { calories: number; protein: number; carbs: number; fat: number },
  apiKey: string,
): Promise<string> {
  const prompt = `Du bist Ernährungsberater und Koch. Erstelle ein konkretes Rezept basierend auf diesen Informationen.

Noch verfügbare Makros für heute:
- Kalorien: ${Math.round(remaining.calories)} kcal
- Protein: ${remaining.protein.toFixed(1)}g
- Kohlenhydrate: ${remaining.carbs.toFixed(1)}g
- Fett: ${remaining.fat.toFixed(1)}g

Zutaten im Kühlschrank:
${ingredients.map(i => `- ${i}`).join('\n')}

Erstelle ein Rezept das möglichst viele dieser Zutaten verwendet und die Makros gut trifft. Antworte auf Deutsch.

Format (exakt so):
**Rezeptname**
Zubereitungszeit: X Minuten

**Zutaten**
- Menge Zutat
- ...

**Zubereitung**
1. Schritt
2. ...

**Nährwerte (ca.)**
Kalorien: X kcal | Protein: Xg | Kohlenhydrate: Xg | Fett: Xg`;

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
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `API Fehler ${res.status}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}
