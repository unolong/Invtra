import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useFoodLog } from '@/context/food-log-context';
import { useInventory } from '@/context/inventory-context';
import { getRecipeSuggestions, type RecipeSuggestion } from '@/services/anthropic';

const ACCENT = '#c8ff00';

const RECIPE_BG_COLORS = [
  '#1a3828',
  '#381a1c',
  '#1a1c38',
  '#363618',
  '#281a38',
];

type Filter = 'alle' | 'inventar' | 'schnell' | 'vegetarisch' | 'highprotein';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'alle', label: 'Alle' },
  { key: 'inventar', label: 'Inventar-Match' },
  { key: 'schnell', label: '< 15 Min.' },
  { key: 'vegetarisch', label: 'Vegetarisch' },
  { key: 'highprotein', label: 'Highprotein' },
];

export default function CookScreen() {
  const { totals, goals } = useFoodLog();
  const { items: inventoryItems } = useInventory();

  const remaining = {
    calories: Math.max(0, goals.calories - totals.calories),
    protein: Math.max(0, goals.protein - totals.protein),
    carbs: Math.max(0, goals.carbs - totals.carbs),
    fat: Math.max(0, goals.fat - totals.fat),
  };

  const [filter, setFilter] = useState<Filter>('alle');
  const [recipes, setRecipes] = useState<RecipeSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRecipes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getRecipeSuggestions(
        inventoryItems.map(i => ({ name: i.name, qty: i.qty })),
        remaining,
      );
      setRecipes(result);
    } catch (e: any) {
      setError(e.message ?? 'Rezepte konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [inventoryItems, remaining]);

  useEffect(() => { loadRecipes(); }, []);

  const filtered = useMemo(() => {
    switch (filter) {
      case 'inventar':    return recipes.filter(r => r.inventoryMatch >= 0.99);
      case 'schnell':     return recipes.filter(r => r.prepTime <= 15);
      case 'vegetarisch': return recipes.filter(r => r.vegetarian);
      case 'highprotein': return recipes.filter(r => r.protein >= 30);
      default:            return recipes;
    }
  }, [recipes, filter]);

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Was jetzt kochen?</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} hitSlop={12}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Macro card */}
        <View style={styles.macroCard}>
          <Text style={styles.macroCardLabel}>DU BRAUCHST NOCH</Text>
          <View style={styles.macroCardRow}>
            <View style={styles.kcalBlock}>
              <Text style={styles.kcalBig}>{Math.round(remaining.calories)}</Text>
              <Text style={styles.kcalUnit}>kcal</Text>
            </View>
            <View style={styles.macroPillsGroup}>
              <MacroPill value={Math.round(remaining.protein)} label="Protein" color="#4F8EF7" />
              <MacroPill value={Math.round(remaining.carbs)} label="Carbs" color="#F7A94F" />
              <MacroPill value={Math.round(remaining.fat)} label="Fett" color="#F74F4F" />
            </View>
          </View>
        </View>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
              onPress={() => setFilter(f.key)}
            >
              <Text style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Count label */}
        {!loading && !error && recipes.length > 0 && (
          <Text style={styles.countLabel}>{filtered.length} REZEPTE PASSEN</Text>
        )}

        {/* Content states */}
        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={ACCENT} size="large" />
            <Text style={styles.stateText}>KI erstellt Rezeptvorschläge…</Text>
            <Text style={styles.stateHint}>Das dauert ca. 10 Sekunden</Text>
          </View>
        ) : error ? (
          <View style={styles.stateCard}>
            <Text style={{ fontSize: 36, textAlign: 'center' }}>⚠️</Text>
            <Text style={styles.stateText}>{error}</Text>
            <TouchableOpacity style={styles.ghostBtn} onPress={loadRecipes}>
              <Text style={styles.ghostBtnText}>Nochmal versuchen</Text>
            </TouchableOpacity>
          </View>
        ) : recipes.length === 0 ? (
          <View style={styles.stateCard}>
            <Text style={{ fontSize: 40, textAlign: 'center' }}>🥦</Text>
            <Text style={styles.stateText}>Keine Rezepte geladen.</Text>
            <TouchableOpacity style={styles.accentBtn} onPress={loadRecipes}>
              <Text style={styles.accentBtnText}>Rezepte laden ✨</Text>
            </TouchableOpacity>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateText}>Kein Rezept passt zu diesem Filter.</Text>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => setFilter('alle')}>
              <Text style={styles.ghostBtnText}>Alle Rezepte zeigen</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filtered.map((recipe) => {
            const originalIndex = recipes.indexOf(recipe);
            return (
              <RecipeCard
                key={recipe.name}
                recipe={recipe}
                colorIndex={originalIndex}
                onPress={() =>
                  router.push({
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    pathname: '/recipe-detail' as any,
                    params: {
                      data: JSON.stringify(recipe),
                      colorIndex: String(originalIndex),
                    },
                  })
                }
              />
            );
          })
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── MacroPill ────────────────────────────────────────────────

function MacroPill({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={styles.macroPill}>
      <Text style={[styles.macroPillValue, { color }]}>{value}g</Text>
      <Text style={styles.macroPillLabel}>{label}</Text>
    </View>
  );
}

// ─── RecipeCard ───────────────────────────────────────────────

