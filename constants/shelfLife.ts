export type ShelfLifeCategory =
  | 'rohes_fleisch'
  | 'rohes_geflügel'
  | 'fisch_roh'
  | 'wurst_aufschnitt'
  | 'tiefkühlkost'
  | 'milch'
  | 'joghurt_quark'
  | 'käse_hart'
  | 'käse_weich'
  | 'eier'
  | 'brot'
  | 'obst'
  | 'gemüse'
  | 'nudeln_reis_trocken'
  | 'konserven'
  | 'öl_essig'
  | 'soßen_glas'
  | 'mehl_zucker'
  | 'sonstiges';

export type OpenedEntry   = { ungeöffnet: number; geöffnet: number };
export type ShelfLifeEntry = {
  kühlschrank: OpenedEntry;
  vorrat:      OpenedEntry;
  tiefkühler:  OpenedEntry;
};

export const SHELF_LIFE: Record<ShelfLifeCategory, ShelfLifeEntry> = {
  rohes_fleisch: {
    kühlschrank: { ungeöffnet: 3,    geöffnet: 2   },
    vorrat:      { ungeöffnet: 0,    geöffnet: 0   },
    tiefkühler:  { ungeöffnet: 120,  geöffnet: 90  },
  },
  rohes_geflügel: {
    kühlschrank: { ungeöffnet: 2,    geöffnet: 1   },
    vorrat:      { ungeöffnet: 0,    geöffnet: 0   },
    tiefkühler:  { ungeöffnet: 270,  geöffnet: 180 },
  },
  fisch_roh: {
    kühlschrank: { ungeöffnet: 2,    geöffnet: 1   },
    vorrat:      { ungeöffnet: 0,    geöffnet: 0   },
    tiefkühler:  { ungeöffnet: 90,   geöffnet: 60  },
  },
  wurst_aufschnitt: {
    kühlschrank: { ungeöffnet: 14,   geöffnet: 3   },
    vorrat:      { ungeöffnet: 0,    geöffnet: 0   },
    tiefkühler:  { ungeöffnet: 60,   geöffnet: 30  },
  },
  tiefkühlkost: {
    kühlschrank: { ungeöffnet: 1,    geöffnet: 1   },
    vorrat:      { ungeöffnet: 0,    geöffnet: 0   },
    tiefkühler:  { ungeöffnet: 180,  geöffnet: 90  },
  },
  milch: {
    kühlschrank: { ungeöffnet: 10,   geöffnet: 4   },
    vorrat:      { ungeöffnet: 0,    geöffnet: 0   },
    tiefkühler:  { ungeöffnet: 90,   geöffnet: 0   },
  },
  joghurt_quark: {
    kühlschrank: { ungeöffnet: 21,   geöffnet: 3   },
    vorrat:      { ungeöffnet: 0,    geöffnet: 0   },
    tiefkühler:  { ungeöffnet: 60,   geöffnet: 30  },
  },
  käse_hart: {
    kühlschrank: { ungeöffnet: 30,   geöffnet: 14  },
    vorrat:      { ungeöffnet: 0,    geöffnet: 0   },
    tiefkühler:  { ungeöffnet: 180,  geöffnet: 90  },
  },
  käse_weich: {
    kühlschrank: { ungeöffnet: 14,   geöffnet: 5   },
    vorrat:      { ungeöffnet: 0,    geöffnet: 0   },
    tiefkühler:  { ungeöffnet: 90,   geöffnet: 0   },
  },
  eier: {
    kühlschrank: { ungeöffnet: 28,   geöffnet: 2   },
    vorrat:      { ungeöffnet: 14,   geöffnet: 1   },
    tiefkühler:  { ungeöffnet: 0,    geöffnet: 0   },
  },
  brot: {
    kühlschrank: { ungeöffnet: 7,    geöffnet: 5   },
    vorrat:      { ungeöffnet: 5,    geöffnet: 3   },
    tiefkühler:  { ungeöffnet: 90,   geöffnet: 90  },
  },
  obst: {
    kühlschrank: { ungeöffnet: 10,   geöffnet: 3   },
    vorrat:      { ungeöffnet: 4,    geöffnet: 2   },
    tiefkühler:  { ungeöffnet: 365,  geöffnet: 180 },
  },
  gemüse: {
    kühlschrank: { ungeöffnet: 7,    geöffnet: 4   },
    vorrat:      { ungeöffnet: 2,    geöffnet: 1   },
    tiefkühler:  { ungeöffnet: 365,  geöffnet: 180 },
  },
  nudeln_reis_trocken: {
    kühlschrank: { ungeöffnet: 730,  geöffnet: 365 },
    vorrat:      { ungeöffnet: 730,  geöffnet: 365 },
    tiefkühler:  { ungeöffnet: 730,  geöffnet: 730 },
  },
  konserven: {
    kühlschrank: { ungeöffnet: 1095, geöffnet: 4   },
    vorrat:      { ungeöffnet: 1095, geöffnet: 0   },
    tiefkühler:  { ungeöffnet: 0,    geöffnet: 0   },
  },
  öl_essig: {
    kühlschrank: { ungeöffnet: 730,  geöffnet: 365 },
    vorrat:      { ungeöffnet: 730,  geöffnet: 180 },
    tiefkühler:  { ungeöffnet: 0,    geöffnet: 0   },
  },
  soßen_glas: {
    kühlschrank: { ungeöffnet: 365,  geöffnet: 30  },
    vorrat:      { ungeöffnet: 365,  geöffnet: 0   },
    tiefkühler:  { ungeöffnet: 0,    geöffnet: 0   },
  },
  mehl_zucker: {
    kühlschrank: { ungeöffnet: 730,  geöffnet: 365 },
    vorrat:      { ungeöffnet: 730,  geöffnet: 365 },
    tiefkühler:  { ungeöffnet: 730,  geöffnet: 730 },
  },
  sonstiges: {
    kühlschrank: { ungeöffnet: 7,    geöffnet: 5   },
    vorrat:      { ungeöffnet: 7,    geöffnet: 5   },
    tiefkühler:  { ungeöffnet: 90,   geöffnet: 60  },
  },
};

export const SHELF_LIFE_CATEGORIES = Object.keys(SHELF_LIFE).join(', ');

export function lookupShelfLife(
  category: string,
  location: 'Kühlschrank' | 'Vorrat' | 'Tiefkühler',
  opened: boolean | null,
): { days: number; unsuitable: boolean } {
  const entry = SHELF_LIFE[category as ShelfLifeCategory] ?? SHELF_LIFE.sonstiges;
  const locationKey =
    location === 'Kühlschrank' ? 'kühlschrank' :
    location === 'Vorrat'      ? 'vorrat' :
                                 'tiefkühler';
  const openedKey = opened === true ? 'geöffnet' : 'ungeöffnet';
  const days = entry[locationKey][openedKey];
  return { days, unsuitable: days === 0 };
}
