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

export function searchBls(query: string, limit = 20): BlsItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const terms = q.split(/\s+/);
  const results: Array<{ item: BlsItem; score: number }> = [];

  for (const item of data) {
    const nameLower = item.name.toLowerCase();

    // Skip entries with zero calories and zero macros (no nutritional data)
    if (
      item.pro100g.kalorien === 0 &&
      item.pro100g.protein === 0 &&
      item.pro100g.fett === 0 &&
      item.pro100g.kohlenhydrate === 0
    ) continue;

    // All terms must appear somewhere in the name
    if (!terms.every(t => nameLower.includes(t))) continue;

    let score = 0;
    // Exact match
    if (nameLower === q) score += 100;
    // Starts with full query
    if (nameLower.startsWith(q)) score += 50;
    // First term at start of name
    if (nameLower.startsWith(terms[0])) score += 20;
    // Prefer shorter names (more specific match)
    score -= item.name.length * 0.1;

    results.push({ item, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map(r => r.item);
}