function RecipeCard({
  recipe,
  colorIndex,
  onPress,
}: {
  recipe: RecipeSuggestion;
  colorIndex: number;
  onPress: () => void;
}) {
  const bgColor = RECIPE_BG_COLORS[colorIndex % RECIPE_BG_COLORS.length];
  const matchPct = Math.round(recipe.inventoryMatch * 100);
  const allPresent = recipe.inventoryMatch >= 0.99;
  const missingCount = Math.max(
    0,
    Math.round(recipe.ingredients.length * (1 - recipe.inventoryMatch)),
  );

  const hint =
    recipe.vegetarian
      ? `Vegetarisch · ${recipe.description.slice(0, 38)}`
      : recipe.protein >= 30
      ? `Deckt fehlendes Protein · ${recipe.protein}g P`
      : recipe.description.slice(0, 52);

  return (
    <TouchableOpacity style={styles.recipeCard} onPress={onPress} activeOpacity={0.9}>
      {/* Image placeholder */}
      <View style={[styles.recipeImageArea, { backgroundColor: bgColor }]}>
        <View style={styles.recipeImageFade} />

        {/* Top row: time left, match right */}
        <View style={styles.recipeImageTopRow}>
          <View style={styles.timeBadge}>
            <Text style={styles.timeBadgeText}>{recipe.prepTime} Min.</Text>
          </View>
          <View style={styles.matchBadge}>
            <Text style={styles.matchBadgeText}>✦ {matchPct}% match</Text>
          </View>
        </View>

        {/* Bottom right: inventory status */}
        <View style={styles.recipeImageBottomRow}>
          {allPresent ? (
            <View style={styles.presentBadge}>
              <Text style={styles.presentBadgeText}>✓ Alles da</Text>
            </View>
          ) : (
            <View style={styles.absentBadge}>
              <Text style={styles.absentBadgeText}>⚠ {missingCount} fehlt</Text>
            </View>
          )}
        </View>
      </View>

      {/* Text content */}
      <View style={styles.recipeCardContent}>
        <Text style={styles.recipeName}>{recipe.name}</Text>
        <Text style={styles.recipeHint} numberOfLines={1}>{hint}</Text>

        <View style={styles.recipeMacroRow}>
          <Text style={styles.recipeMacroKcal}>{recipe.calories} kcal</Text>
          <View style={styles.recipeMacroDot} />
          <Text style={[styles.recipeMacroVal, { color: '#4F8EF7' }]}>{recipe.protein}g P</Text>
          <View style={styles.recipeMacroDot} />
          <Text style={[styles.recipeMacroVal, { color: '#F7A94F' }]}>{recipe.carbs}g C</Text>
          <View style={styles.recipeMacroDot} />
          <Text style={[styles.recipeMacroVal, { color: '#F74F4F' }]}>{recipe.fat}g F</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1a1a1a',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.5,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '700',
  },

  scroll: {
    padding: 16,
    paddingBottom: 48,
    gap: 14,
  },

  // Macro card
  macroCard: {
    backgroundColor: '#111111',
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: '#222222',
    padding: 18,
    gap: 14,
  },
  macroCardLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  macroCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  kcalBlock: {
    gap: 1,
  },
  kcalBig: {
    fontSize: 48,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -2,
    lineHeight: 52,
  },
  kcalUnit: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  macroPillsGroup: {
    flex: 1,
    gap: 7,
  },
  macroPill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 0.5,
    borderColor: '#222222',
  },
  macroPillValue: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  macroPillLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '500',
  },

  // Filter chips
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 99,
    backgroundColor: '#111111',
    borderWidth: 0.5,
    borderColor: '#222222',
  },
  filterChipActive: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
  },
  filterChipTextActive: {
    color: '#000',
  },

  // Count
  countLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: 2,
  },

  // State card
  stateCard: {
    backgroundColor: '#111111',
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: '#222222',
    padding: 32,
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  stateText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    lineHeight: 20,
  },
  stateHint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.25)',
    textAlign: 'center',
  },
  accentBtn: {
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 13,
    marginTop: 4,
  },
  accentBtnText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700',
  },
  ghostBtn: {
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 0.5,
    borderColor: '#333333',
  },
  ghostBtnText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontWeight: '600',
  },

  // Recipe card
  recipeCard: {
    backgroundColor: '#111111',
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: '#222222',
    overflow: 'hidden',
  },
  recipeImageArea: {
    height: 185,
  },
  recipeImageFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 110,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  recipeImageTopRow: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timeBadge: {
    backgroundColor: 'rgba(0,0,0,0.58)',
    borderRadius: 99,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  timeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  matchBadge: {
    backgroundColor: `${ACCENT}20`,
    borderRadius: 99,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderWidth: 0.5,
    borderColor: `${ACCENT}50`,
  },
  matchBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: ACCENT,
  },
  recipeImageBottomRow: {
    position: 'absolute',
    bottom: 13,
    right: 14,
  },
  presentBadge: {
    backgroundColor: 'rgba(38,222,129,0.18)',
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 0.5,
    borderColor: 'rgba(38,222,129,0.38)',
  },
  presentBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#26de81',
  },
  absentBadge: {
    backgroundColor: 'rgba(247,169,79,0.18)',
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 0.5,
    borderColor: 'rgba(247,169,79,0.38)',
  },
  absentBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F7A94F',
  },
  recipeCardContent: {
    padding: 16,
    gap: 6,
  },
  recipeName: {
    fontSize: 19,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.5,
    lineHeight: 24,
  },
  recipeHint: {
    fontSize: 12,
    color: ACCENT,
    fontWeight: '500',
    letterSpacing: -0.1,
    opacity: 0.9,
  },
  recipeMacroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 3,
  },
  recipeMacroKcal: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
  },
  recipeMacroDot: {
    width: 3,
    height: 3,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  recipeMacroVal: {
    fontSize: 12,
    fontWeight: '700',
  },
});
