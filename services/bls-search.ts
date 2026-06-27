import blsData from '@/assets/data/bls.json';

export interface BlsItem {
  id: string;
  name: string;
  kategorie: string;
  pro100g: {
    kalorien: number;
    protein: number;
    kohlenhydrate: number;
    fett: number;
    ballaststoffe: number;
    zucker: number;
    salz: number;
    gesaettigteFettsaeuren: number;
  };
}

const data = blsData as BlsItem[];

// First-word fragments that get a relevance boost — these are the most commonly searched staples
const STAPLES = new Set([
  'eier', 'ei',
  'hähnchenbrust', 'hähnchenbrustfilet', 'hühnerbrust',
  'reis',
  'milch', 'vollmilch',
  'haferflocken',
  'quark', 'magerquark', 'speisequark',
  'joghurt', 'naturjoghurt',
  'butter',
  'banane',
  'apfel',
  'tomate', 'tomaten',
  'kartoffel', 'kartoffeln',
]);

function hasNutrition(item: BlsItem): boolean {
  const p = item.pro100g;
  return !(p.kalorien === 0 && p.protein === 0 && p.fett === 0 && p.kohlenhydrate === 0);
}

/**
 * Search the BLS food database.
 *
 * Scoring tiers (higher = shown first):
 *   1000 – exact match
 *    500 – name starts with the full query
 *    200 – first term starts the name (multi-word queries only)
 *      0 – name contains the query but doesn't start with it
 *
 * Adjustments on top of tier:
 *   +200  staple food (first word is in the STAPLES set)
 *   +100  recently used by this user
 *   −0.5× name length (prefer shorter, more specific names within a tier)
 */
export function searchBls(
  query: string,
  {
    limit = 20,
    recentNames = new Set<string>(),
  }: { limit?: number; recentNames?: Set<string> } = {},
): BlsItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const isSingleChar = q.length === 1;
  const terms = q.split(/\s+/);
  const results: Array<{ item: BlsItem; score: number }> = [];

  for (const item of data) {
    if (!hasNutrition(item)) continue;

    const nameLower = item.name.toLowerCase();

    // All search terms must appear somewhere in the name
    if (!terms.every(t => nameLower.includes(t))) continue;

    let score = 0;

    if (nameLower === q) {
      score += 1000;
    } else if (nameLower.startsWith(q)) {
      score += 500;
    } else if (!isSingleChar && terms.length > 1 && nameLower.startsWith(terms[0])) {
      score += 200;
    } else if (isSingleChar) {
      continue; // single-char: only prefix matches, skip "contains" hits
    }
    // Multi-char "contains" (doesn't start with): score stays 0, ranked last

    // Staple boost — check the first word/segment of the product name
    const firstWord = nameLower.split(/[\s,(]/)[0];
    if (STAPLES.has(firstWord)) score += 200;

    // Recently used boost
    if (recentNames.has(nameLower)) score += 100;

    // Prefer shorter names within the same tier (more specific / canonical)
    score -= nameLower.length * 0.5;

    results.push({ item, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map(r => r.item);
}
