import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { type FoodEntry, type Goals, type MacroTotals, useFoodLog } from '@/context/food-log-context';
import { useInventory } from '@/context/inventory-context';
import { loadStreak } from '@/lib/streak';

const ACCENT = '#c8ff00';
const MEAL_ORDER = ['Frühstück', 'Mittagessen', 'Snacks', 'Abendessen'];

export default function HomeScreen() {
  const { goals, entries, totals, profile, addEntry, removeEntry } = useFoodLog();
  const { items: inventoryItems } = useInventory();
  const [detailMeal, setDetailMeal] = useState<string | null>(null);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [showOverview, setShowOverview] = useState(false);
  const [streak, setStreak] = useState(0);

  useEffect(() => { loadStreak().then(setStreak); }, []);

  const mealGroups = useMemo(() => {
    const groups: Record<string, FoodEntry[]> = {};
    for (const m of MEAL_ORDER) groups[m] = [];
    for (const e of entries) {
      const key = MEAL_ORDER.includes(e.meal) ? e.meal : 'Sonstiges';
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    }
    return groups;
  }, [entries]);

  // Estimated baseline burn (Mifflin-St Jeor, neutral, sedentary ×1.2)
  const burnedEstimate = useMemo(() => {
    const { weight, height, age } = profile;
    if (weight > 0 && height > 0 && age > 0) {
      return Math.round((10 * weight + 6.25 * height - 5 * age + 80) * 1.2);
    }
    return 0;
  }, [profile]);

  const remaining = Math.max(0, goals.calories - totals.calories);
  const proteinMissing = Math.round(Math.max(0, goals.protein - totals.protein));
  const isBehind = proteinMissing > 30 || remaining > 600;

  const today = new Date();
  const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const dateLabel = `${days[today.getDay()]}, ${today.getDate()}. ${months[today.getMonth()]}`;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Brand bar */}
        <View style={styles.brandRow}>
          <Text style={styles.brandEmoji}>🥭</Text>
          <Text style={styles.brandName}>FridgeAI</Text>
        </View>

        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.dateLabel}>{dateLabel}</Text>
            <Text style={styles.headline}>Heute</Text>
          </View>
          {streak > 0 ? (
            <View style={styles.streakBadge}>
              <View style={styles.streakDot} />
              <Text style={styles.streakText}>{streak}-Tage-Streak 🔥</Text>
            </View>
          ) : (
            <View style={styles.streakBadgeEmpty}>
              <Text style={styles.streakTextEmpty}>Streak starten</Text>
            </View>
          )}
        </View>

        {/* Hero macro card */}
        <TouchableOpacity onPress={() => setShowOverview(true)} activeOpacity={0.85}>
          <View style={styles.card}>
            <View style={styles.statRow}>
              <StatBox label="Gegessen" value={Math.round(totals.calories)} unit="kcal" />
              <StatBox label="Verbrannt" value={burnedEstimate} unit="kcal" color="#5db84a" estimated={burnedEstimate > 0} />
              <StatBox label="Übrig" value={remaining} unit="kcal" color={ACCENT} highlight />
            </View>

            <View style={styles.cardDivider} />

            <View style={styles.ringRow}>
              <MacroRing kcal={totals.calories} goal={goals.calories} />
              <View style={styles.barsCol}>
                <MacroBar label="Protein" value={totals.protein} goal={goals.protein} color="#4f8bff" />
                <MacroBar label="Carbs"   value={totals.carbs}   goal={goals.carbs}   color="#ffb547" />
                <MacroBar label="Fett"    value={totals.fat}     goal={goals.fat}     color="#ff5e5e" />
              </View>
            </View>
          </View>
        </TouchableOpacity>

        {/* AI suggestion banner */}
        {isBehind && (
          <TouchableOpacity onPress={() => router.push('/cook' as any)} activeOpacity={0.8}>
            <View style={styles.suggBanner}>
              <View style={styles.suggIconBox}>
                <Text style={styles.suggEmoji}>✨</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.suggTitle}>
                  Dir fehlen noch{' '}
                  <Text style={{ color: ACCENT }}>{proteinMissing}g Protein</Text>
                </Text>
                <Text style={styles.suggSub}>
                  {inventoryItems.length > 0
                    ? `${inventoryItems.length} Zutaten im Inventar · KI schlägt Rezepte vor`
                    : 'KI schlägt passende Rezepte vor'}
                </Text>
              </View>
              <Text style={styles.suggChevron}>›</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Meals */}
        <Text style={styles.sectionLabel}>Mahlzeiten</Text>
        {Object.entries(mealGroups).map(([mealName, items]) => (
          <MealCard
            key={mealName}
            name={mealName}
            items={items}
            onAdd={() => router.push({ pathname: '/log-food', params: { meal: mealName } })}
            onOpenDetail={() => setDetailMeal(mealName)}
            onItemDuplicate={(item) => {
              const { id, ...rest } = item;
              addEntry(rest);
            }}
            onItemEdit={(item) => {
              setEditItemId(item.id);
              setDetailMeal(mealName);
            }}
            onItemDelete={(item) => removeEntry(item.id)}
          />
        ))}

        {detailMeal && (
          <MealDetailSheet
            meal={detailMeal}
            items={mealGroups[detailMeal] ?? []}
            onClose={() => { setDetailMeal(null); setEditItemId(null); }}
            onAdd={() => {
              setDetailMeal(null);
              setEditItemId(null);
              router.push({ pathname: '/log-food', params: { meal: detailMeal } });
            }}
            initialEditId={editItemId}
          />
        )}

        {showOverview && (
          <MacroOverviewSheet
            onClose={() => setShowOverview(false)}
            totals={totals}
            goals={goals}
            burnedEstimate={burnedEstimate}
          />
        )}

      </ScrollView>

    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function MacroRing({ kcal, goal }: { kcal: number; goal: number }) {
  const size = 92;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(1, kcal / goal);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke}
        />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={ACCENT} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - pct)}
        />
      </Svg>
      <View style={styles.ringCenter}>
        <Text style={styles.ringValue}>{Math.round(kcal)}</Text>
        <Text style={styles.ringUnit}>kcal</Text>
      </View>
    </View>
  );
}

