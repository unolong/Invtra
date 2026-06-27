import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useInventory } from '@/context/inventory-context';
import { calcInventoryMatch, isBasicIngredient, matchBadgeColor } from '@/lib/recipe-match';
import type { RecipeSuggestion } from '@/services/anthropic';

const ACCENT = '#c8ff00';

const RECIPE_BG_COLORS = [
  '#1a3828',
  '#381a1c',
  '#1a1c38',
  '#363618',
  '#281a38',
];

export default function RecipeDetailScreen() {
  const { data, colorIndex: ci } = useLocalSearchParams<{ data: string; colorIndex: string }>();
  const insets = useSafeAreaInsets();
  const { items: inventoryItems } = useInventory();
  const [nutritionExpanded, setNutritionExpanded] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  if (!data) return null;

  const recipe: RecipeSuggestion = JSON.parse(data as string);
  const bgColor = RECIPE_BG_COLORS[(parseInt(ci ?? '0', 10)) % RECIPE_BG_COLORS.length];

  useEffect(() => {
    AsyncStorage.getItem('saved_recipes').then(raw => {
      const saved: RecipeSuggestion[] = raw ? JSON.parse(raw) : [];
      setIsSaved(saved.some(r => r.name === recipe.name));
    });
  }, [recipe.name]);

  async function toggleSave() {
    const raw = await AsyncStorage.getItem('saved_recipes');
    const saved: RecipeSuggestion[] = raw ? JSON.parse(raw) : [];
    let updated: RecipeSuggestion[];
    if (isSaved) {
      updated = saved.filter(r => r.name !== recipe.name);
    } else {
      updated = saved.some(r => r.name === recipe.name)
        ? saved
        : [...saved, recipe];
    }
    await AsyncStorage.setItem('saved_recipes', JSON.stringify(updated));
    setIsSaved(!isSaved);
  }
  const { matchPct, missing: missingCount } = calcInventoryMatch(recipe.ingredients, inventoryItems);
  const matchC = matchBadgeColor(matchPct);

  const isPresent = (ingredient: string) => {
    const lower = ingredient.toLowerCase();
    if (isBasicIngredient(lower)) return true;
    return inventoryItems.some(item => lower.includes(item.name.toLowerCase()));
  };

  return (
    <View style={styles.root}>
      {/* Full-bleed image header */}
      <View style={[styles.imageHeader, { backgroundColor: bgColor }]}>
        <View style={styles.imageHeaderFade} />
        <TouchableOpacity
          style={[styles.backBtn, { top: insets.top + 12 }]}
          onPress={() => router.back()}
          hitSlop={12}
          activeOpacity={0.8}
        >
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Badges */}
        <View style={styles.badgesRow}>
          <View style={styles.infoBadge}>
            <Text style={styles.infoBadgeText}>{recipe.prepTime} Min.</Text>
          </View>
          <View style={styles.infoBadge}>
            <Text style={styles.infoBadgeText}>{recipe.difficulty ?? 'einfach'}</Text>
          </View>
          <View style={[styles.infoBadge, { backgroundColor: `${matchC}15`, borderColor: `${matchC}40` }]}>
            <Text style={[styles.matchBadgeText, { color: matchC }]}>✦ {matchPct}% match</Text>
          </View>
        </View>

        {/* Title */}
        <Text style={styles.recipeTitle}>{recipe.name}</Text>

        {/* Nutrition card */}
        <View style={styles.nutritionCard}>
          <Text style={styles.nutritionCardLabel}>NÄHRWERTE PRO PORTION</Text>

          <View style={styles.nutritionMainRow}>
            <NutriItem value={recipe.calories} label="kcal" color="#fff" large />
            <NutriItem value={recipe.protein} label="Protein" unit="g" color="#4F8EF7" large />
            <NutriItem value={recipe.carbs} label="Carbs" unit="g" color="#F7A94F" large />
          </View>

          <View style={styles.nutritionSubRow}>
            <NutriItem value={recipe.fat} label="Fett" unit="g" color="#F74F4F" />
            <NutriItem value={recipe.fiber ?? 0} label="Ballaststoffe" unit="g" color="#26de81" />
            <NutriItem value={recipe.sugar ?? 0} label="Zucker" unit="g" color="#a78bfa" />
          </View>

          <TouchableOpacity
            style={styles.expandBtn}
            onPress={() => setNutritionExpanded(e => !e)}
          >
            <Text style={styles.expandBtnText}>
              Vitamine, Mineralien & mehr {nutritionExpanded ? '▲' : '▾'}
            </Text>
          </TouchableOpacity>

          {nutritionExpanded && (
            <View style={styles.expandedSection}>
              <View style={styles.expandedDivider} />
              <NutrientRow label="Natrium" value="—" />
              <NutrientRow label="Gesättigte Fettsäuren" value="—" />
              <NutrientRow label="Vitamin C" value="—" />
              <NutrientRow label="Eisen" value="—" />
            </View>
          )}
        </View>

        {/* Ingredients */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>ZUTATEN</Text>
            {missingCount === 0 ? (
              <Text style={styles.allPresentText}>Alles da</Text>
            ) : (
              <Text style={[styles.missingText, { color: matchC }]}>{missingCount} Zutaten fehlen</Text>
            )}
          </View>

          {recipe.ingredients.map((ing, i) => {
            const present = isPresent(ing);
            return (
              <View
                key={i}
                style={[
                  styles.ingredientRow,
                  i < recipe.ingredients.length - 1 && styles.ingredientRowDivider,
                ]}
              >
                <View
                  style={[
                    styles.checkCircle,
                    present ? styles.checkCircleGreen : styles.checkCircleOrange,
                  ]}
                >
                  <Text style={[styles.checkIcon, { color: present ? '#26de81' : '#F7A94F' }]}>
                    {present ? '✓' : '✗'}
                  </Text>
                </View>
                <Text style={styles.ingredientText}>{ing}</Text>
              </View>
            );
          })}
        </View>

        <View style={{ height: 110 }} />
      </ScrollView>

      {/* Bottom action buttons */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <>
            <TouchableOpacity
              style={[styles.saveBtn, isSaved && styles.saveBtnSaved]}
              onPress={toggleSave}
              activeOpacity={0.8}
            >
              <Text style={[styles.saveBtnText, isSaved && styles.saveBtnSavedText]}>
                {isSaved ? 'Gespeichert ✓' : 'Speichern'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cookBtn}
              onPress={() =>
                router.push({
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  pathname: '/cook-mode' as any,
                  params: { data },
                })
              }
              activeOpacity={0.85}
            >
              <Text style={styles.cookBtnText}>🍳  Jetzt kochen</Text>
            </TouchableOpacity>
          </>
      </View>

    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function NutriItem({
  value, label, unit = '', color, large = false,
}: {
  value: number; label: string; unit?: string; color: string; large?: boolean;
}) {
  return (
    <View style={styles.nutriItem}>
      <Text style={[styles.nutriValue, { color }, large ? styles.nutriValueLarge : styles.nutriValueSmall]}>
        {Math.round(value)}{unit}
      </Text>
      <Text style={styles.nutriLabel}>{label}</Text>
    </View>
  );
}

function NutrientRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.nutrientRow}>
      <Text style={styles.nutrientRowLabel}>{label}</Text>
      <Text style={styles.nutrientRowValue}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },

  // Image header
  imageHeader: {
    height: 240,
  },
  imageHeaderFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 130,
    backgroundColor: 'rgba(10,10,10,0.88)',
  },
  backBtn: {
    position: 'absolute',
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.52)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  backBtnText: {
    fontSize: 18,
    color: '#fff',
    fontWeight: '600',
    lineHeight: 22,
  },

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 18,
    gap: 16,
  },

  // Badges row
  badgesRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  infoBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: '#181818',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
  },
  infoBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
  },
  matchBadge: {
    backgroundColor: `${ACCENT}15`,
    borderColor: `${ACCENT}40`,
  },
  matchBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: ACCENT,
  },

  // Title
  recipeTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.8,
    lineHeight: 34,
  },

  // Nutrition card
  nutritionCard: {
    backgroundColor: '#111111',
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: '#222222',
    padding: 18,
    gap: 14,
  },
  nutritionCardLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  nutritionMainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  nutritionSubRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 14,
    borderTopWidth: 0.5,
    borderTopColor: '#1e1e1e',
  },
  nutriItem: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  nutriValue: {
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  nutriValueLarge: {
    fontSize: 22,
    lineHeight: 26,
  },
  nutriValueSmall: {
    fontSize: 16,
    lineHeight: 20,
  },
  nutriLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '500',
    textAlign: 'center',
  },
  expandBtn: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  expandBtnText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.38)',
    fontWeight: '500',
  },
  expandedSection: {
    gap: 0,
  },
  expandedDivider: {
    height: 0.5,
    backgroundColor: '#1e1e1e',
    marginBottom: 4,
  },
  nutrientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 9,
  },
  nutrientRowLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
  },
  nutrientRowValue: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.3)',
    fontWeight: '500',
  },

  // Ingredients section
  section: {
    backgroundColor: '#111111',
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: '#222222',
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  allPresentText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#26de81',
  },
  missingText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F7A94F',
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  ingredientRowDivider: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#1a1a1a',
  },
  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkCircleGreen: {
    backgroundColor: 'rgba(38,222,129,0.12)',
    borderWidth: 0.5,
    borderColor: 'rgba(38,222,129,0.28)',
  },
  checkCircleOrange: {
    backgroundColor: 'rgba(247,169,79,0.12)',
    borderWidth: 0.5,
    borderColor: 'rgba(247,169,79,0.28)',
  },
  checkIcon: {
    fontSize: 12,
    fontWeight: '700',
  },
  ingredientText: {
    flex: 1,
    fontSize: 14,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 20,
  },

  // Bottom bar
  bottomBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    backgroundColor: '#0a0a0a',
    borderTopWidth: 0.5,
    borderTopColor: '#1a1a1a',
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: '#181818',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    alignItems: 'center',
  },
  saveBtnSaved: {
    backgroundColor: 'rgba(38,222,129,0.12)',
    borderColor: 'rgba(38,222,129,0.35)',
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
  },
  saveBtnSavedText: {
    color: '#26de81',
  },
  cookBtn: {
    flex: 2,
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cookBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#000',
    letterSpacing: -0.2,
  },
});
