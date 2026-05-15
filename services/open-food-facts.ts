const BASE_URL = 'https://world.openfoodfacts.org/api/v0/product';
const SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl';

export interface Product {
  barcode: string;
  name: string;
  brand: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
}

function parseProduct(data: any, barcode: string): Product | null {
  const n = data?.nutriments;
  if (!n) return null;
  const name = data.product_name_de || data.product_name || '';
  if (!name) return null;
  return {
    barcode,
    name,
    brand: data.brands || '',
    caloriesPer100g: n['energy-kcal_100g'] ?? n['energy-kcal'] ?? 0,
    proteinPer100g: n.proteins_100g ?? n.proteins ?? 0,
    carbsPer100g: n.carbohydrates_100g ?? n.carbohydrates ?? 0,
    fatPer100g: n.fat_100g ?? n.fat ?? 0,
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
      fields: 'product_name,product_name_de,brands,nutriments,code',
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