function StatBox({
  label, value, unit, color = '#fff', highlight = false, estimated = false,
}: {
  label: string; value: number; unit: string; color?: string; highlight?: boolean; estimated?: boolean;
}) {
  return (
    <View style={[styles.statBox, highlight && styles.statBoxHighlight]}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.statValueRow}>
        {estimated && <Text style={[styles.statUnit, { color }]}>~</Text>}
        <Text style={[styles.statValue, { color }]}>{value}</Text>
        <Text style={styles.statUnit}> {unit}</Text>
      </View>
    </View>
  );
}

function MacroBar({ label, value, goal, color }: { label: string; value: number; goal: number; color: string }) {
  const pct = Math.min(1, value / goal);
  return (
    <View style={styles.barContainer}>
      <View style={styles.barLabelRow}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barGoal}>
          <Text style={styles.barCurrent}>{Math.round(value)}</Text>
          <Text style={styles.barGoalText}>/{goal}g</Text>
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct * 100}%` as `${number}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function MealCard({
  name, items, onAdd, onOpenDetail, onItemDuplicate, onItemEdit, onItemDelete,
}: {
  name: string;
  items: FoodEntry[];
  onAdd: () => void;
  onOpenDetail: () => void;
  onItemDuplicate: (item: FoodEntry) => void;
  onItemEdit: (item: FoodEntry) => void;
  onItemDelete: (item: FoodEntry) => void;
}) {
  const kcalSum = items.reduce((acc, e) => acc + e.calories, 0);
  const empty = items.length === 0;

  return (
    <View style={styles.mealCard}>
      <View style={styles.mealHeader}>
        <TouchableOpacity
          style={{ flex: 1 }}
          onPress={empty ? undefined : onOpenDetail}
          activeOpacity={empty ? 1 : 0.65}
        >
          <View style={styles.mealNameRow}>
            <Text style={styles.mealName}>{name}</Text>
            {!empty && (
              <View style={styles.mealBadge}>
                <Text style={styles.mealBadgeText}>{items.length}</Text>
              </View>
            )}
          </View>
          <Text style={styles.mealSub}>
            {empty ? 'Noch nichts getrackt' : `${Math.round(kcalSum)} kcal`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onAdd}
          style={[styles.mealAddBtn, empty && styles.mealAddBtnAccent]}
          hitSlop={8}
        >
          <Text style={[styles.mealAddIcon, empty && { color: '#000' }]}>+</Text>
        </TouchableOpacity>
      </View>

      {!empty && (
        <View style={styles.mealItemsList}>
          {items.map((item, i) => (
            <SwipeableMealItem
              key={item.id}
              item={item}
              showDivider={i < items.length - 1}
              onDuplicate={() => onItemDuplicate(item)}
              onEdit={() => onItemEdit(item)}
              onDelete={() => onItemDelete(item)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function SwipeableMealItem({
  item, showDivider, onDuplicate, onEdit, onDelete,
}: {
  item: FoodEntry;
  showDivider: boolean;
  onDuplicate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const swRef = useRef<Swipeable>(null);

  const renderRightActions = useCallback(() => (
    <View style={sw.actions}>
      <TouchableOpacity
        style={[sw.action, sw.dupAction]}
        onPress={() => { swRef.current?.close(); onDuplicate(); }}
        activeOpacity={0.8}
      >
        <Text style={sw.actionIcon}>⎘</Text>
        <Text style={sw.actionLabel}>Kopieren</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[sw.action, sw.editAction]}
        onPress={() => { swRef.current?.close(); onEdit(); }}
        activeOpacity={0.8}
      >
        <Text style={sw.actionIcon}>✏</Text>
        <Text style={sw.actionLabel}>Bearbeiten</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[sw.action, sw.deleteAction]}
        onPress={() => { swRef.current?.close(); onDelete(); }}
        activeOpacity={0.8}
      >
        <Text style={sw.actionIcon}>✕</Text>
        <Text style={sw.actionLabel}>Löschen</Text>
      </TouchableOpacity>
    </View>
  ), [onDuplicate, onEdit, onDelete]);

  return (
    <View>
      <Swipeable
        ref={swRef}
        renderRightActions={renderRightActions}
        overshootRight={false}
      >
        <View style={styles.mealItemRow}>
          <FoodGlyph name={item.name} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.itemSub}>
              {item.grams}{item.unit ?? 'g'}{item.brand ? ` · ${item.brand}` : ''}
            </Text>
          </View>
          <Text style={styles.itemKcal}>
            {item.calories}<Text style={styles.itemKcalUnit}> kcal</Text>
          </Text>
        </View>
      </Swipeable>
      {showDivider && <View style={styles.mealItemDivider} />}
    </View>
  );
}

function MealDetailSheet({
  meal, items, onClose, onAdd, initialEditId,
}: {
  meal: string; items: FoodEntry[]; onClose: () => void; onAdd: () => void;
  initialEditId?: string | null;
}) {
  const { removeEntry, updateEntry } = useFoodLog();
  const [editId, setEditId] = useState<string | null>(initialEditId ?? null);
  const [editGrams, setEditGrams] = useState(() => {
    if (initialEditId) {
      const found = items.find(i => i.id === initialEditId);
      return found ? String(found.grams) : '';
    }
    return '';
  });

  const kcalSum = items.reduce((s, e) => s + e.calories, 0);
  const proteinSum = items.reduce((s, e) => s + e.protein, 0);

  const startEdit = (item: FoodEntry) => {
    setEditId(item.id);
    setEditGrams(String(item.grams));
  };

  const cancelEdit = () => { setEditId(null); setEditGrams(''); };

  const saveEdit = async (item: FoodEntry) => {
    const g = parseFloat(editGrams);
    if (g > 0 && g !== item.grams) {
      const f = g / item.grams;
      await updateEntry(item.id, {
        grams: g,
        calories: Math.round(item.calories * f),
        protein: Math.round(item.protein * f * 10) / 10,
        carbs: Math.round(item.carbs * f * 10) / 10,
        fat: Math.round(item.fat * f * 10) / 10,
      });
    }
    cancelEdit();
  };

  const confirmDelete = (item: FoodEntry) => {
    Alert.alert(item.name, 'Eintrag entfernen?', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Entfernen', style: 'destructive', onPress: () => removeEntry(item.id) },
    ]);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={sheet.root}>
        <TouchableOpacity style={sheet.backdrop} onPress={onClose} activeOpacity={1} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={sheet.sheet}
        >
          <View style={sheet.handle} />

          <View style={sheet.header}>
            <View>
              <Text style={sheet.mealName}>{meal}</Text>
              <Text style={sheet.kcalLine}>
                {Math.round(kcalSum)} kcal · {proteinSum.toFixed(1)}g Protein
              </Text>
            </View>
            <TouchableOpacity style={sheet.addBtn} onPress={onAdd} activeOpacity={0.8}>
              <Text style={sheet.addBtnText}>+ Hinzufügen</Text>
            </TouchableOpacity>
          </View>

          <View style={sheet.divider} />

          <ScrollView
            style={sheet.list}
            contentContainerStyle={sheet.listContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {items.length === 0 ? (
              <Text style={sheet.emptyText}>Noch keine Einträge</Text>
            ) : (
              items.map((item, i) => (
                <View key={item.id}>
                  {editId === item.id ? (
                    <View style={sheet.itemRow}>
                      <FoodGlyph name={item.name} />
                      <View style={{ flex: 1 }}>
                        <Text style={sheet.itemName} numberOfLines={1}>{item.name}</Text>
                        <View style={sheet.editGramsRow}>
                          <TextInput
                            style={sheet.gramsInput}
                            value={editGrams}
                            onChangeText={setEditGrams}
                            keyboardType="numeric"
                            selectTextOnFocus
                            autoFocus
                            returnKeyType="done"
                            onSubmitEditing={() => saveEdit(item)}
                          />
                          <Text style={sheet.gramsUnit}>g</Text>
                        </View>
                      </View>
                      <TouchableOpacity style={sheet.editSaveBtn} onPress={() => saveEdit(item)} hitSlop={8}>
                        <Text style={sheet.editSaveBtnText}>✓</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={sheet.editCancelBtn} onPress={cancelEdit} hitSlop={8}>
                        <Text style={sheet.editCancelBtnText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={sheet.itemRow} onPress={() => startEdit(item)} activeOpacity={0.7}>
                      <FoodGlyph name={item.name} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={sheet.itemName} numberOfLines={1}>{item.name}</Text>
                        <Text style={sheet.itemSub}>
                          {item.grams}{item.unit ?? 'g'}{item.brand ? ` · ${item.brand}` : ''}
                        </Text>
                      </View>
                      <Text style={sheet.itemKcal}>
                        {item.calories}<Text style={sheet.itemKcalUnit}> kcal</Text>
                      </Text>
                      <TouchableOpacity style={sheet.deleteBtn} onPress={() => confirmDelete(item)} hitSlop={8}>
                        <Text style={sheet.deleteBtnText}>✕</Text>
                      </TouchableOpacity>
                    </TouchableOpacity>
                  )}
                  {i < items.length - 1 && <View style={sheet.itemDivider} />}
                </View>
              ))
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function MacroOverviewSheet({
  onClose, totals, goals, burnedEstimate,
}: {
  onClose: () => void;
  totals: MacroTotals;
  goals: Goals;
  burnedEstimate: number;
}) {
  const remaining = Math.max(0, goals.calories - totals.calories);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={ov.root}>
        <TouchableOpacity style={ov.backdrop} onPress={onClose} activeOpacity={1} />
        <View style={ov.sheet}>
          <View style={ov.handle} />

          <View style={ov.header}>
            <Text style={ov.title}>Übersicht</Text>
            <TouchableOpacity onPress={onClose} style={ov.closeBtn} hitSlop={8}>
              <Text style={ov.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={ov.scroll} showsVerticalScrollIndicator={false}>
            {/* Kalorien card */}
            <View style={ov.kcalCard}>
              <MacroRing kcal={totals.calories} goal={goals.calories} />
              <View style={ov.kcalRight}>
                <Text style={ov.kcalOverlabel}>NOCH ÜBRIG</Text>
                <Text style={ov.kcalBig}>{remaining}</Text>
                <Text style={ov.kcalMeta}>
                  {`${Math.round(totals.calories)} von ${goals.calories} kcal`}
                  {burnedEstimate > 0 && (
                    <Text>
                      {' · '}
                      <Text style={{ color: ACCENT }}>+{burnedEstimate} verbrannt</Text>
                    </Text>
                  )}
                </Text>
              </View>
            </View>

            <Text style={ov.sectionLabel}>MAKROS — NOCH ZU DECKEN</Text>

            <MacroDetailCard label="Protein"       value={totals.protein} goal={goals.protein} color="#4f8bff" />
            <MacroDetailCard label="Kohlenhydrate" value={totals.carbs}   goal={goals.carbs}   color="#ffb547" />
            <MacroDetailCard label="Fett"          value={totals.fat}     goal={goals.fat}     color="#ff5e5e" />

            <Text style={ov.sectionLabel}>WEITERE NÄHRWERTE</Text>

            <NutrientRow label="Zucker"                value={totals.sugar} />
            <View style={ov.rowDivider} />
            <NutrientRow label="Fett"                  value={totals.fat} />
            <View style={ov.rowDivider} />
            <NutrientRow label="Ballaststoffe"         value={totals.fiber} />
            <View style={ov.rowDivider} />
            <NutrientRow label="Natrium"               value={totals.sodium} />
            <View style={ov.rowDivider} />
            <NutrientRow label="Gesättigte Fettsäuren" value={totals.saturatedFat} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function MacroDetailCard({
  label, value, goal, color,
}: {
  label: string; value: number; goal: number; color: string;
}) {
  const eaten = Math.round(value * 10) / 10;
  const remaining = Math.max(0, goal - eaten);
  const pct = goal > 0 ? Math.min(1, value / goal) : 0;
  const pctDisplay = Math.round(pct * 100);

  return (
    <View style={ov.macroCard}>
      <View style={ov.macroCardTop}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={[ov.macroDot, { backgroundColor: color }]} />
          <Text style={ov.macroCardLabel}>{label}</Text>
        </View>
        <Text style={[ov.macroRemaining, { color }]}>noch {Math.round(remaining)}g</Text>
      </View>
      <View style={ov.macroTrack}>
        <View style={[ov.macroFill, { width: `${pct * 100}%` as `${number}%`, backgroundColor: color }]} />
      </View>
      <View style={ov.macroCardBottom}>
        <Text style={ov.macroEaten}>{eaten}g gegessen</Text>
        <Text style={ov.macroGoalText}>Ziel {goal}g · {pctDisplay}%</Text>
      </View>
    </View>
  );
}

function NutrientRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={ov.nutrientRow}>
      <Text style={ov.nutrientLabel}>{label}</Text>
      <Text style={ov.nutrientValue}>{(Math.round(value * 10) / 10).toFixed(1)}g</Text>
    </View>
  );
}

function FoodGlyph({ name }: { name: string }) {
  return (
    <View style={styles.glyph}>
      <Text style={styles.glyphText}>{name[0].toUpperCase()}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scroll: {
    padding: 16,
    paddingBottom: 120,
    gap: 12,
  },

  // Brand
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  brandEmoji: {
    fontSize: 22,
  },
  brandName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.3,
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  dateLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  headline: {
    fontSize: 32,
    fontWeight: '800',
    color: ACCENT,
    letterSpacing: -1,
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#111111',
    borderRadius: 99,
    borderWidth: 0.5,
    borderColor: '#222222',
  },
  streakDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: '#26de81',
  },
  streakText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '600',
  },
  streakBadgeEmpty: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#111111',
    borderRadius: 99,
    borderWidth: 0.5,
    borderColor: '#222222',
  },
  streakTextEmpty: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
    fontWeight: '500',
  },

  // Card
  card: {
    backgroundColor: '#111111',
    borderRadius: 20,
    padding: 16,
    borderWidth: 0.5,
    borderColor: '#222222',
  },
  cardDivider: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 14,
  },

  // Stat boxes
  statRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statBox: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  statBoxHighlight: {
    backgroundColor: `${ACCENT}18`,
    borderColor: `${ACCENT}40`,
  },
  statLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontWeight: '600',
    marginBottom: 4,
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.3,
  },
  statUnit: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.4)',
  },

  // Ring
  ringRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  barsCol: {
    flex: 1,
    gap: 11,
  },
  ringCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.5,
    lineHeight: 24,
  },
  ringUnit: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  // Macro bars
  barContainer: {
    gap: 5,
  },
  barLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  barLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: -0.1,
  },
  barGoal: {
    fontSize: 12,
  },
  barCurrent: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
  },
  barGoalText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
  },
  barTrack: {
    height: 4,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 99,
  },

  // Suggestion banner
  suggBanner: {
    backgroundColor: `${ACCENT}18`,
    borderWidth: 0.5,
    borderColor: `${ACCENT}40`,
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  suggIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  suggEmoji: {
    fontSize: 18,
  },
  suggTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 2,
  },
  suggSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  suggChevron: {
    fontSize: 24,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '300',
  },

  // Section label
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)',
    paddingHorizontal: 4,
    marginTop: 4,
  },

  // Meal card
  mealCard: {
    backgroundColor: '#111111',
    borderRadius: 18,
    borderWidth: 0.5,
    borderColor: '#222222',
    overflow: 'hidden',
  },
  mealHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
  mealNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mealName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.1,
  },
  mealBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: ACCENT,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#000',
    letterSpacing: -0.2,
  },
  mealSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },
  mealAddBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealAddBtnAccent: {
    backgroundColor: ACCENT,
  },
  mealAddIcon: {
    fontSize: 22,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 26,
    fontWeight: '300',
  },
  mealItemsList: {
    paddingBottom: 6,
  },
  mealItemDivider: {
    height: 0.5,
    backgroundColor: '#1a1a1a',
    marginHorizontal: 16,
  },
  mealItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 16,
    backgroundColor: '#111111',
  },
  itemName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#fff',
    letterSpacing: -0.1,
  },
  itemSub: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },
  itemKcal: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  itemKcalUnit: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
    fontWeight: '400',
  },

  // Food glyph
  glyph: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: `${ACCENT}18`,
    borderWidth: 0.5,
    borderColor: `${ACCENT}30`,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  glyphText: {
    fontSize: 14,
    fontWeight: '700',
    color: ACCENT,
    letterSpacing: -0.3,
  },
});

