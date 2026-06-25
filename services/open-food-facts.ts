const BASE_URL = 'https://world.openfoodfacts.org/api/v0/product';
const SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl';

export type ProductType = 'liquid' | 'piece' | 'solid';

export interface Product {
  barcode: string;
  name: string;
  brand: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  sugarPer100g: number;
  fiberPer100g: number;
  saturatedFatPer100g: number;
  saltPer100g: number;
  productType: ProductType;
  isDrink: boolean;
  packageMl: number | null;
}

const DRINK_TAGS = new Set([
  'en:beverages', 'en:drinks', 'en:waters', 'en:mineral-waters', 'en:spring-waters',
  'en:sodas', 'en:carbonated-drinks', 'en:juices', 'en:fruit-juices', 'en:nectars',
  'en:beers', 'en:wines', 'en:spirits', 'en:teas', 'en:coffees', 'en:coffee',
  'en:energy-drinks', 'en:soft-drinks', 'en:non-alcoholic-beverages',
  'en:dairy-drinks', 'en:plant-based-beverages', 'en:sports-drinks',
  'en:milks', 'en:dairy-products-to-be-consumed-as-is',
]);

const PIECE_TAGS = new Set([
  'en:eggs', 'en:eggs-and-their-products', 'en:fresh-eggs', 'en:hen-eggs',
  'en:whole-eggs', 'en:boiled-eggs', 'en:egg-products',
]);

function detectProductType(data: any): ProductType {
  const tags: string[] = data.categories_tags ?? [];
  if (tags.some(t => DRINK_TAGS.has(t))) return 'liquid';
  if (tags.some(t => PIECE_TAGS.has(t))) return 'piece';
  return 'solid';
}

function parsePackageMl(quantity: string | undefined): number | null {
  if (!quantity) return null;
  // Multi-pack: "6 x 330 ml" → individual unit (330)
  const multi = quantity.match(/\d+\s*[x×]\s*([\d.,]+)\s*(ml|cl|l)\b/i);
  if (multi) return toMl(multi[1], multi[2]);
  // Simple: "500 ml", "1.5 l", "33 cl", "750ml"
  const simple = quantity.match(/([\d.,]+)\s*(ml|cl|l)\b/i);
  if (simple) return toMl(simple[1], simple[2]);
  return null;
}

function toMl(raw: string, unit: string): number {
  const v = parseFloat(raw.replace(',', '.'));
  switch (unit.toLowerCase()) {
    case 'l':  return Math.round(v * 1000);
    case 'cl': return Math.round(v * 10);
    default:   return Math.round(v);
  }
}

function parseProduct(data: any, barcode: string): Product | null {
  const n = data?.nutriments;
  if (!n) return null;
  const name = data.product_name_de || data.product_name || '';
  if (!name) return null;
  const productType = detectProductType(data);
  const isDrink = productType === 'liquid';
  return {
    barcode,
    name,
    brand: data.brands || '',
    caloriesPer100g: n['energy-kcal_100g'] ?? n['energy-kcal'] ?? 0,
    proteinPer100g: n.proteins_100g ?? n.proteins ?? 0,
    carbsPer100g: n.carbohydrates_100g ?? n.carbohydrates ?? 0,
    fatPer100g: n.fat_100g ?? n.fat ?? 0,
    sugarPer100g: n.sugars_100g ?? n.sugars ?? 0,
    fiberPer100g: n['fiber_100g'] ?? n['dietary-fiber_100g'] ?? 0,
    saturatedFatPer100g: n['saturated-fat_100g'] ?? n['saturated-fat'] ?? 0,
    saltPer100g: n.salt_100g ?? n.salt ?? 0,
    productType,
    isDrink,
    packageMl: isDrink ? parsePackageMl(data.quantity) : null,
  };
}

export async function fetchProductByBarcode(barcode: string): Promise<Product | null> {
  try {
    const res = await fetch(`${BASE_URL}/${barcode}.json`);
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    return parseProduct(data.product, barcode);
  } catch {
    return null;
  }
}

export async function searchProducts(query: string): Promise<Product[]> {
  try {
    const params = new URLSearchParams({
      search_terms: query,
      json: 'true',
      page_size: '15',
      fields: 'product_name,product_name_de,brands,nutriments,code,categories_tags,quantity',
    });
    const res = await fetch(`${SEARCH_URL}?${params}`);
    const data = await res.json();
    return (data.products ?? [])
      .map((p: any) => parseProduct(p, p.code))
      .filter(Boolean) as Product[];
  } catch {
    return [];
  }
}
