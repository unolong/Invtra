import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

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

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function CookSheet({ visible, onClose }: Props) {
  const { totals, goals } = useFoodLog();
  const { items: inventoryItems } = useInventory();

  const remaining = useMemo(() => ({
    calories: Math.max(0, goals.calories - totals.calories),
    protein: Math.max(0, goals.protein - totals.protein),
    carbs: Math.max(0, goals.carbs - totals.carbs),
    fat: Math.max(0, goals.fat - totals.fat),
  }), [goals, totals]);

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

  // Load fresh recipes each time the sheet opens
  const prevVisible = useRef(false);
  useEffect(() => {
    if (visible && !prevVisible.current) {
      setFilter('alle');
      setRecipes([]);
      loadRecipes();
    }
    prevVisible.current = visible;
  }, [visible, loadRecipes]);

  const filtered = useMemo(() => {
    switch (filter) {
      case 'inventar':    return recipes.filter(r => r.inventoryMatch >= 0.99);
      case 'schnell':     return recipes.filter(r => r.prepTime <= 15);
      case 'vegetarisch': return recipes.filter(r => r.vegetarian);
      case 'highprotein': return recipes.filter(r => r.protein >= 30);
      default:            return recipes;
    }
  }, [recipes, filter]);

  const handleRecipePress = (recipe: RecipeSuggestion, originalIndex: number) => {
    onClose();
    setTimeout(() => {
      router.push({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pathname: '/recipe-detail' as any,
        params: {
          data: JSON.stringify(recipe),
          colorIndex: String(originalIndex),
        },
      });
    }, 350);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={s.root}>
        {/* Dimmed backdrop */}
        <TouchableOpacity style={s.backdrop} onPress={onClose} activeOpacity={1} />

        {/* Sheet */}
        <View style={s.sheet}>
          {/* Pill handle */}
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <Text style={s.headerTitle}>Was jetzt kochen?</Text>
            <TouchableOpacity onPress={onClose} style={s.closeBtn} hitSlop={12}>
              <Text style={s.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Scrollable content */}
          <ScrollView
            contentContainerStyle={s.scroll}
            showsVerticalScrollIndicator={false}
          >
            {/* Macro card */}
            <View style={s.macroCard}>
              <Text style={s.macroCardLabel}>DU BRAUCHST NOCH</Text>
              <View style={s.macroCardRow}>
                <View style={s.kcalBlock}>
                  <Text style={s.kcalBig}>{Math.round(remaining.calories)}</Text>
                  <Text style={s.kcalUnit}>kcal</Text>
                </View>
                <View style={s.macroPillsGroup}>
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
              contentContainerStyle={s.filterRow}
            >
              {FILTERS.map(f => (
                <TouchableOpacity
                  key={f.key}
                  style={[s.filterChip, filter === f.key && s.filterChipActive]}
                  onPress={() => setFilter(f.key)}
                >
                  <Text style={[s.filterChipText, filter === f.key && s.filterChipTextActive]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Count label */}
            {!loading && !error && recipes.length > 0 && (
              <Text style={s.countLabel}>{filtered.length} REZEPTE PASSEN</Text>
            )}

            {/* Content states */}
            {loading ? (
              <View style={s.stateCard}>
                <ActivityIndicator color={ACCENT} size="large" />
                <Text style={s.stateText}>KI erstellt Rezeptvorschläge…</Text>
                <Text style={s.stateHint}>Das dauert ca. 10 Sekunden</Text>
              </View>
            ) : error ? (
              <View style={s.stateCard}>
                <Text style={{ fontSize: 36, textAlign: 'center' }}>⚠️</Text>
                <Text style={s.stateText}>{error}</Text>
                <TouchableOpacity style={s.ghostBtn} onPress={loadRecipes}>
                  <Text style={s.ghostBtnText}>Nochmal versuchen</Text>
                </TouchableOpacity>
              </View>
            ) : recipes.length === 0 ? (
              <View style={s.stateCard}>
                <Text style={{ fontSize: 40, textAlign: 'center' }}>🥦</Text>
                <Text style={s.stateText}>Keine Rezepte geladen.</Text>
                <TouchableOpacity style={s.accentBtn} onPress={loadRecipes}>
                  <Text style={s.accentBtnText}>Rezepte laden ✨</Text>
                </TouchableOpacity>
              </View>
            ) : filtered.length === 0 ? (
              <View style={s.stateCard}>
                <Text style={s.stateText}>Kein Rezept passt zu diesem Filter.</Text>
                <TouchableOpacity style={s.ghostBtn} onPress={() => setFilter('alle')}>
                  <Text style={s.ghostBtnText}>Alle Rezepte zeigen</Text>
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
                    onPress={() => handleRecipePress(recipe, originalIndex)}
                  />
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── MacroPill ────────────────────────────────────────────────

function MacroPill({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={s.macroPill}>
      <Text style={[s.macroPillValue, { color }]}>{value}g</Text>
      <Text style={s.macroPillLabel}>{label}</Text>
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
    <TouchableOpacity style={s.recipeCard} onPress={onPress} activeOpacity={0.9}>
      <View style={[s.recipeImageArea, { backgroundColor: bgColor }]}>
        <View style={s.recipeImageFade} />

        <View style={s.recipeImageTopRow}>
          <View style={s.timeBadge}>
            <Text style={s.timeBadgeText}>{recipe.prepTime} Min.</Text>
          </View>
          <View style={s.matchBadge}>
            <Text style={s.matchBadgeText}>✦ {matchPct}% match</Text>
          </View>
        </View>

        <View style={s.recipeImageBottomRow}>
          {allPresent ? (
            <View style={s.presentBadge}>
              <Text style={s.presentBadgeText}>✓ Alles da</Text>
            </View>
          ) : (
            <View style={s.absentBadge}>
              <Text style={s.absentBadgeText}>⚠ {missingCount} fehlt</Text>
            </View>
          )}
        </View>
      </View>

      <View style={s.recipeCardContent}>
        <Text style={s.recipeName}>{recipe.name}</Text>
        <Text style={s.recipeHint} numberOfLines={1}>{hint}</Text>

        <View style={s.recipeMacroRow}>
          <Text style={s.recipeMacroKcal}>{recipe.calories} kcal</Text>
          <View style={s.recipeMacroDot} />
          <Text style={[s.recipeMacroVal, { color: '#4F8EF7' }]}>{recipe.protein}g P</Text>
          <View style={s.recipeMacroDot} />
          <Text style={[s.recipeMacroVal, { color: '#F7A94F' }]}>{recipe.carbs}g C</Text>
          <View style={s.recipeMacroDot} />
          <Text style={[s.recipeMacroVal, { color: '#F74F4F' }]}>{recipe.fat}g F</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  sheet: {
    backgroundColor: '#111111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '85%',
    borderWidth: 0.5,
    borderColor: '#222222',
    overflow: 'hidden',
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
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
    backgroundColor: '#181818',
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
    backgroundColor: '#181818',
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
    backgroundColor: '#181818',
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
    backgroundColor: '#181818',
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: '#222222',
    overflow: 'hidden',
  },
  recipeImageArea: {
    height: 160,
  },
  recipeImageFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 90,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  recipeImageTopRow: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
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
    bottom: 12,
    right: 12,
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
    padding: 14,
    gap: 5,
  },
  recipeName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.5,
    lineHeight: 22,
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
    marginTop: 2,
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