// ─── Sheet styles ─────────────────────────────────────────────

const sheet = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: '#111111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '82%',
    paddingBottom: 34,
    borderWidth: 0.5,
    borderColor: '#222222',
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  mealName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.5,
  },
  kcalLine: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 3,
  },
  addBtn: {
    backgroundColor: ACCENT,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000',
  },
  divider: {
    height: 0.5,
    backgroundColor: '#222222',
  },
  list: {
    flexShrink: 1,
  },
  listContent: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  emptyText: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.3)',
    fontSize: 14,
    paddingVertical: 24,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#fff',
    letterSpacing: -0.1,
  },
  itemSub: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },
  itemKcal: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
    flexShrink: 0,
  },
  itemKcalUnit: {
    fontSize: 11,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.35)',
  },
  deleteBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,94,94,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  deleteBtnText: {
    fontSize: 12,
    color: '#ff5e5e',
    fontWeight: '700',
  },
  itemDivider: {
    height: 0.5,
    backgroundColor: '#1a1a1a',
  },
  editGramsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
  },
  gramsInput: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    minWidth: 64,
    textAlign: 'center',
  },
  gramsUnit: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
  },
  editSaveBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: `${ACCENT}22`,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  editSaveBtnText: {
    fontSize: 14,
    color: ACCENT,
    fontWeight: '700',
  },
  editCancelBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  editCancelBtnText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '600',
  },
});

