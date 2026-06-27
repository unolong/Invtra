export function matchBadgeColor(pct: number): string {
  if (pct >= 85) return '#26de81'; // green
  if (pct >= 65) return '#FFD700'; // yellow
  return '#F7A94F';                // orange (50-64%)
}

const BASIC_INGREDIENTS = [
  'salz', 'pfeffer', 'öl', 'olivenöl', 'sonnenblumenöl', 'rapsöl',
  'butter', 'zucker', 'mehl', 'wasser', 'essig', 'senf',
  'knoblauch', 'zwiebel', 'paprikapulver', 'oregano', 'basilikum',
  'thymian', 'rosmarin', 'zimt', 'muskat', 'curry', 'kurkuma',
  'chilipulver', 'cayennepfeffer', 'backpulver', 'natron',
  'speiseöl', 'pflanzenöl', 'margarine',
  'gewürz', 'gewürze', 'optional', 'nach geschmack', 'etwas', 'prise',
];

export function isBasicIngredient(ingredient: string): boolean {
  const lower = ingredient.toLowerCase();
  return (
    lower.includes('optional') ||
    BASIC_INGREDIENTS.some(b => lower.includes(b))
  );
}

export function calcInventoryMatch(
  ingredients: string[],
  inventoryItems: { name: string }[],
): { matchPct: number; missing: number } {
  const relevant = ingredients.filter(ing => !isBasicIngredient(ing));
  if (relevant.length === 0) return { matchPct: 100, missing: 0 };

  const matched = relevant.filter(
    ing => inventoryItems.some(item => ing.toLowerCase().includes(item.name.toLowerCase())),
  ).length;

  return {
    matchPct: Math.min(100, Math.round((matched / relevant.length) * 100)),
    missing: relevant.length - matched,
  };
}