// ─── Overview sheet styles ────────────────────────────────────

const ov = StyleSheet.create({
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
    maxHeight: '92%',
    paddingBottom: 34,
    borderWidth: 0.5,
    borderColor: '#222222',
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.4,
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
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '700',
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 20,
    gap: 12,
  },

  // Kalorien card
  kcalCard: {
    backgroundColor: '#181818',
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: '#222222',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  kcalRight: {
    flex: 1,
    gap: 3,
  },
  kcalOverlabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  kcalBig: {
    fontSize: 38,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -1.5,
    lineHeight: 42,
  },
  kcalMeta: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 17,
  },

  // Section labels
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: 2,
    marginTop: 4,
  },

  // Macro detail cards
  macroCard: {
    backgroundColor: '#181818',
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: '#222222',
    padding: 14,
    gap: 10,
  },
  macroCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  macroDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  macroCardLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.1,
  },
  macroRemaining: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  macroTrack: {
    height: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  macroFill: {
    height: '100%',
    borderRadius: 99,
  },
  macroCardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  macroEaten: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  macroGoalText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },

  // Nutrient rows (simple list, no card)
  nutrientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 2,
  },
  nutrientLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    flex: 1,
  },
  nutrientValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  rowDivider: {
    height: 0.5,
    backgroundColor: '#1e1e1e',
    marginHorizontal: 2,
  },
});

// ─── Swipeable styles ─────────────────────────────────────────

const sw = StyleSheet.create({
  actions: {
    flexDirection: 'row',
  },
  action: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  dupAction: {
    backgroundColor: '#2a2a2a',
  },
  editAction: {
    backgroundColor: '#1a3a5c',
  },
  deleteAction: {
    backgroundColor: '#5c1a1a',
  },
  actionIcon: {
    fontSize: 16,
    color: '#fff',
  },
  actionLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.3,
  },
});
