import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Notifications from 'expo-notifications';
import { Audio } from 'expo-av';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import InventoryDeductModal from '@/components/ui/InventoryDeductModal';
import { useFoodLog } from '@/context/food-log-context';
import { useInventory } from '@/context/inventory-context';
import {
  applyInventoryDeductions,
  findRecipeInventoryMatches,
  type InventoryMatch,
} from '@/lib/inventoryMatching';
import { isBasicIngredient } from '@/lib/recipe-match';
import type { RecipeSuggestion } from '@/services/anthropic';

// ─── Constants ────────────────────────────────────────────────
const ACCENT = '#c8ff00';
const GREEN = '#26de81';
const { width: SW, height: SH } = Dimensions.get('window');

type Phase = 'ready' | 'cooking' | 'done';
type Meal = 'Frühstück' | 'Mittagessen' | 'Snacks' | 'Abendessen';
const MEALS: Meal[] = ['Frühstück', 'Mittagessen', 'Snacks', 'Abendessen'];

function getDefaultMeal(): Meal {
  const h = new Date().getHours();
  if (h < 10) return 'Frühstück';
  if (h < 14) return 'Mittagessen';
  if (h < 18) return 'Snacks';
  return 'Abendessen';
}

function extractTimerSeconds(step: string): number | null {
  const m = step.match(/(\d+)\s*(?:Minuten?|Min\.)/i);
  if (m) return parseInt(m[1], 10) * 60;
  const s = step.match(/(\d+)\s*(?:Sekunden?|Sek\.)/i);
  if (s) return parseInt(s[1], 10);
  return null;
}

function pad2(n: number) {
  return String(Math.floor(n)).padStart(2, '0');
}

// ─── Confetti ─────────────────────────────────────────────────
const CONFETTI_COLORS = [ACCENT, GREEN, '#4F8EF7', '#F7A94F', '#F74F4F', '#a78bfa', '#fff'];
const CONFETTI_COUNT = 28;

function useConfetti(active: boolean) {
  const particles = useRef(
    Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
      x: new Animated.Value(Math.random() * SW),
      y: new Animated.Value(-20 - Math.random() * 60),
      opacity: new Animated.Value(0),
      rotate: new Animated.Value(0),
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: 6 + Math.random() * 8,
    })),
  ).current;

  useEffect(() => {
    if (!active) return;
    const anims = particles.map((p, i) => {
      p.x.setValue(Math.random() * SW);
      p.y.setValue(-20 - Math.random() * 80);
      p.opacity.setValue(1);
      p.rotate.setValue(0);
      return Animated.parallel([
        Animated.timing(p.y, {
          toValue: SH * 0.85,
          duration: 1800 + Math.random() * 1200,
          delay: i * 60,
          useNativeDriver: true,
        }),
        Animated.timing(p.rotate, {
          toValue: (Math.random() > 0.5 ? 1 : -1) * 720,
          duration: 2200 + Math.random() * 800,
          delay: i * 60,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(i * 60 + 1400),
          Animated.timing(p.opacity, {
            toValue: 0,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      ]);
    });
    Animated.stagger(40, anims).start();
  }, [active]);

  return particles;
}

// ─── Main ─────────────────────────────────────────────────────
export default function CookModeScreen() {
  const { data } = useLocalSearchParams<{ data: string }>();
  const insets = useSafeAreaInsets();
  const { addEntry } = useFoodLog();
  const { items: inventoryItems, updateItem, removeItem } = useInventory();

  const recipe = useMemo<RecipeSuggestion>(() => JSON.parse(data ?? '{}'), [data]);

  const [phase, setPhase] = useState<Phase>('ready');
  const [stepIndex, setStepIndex] = useState(0);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [selectedMeal, setSelectedMeal] = useState<Meal>(getDefaultMeal());
  const [showDeductModal, setShowDeductModal] = useState(false);
  const [recipeMatches, setRecipeMatches] = useState<InventoryMatch[]>([]);

  // Timer state
  const [timerTotal, setTimerTotal] = useState<number | null>(null);
  const [timerLeft, setTimerLeft] = useState<number | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerCompletedRef = useRef(false);

  // Flash animation
  const flashOpacity = useRef(new Animated.Value(0)).current;

  // Keep awake
  useEffect(() => {
    if (phase !== 'cooking') return;
    activateKeepAwakeAsync();
    return () => { deactivateKeepAwake(); };
  }, [phase]);

  // Timer tick
  useEffect(() => {
    if (timerRunning && timerLeft !== null && timerLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimerLeft(prev => {
          if (prev === null || prev <= 1) {
            setTimerRunning(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerRunning, timerLeft]);

  // Step change → check for timer
  useEffect(() => {
    if (phase !== 'cooking') return;
    const secs = recipe.steps?.[stepIndex]
      ? extractTimerSeconds(recipe.steps[stepIndex])
      : null;
    setTimerTotal(secs);
    setTimerLeft(secs);
    setTimerRunning(false);
    timerCompletedRef.current = false;
  }, [stepIndex, phase]);

  // Timer reached 0 → fire completion effects
  useEffect(() => {
    if (timerLeft === 0 && timerTotal !== null && timerTotal > 0 && !timerCompletedRef.current) {
      timerCompletedRef.current = true;
      handleTimerComplete();
    }
  }, [timerLeft, timerTotal]);

  async function handleTimerComplete() {
    // 1. Haptic feedback (3 pulses)
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning), 500);
    setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning), 1000);

    // 2. Screen flash (3x blink)
    Animated.sequence([
      Animated.timing(flashOpacity, { toValue: 1, duration: 100, useNativeDriver: true }),
      Animated.timing(flashOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(flashOpacity, { toValue: 1, duration: 100, useNativeDriver: true }),
      Animated.timing(flashOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(flashOpacity, { toValue: 1, duration: 100, useNativeDriver: true }),
      Animated.timing(flashOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();

    // 3. Sound
    try {
      const { sound } = await Audio.Sound.createAsync(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../assets/timer-done.mp3'),
      );
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate(status => {
        if (status.isLoaded && status.didJustFinish) sound.unloadAsync();
      });
    } catch {
      // sound file not found – skip silently
    }

    // 4. Push notification (works with screen off / app in background)
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Timer abgelaufen ⏱',
        body: `${recipe.name} – Schritt ${stepIndex + 1} ist fertig!`,
        sound: true,
      },
      trigger: null,
    });
  }

  // Swipe gesture
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderRelease: (_, g) => {
          if (g.dx < -50) goNext();
          else if (g.dx > 50) goPrev();
        },
      }),
    [stepIndex, recipe.steps],
  );

  const isPresent = (ing: string) => {
    const lower = ing.toLowerCase().trim();
    if (isBasicIngredient(lower)) return true;
    return recipe.usedInventoryItems?.some(i => lower.includes(i.toLowerCase()));
  };

  const missingCount = recipe.ingredients?.filter(i => !isPresent(i)).length ?? 0;
  const allPresent = missingCount === 0;
  const totalSteps = recipe.steps?.length ?? 0;

  function goNext() {
    if (stepIndex < totalSteps - 1) setStepIndex(i => i + 1);
  }
  function goPrev() {
    if (stepIndex > 0) setStepIndex(i => i - 1);
  }

  function handleFinish() {
    const matches = findRecipeInventoryMatches(recipe, inventoryItems);
    setRecipeMatches(matches);
    setPhase('done');
  }

  async function handleAddToLog() {
    await addEntry({
      meal: selectedMeal,
      name: recipe.name,
      brand: '',
      grams: 1,
      calories: recipe.calories,
      protein: recipe.protein,
      carbs: recipe.carbs,
      fat: recipe.fat,
      fiber: recipe.fiber,
      sugar: recipe.sugar,
    });
    if (recipeMatches.length > 0) {
      setShowDeductModal(true);
    } else {
      router.dismissAll();
    }
  }

  function handleSkip() {
    router.dismissAll();
  }

  async function handleDeductConfirm(selected: InventoryMatch[]) {
    await applyInventoryDeductions(selected, updateItem, removeItem);
    setShowDeductModal(false);
    router.dismissAll();
  }

  if (!data) return null;

  return (
    <View style={styles.root}>
      {phase === 'ready' && (
        <ReadyScreen
          recipe={recipe}
          allPresent={allPresent}
          missingCount={missingCount}
          insets={insets}
          isPresent={isPresent}
          onStart={() => setPhase('cooking')}
          onClose={() => router.back()}
        />
      )}

      {phase === 'cooking' && (
        <CookingScreen
          recipe={recipe}
          stepIndex={stepIndex}
          totalSteps={totalSteps}
          timerTotal={timerTotal}
          timerLeft={timerLeft}
          timerRunning={timerRunning}
          sidePanelOpen={sidePanelOpen}
          insets={insets}
          isPresent={isPresent}
          panHandlers={panResponder.panHandlers}
          onTimerToggle={() => {
            if (timerLeft === 0) {
              setTimerLeft(timerTotal);
              setTimerRunning(true);
            } else {
              setTimerRunning(r => !r);
            }
          }}
          onPrev={goPrev}
          onNext={goNext}
          onFinish={handleFinish}
          onTogglePanel={() => setSidePanelOpen(o => !o)}
          onClose={() => router.back()}
        />
      )}

      {phase === 'done' && (
        <DoneScreen
          recipe={recipe}
          selectedMeal={selectedMeal}
          insets={insets}
          onSelectMeal={setSelectedMeal}
          onAdd={handleAddToLog}
          onSkip={handleSkip}
        />
      )}

      <InventoryDeductModal
        visible={showDeductModal}
        matches={recipeMatches}
        meal={recipe.name}
        onDeduct={handleDeductConfirm}
        onSkip={() => {
          setShowDeductModal(false);
          router.dismissAll();
        }}
      />

      {/* Timer-complete flash overlay */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.3)', opacity: flashOpacity, zIndex: 50 }]}
        pointerEvents="none"
      />
    </View>
  );
}

// ─── Ready Screen ─────────────────────────────────────────────

function ReadyScreen({
  recipe, allPresent, missingCount, insets, isPresent, onStart, onClose,
}: {
  recipe: RecipeSuggestion;
  allPresent: boolean;
  missingCount: number;
  insets: ReturnType<typeof import('react-native-safe-area-context').useSafeAreaInsets>;
  isPresent: (i: string) => boolean | undefined;
  onStart: () => void;
  onClose: () => void;
}) {
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Top row */}
      <View style={styles.readyTopRow}>
        <Text style={styles.readyMeta}>⏱ {recipe.prepTime} Min. · {recipe.steps?.length ?? 0} Schritte</Text>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={12}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.readyScroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.readyLabel}>BEREIT ZUM KOCHEN?</Text>
        <Text style={styles.readyTitle}>{recipe.name}</Text>

        {/* Status badge */}
        {allPresent ? (
          <View style={styles.badgeGreen}>
            <Text style={styles.badgeGreenText}>✓ Alle Zutaten vorhanden</Text>
          </View>
        ) : (
          <View style={styles.badgeOrange}>
            <Text style={styles.badgeOrangeText}>⚠ {missingCount} Zutat{missingCount !== 1 ? 'en' : ''} fehlt</Text>
          </View>
        )}

        {/* Ingredients */}
        <View style={styles.readyIngredientsCard}>
          {recipe.ingredients?.map((ing, i) => {
            const present = isPresent(ing);
            return (
              <View
                key={i}
                style={[styles.ingRow, i < recipe.ingredients.length - 1 && styles.ingRowDivider]}
              >
                <View style={[styles.ingCheck, present ? styles.ingCheckGreen : styles.ingCheckGray]}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: present ? GREEN : '#555' }}>
                    {present ? '✓' : '○'}
                  </Text>
                </View>
                <Text style={[styles.ingText, !present && styles.ingTextMissing]}>{ing}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* CTA */}
      <View style={[styles.readyFooter, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <TouchableOpacity style={styles.ctaBtn} onPress={onStart} activeOpacity={0.85}>
          <Text style={styles.ctaBtnText}>🍳  Los geht's</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Cooking Screen ───────────────────────────────────────────

function CookingScreen({
  recipe, stepIndex, totalSteps, timerTotal, timerLeft, timerRunning,
  sidePanelOpen, insets, isPresent, panHandlers,
  onTimerToggle, onPrev, onNext, onFinish, onTogglePanel, onClose,
}: {
  recipe: RecipeSuggestion;
  stepIndex: number;
  totalSteps: number;
  timerTotal: number | null;
  timerLeft: number | null;
  timerRunning: boolean;
  sidePanelOpen: boolean;
  insets: ReturnType<typeof import('react-native-safe-area-context').useSafeAreaInsets>;
  isPresent: (i: string) => boolean | undefined;
  panHandlers: object;
  onTimerToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onFinish: () => void;
  onTogglePanel: () => void;
  onClose: () => void;
}) {
  const progress = totalSteps > 0 ? (stepIndex + 1) / totalSteps : 0;
  const stepNum = String(stepIndex + 1).padStart(2, '0');
  const currentStep = recipe.steps?.[stepIndex] ?? '';
  const isLast = stepIndex === totalSteps - 1;

  return (
    <View style={styles.root}>
      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      {/* Header */}
      <View style={[styles.cookHeader, { paddingTop: insets.top + 8 }]}>
        <View>
          <Text style={styles.cookStepLabel}>Schritt {stepIndex + 1} von {totalSteps}</Text>
          <Text style={styles.cookRecipeName} numberOfLines={1}>{recipe.name}</Text>
        </View>
        <View style={styles.cookHeaderRight}>
          <TouchableOpacity style={styles.iconBtn} onPress={onTogglePanel} hitSlop={10}>
            <Text style={styles.iconBtnText}>☰</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={onClose} hitSlop={10}>
            <Text style={styles.iconBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.cookScrollContent}
        showsVerticalScrollIndicator={false}
        {...panHandlers}
      >
        {/* Timer – immer sichtbar direkt unter dem Header */}
        {timerTotal !== null && timerLeft !== null && (
          <View style={styles.timerSection}>
            <CircleTimer
              total={timerTotal}
              left={timerLeft}
              running={timerRunning}
            />
            <TouchableOpacity style={styles.timerBtn} onPress={onTimerToggle} activeOpacity={0.8}>
              <Text style={styles.timerBtnText}>
                {timerLeft === 0 ? '↺ Neu starten' : timerRunning ? '⏸ Pause' : '▶ Start'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Step content */}
        <View style={styles.cookContent}>
          <Text style={styles.cookStepNumber}>{stepNum}</Text>
          <Text style={styles.cookStepText}>{currentStep}</Text>
        </View>
      </ScrollView>

      {/* Bottom nav */}
      <View style={[styles.cookNav, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity
          style={[styles.cookNavBack, stepIndex === 0 && styles.cookNavBackDisabled]}
          onPress={onPrev}
          disabled={stepIndex === 0}
          activeOpacity={0.75}
        >
          <Text style={[styles.cookNavBackText, stepIndex === 0 && { opacity: 0.3 }]}>‹ Zurück</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.cookNavNext}
          onPress={isLast ? onFinish : onNext}
          activeOpacity={0.85}
        >
          <Text style={styles.cookNavNextText}>
            {isLast ? 'Fertig 🎉' : 'Weiter ›'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Side panel */}
      {sidePanelOpen && (
        <TouchableOpacity
          style={styles.panelBackdrop}
          activeOpacity={1}
          onPress={onTogglePanel}
        >
          <TouchableOpacity
            style={styles.sidePanel}
            activeOpacity={1}
            onPress={() => {}}
          >
            <View style={styles.sidePanelHeader}>
              <View>
                <Text style={styles.sidePanelTitle}>Zutaten</Text>
                <Text style={styles.sidePanelSub}>{recipe.name}</Text>
              </View>
              <TouchableOpacity onPress={onTogglePanel} hitSlop={12}>
                <Text style={styles.sidePanelClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {recipe.ingredients?.map((ing, i) => {
                const present = isPresent(ing);
                return (
                  <View
                    key={i}
                    style={[styles.ingRow, i < recipe.ingredients.length - 1 && styles.ingRowDivider]}
                  >
                    <View style={[styles.ingCheck, styles.ingCheckGreen]}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: GREEN }}>✓</Text>
                    </View>
                    <Text style={styles.ingText}>{ing}</Text>
                  </View>
                );
              })}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Circle Timer ─────────────────────────────────────────────

function CircleTimer({ total, left, running }: { total: number; left: number; running: boolean }) {
  const R = 52;
  const STROKE = 5;
  const SIZE = (R + STROKE) * 2;
  const circumference = 2 * Math.PI * R;
  const progress = total > 0 ? left / total : 0;
  const dash = circumference * progress;
  const mins = Math.floor(left / 60);
  const secs = left % 60;

  return (
    <View style={styles.timerCircleWrap}>
      <Svg width={SIZE} height={SIZE}>
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke="#222"
          strokeWidth={STROKE}
          fill="none"
        />
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke={left === 0 ? GREEN : ACCENT}
          strokeWidth={STROKE}
          fill="none"
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="round"
          rotation="-90"
          origin={`${SIZE / 2}, ${SIZE / 2}`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={[styles.timerTime, left === 0 && { color: GREEN }]}>
          {pad2(mins)}:{pad2(secs)}
        </Text>
        <Text style={styles.timerLabel}>{running ? 'läuft' : left === 0 ? 'fertig' : 'pausiert'}</Text>
      </View>
    </View>
  );
}

// ─── Done Screen ──────────────────────────────────────────────

function DoneScreen({
  recipe, selectedMeal, insets, onSelectMeal, onAdd, onSkip,
}: {
  recipe: RecipeSuggestion;
  selectedMeal: Meal;
  insets: ReturnType<typeof import('react-native-safe-area-context').useSafeAreaInsets>;
  onSelectMeal: (m: Meal) => void;
  onAdd: () => void;
  onSkip: () => void;
}) {
  const confetti = useConfetti(true);
  const checkScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(checkScale, { toValue: 1, useNativeDriver: true, bounciness: 14 }).start();
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Confetti */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {confetti.map((p, i) => (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              width: p.size,
              height: p.size,
              borderRadius: 2,
              backgroundColor: p.color,
              opacity: p.opacity,
              transform: [
                { translateX: p.x },
                { translateY: p.y },
                {
                  rotate: p.rotate.interpolate({
                    inputRange: [-720, 720],
                    outputRange: ['-720deg', '720deg'],
                  }),
                },
              ],
            }}
          />
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.doneScroll, { paddingBottom: Math.max(insets.bottom, 24) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Check icon */}
        <View style={styles.doneCheckWrap}>
          <Animated.View style={[styles.doneCheckCircle, { transform: [{ scale: checkScale }] }]}>
            <Text style={styles.doneCheckIcon}>✓</Text>
          </Animated.View>
        </View>

        <Text style={styles.doneTitle}>Guten Appetit!</Text>
        <Text style={styles.doneSub}>{recipe.name}</Text>

        {/* Nutrition card */}
        <View style={styles.doneNutrCard}>
          <Text style={styles.doneNutrLabel}>NÄHRWERTE DIESER MAHLZEIT</Text>
          <View style={styles.doneNutrRow}>
            <NutrPill value={recipe.calories} label="kcal" color="#fff" />
            <NutrPill value={recipe.protein} label="Protein" color="#4F8EF7" unit="g" />
            <NutrPill value={recipe.carbs} label="Carbs" color="#F7A94F" unit="g" />
            <NutrPill value={recipe.fat} label="Fett" color="#F74F4F" unit="g" />
          </View>
        </View>

        {/* Meal chips */}
        <Text style={styles.doneMealLabel}>ZU WELCHER MAHLZEIT?</Text>
        <View style={styles.doneMealRow}>
          {MEALS.map(m => (
            <TouchableOpacity
              key={m}
              style={[styles.mealChip, m === selectedMeal && styles.mealChipActive]}
              onPress={() => onSelectMeal(m)}
            >
              <Text style={[styles.mealChipText, m === selectedMeal && styles.mealChipTextActive]}>
                {m}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* CTA */}
        <TouchableOpacity style={styles.ctaBtn} onPress={onAdd} activeOpacity={0.85}>
          <Text style={styles.ctaBtnText}>+ Zu {selectedMeal} hinzufügen</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onSkip} style={styles.skipLink}>
          <Text style={styles.skipLinkText}>Überspringen</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─── NutrPill ─────────────────────────────────────────────────

function NutrPill({ value, label, color, unit = '' }: { value: number; label: string; color: string; unit?: string }) {
  return (
    <View style={styles.nutrPill}>
      <Text style={[styles.nutrPillValue, { color }]}>{Math.round(value)}{unit}</Text>
      <Text style={styles.nutrPillLabel}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },

  // Shared close btn
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { fontSize: 14, color: 'rgba(255,255,255,0.6)', fontWeight: '700' },

  // Shared CTA
  ctaBtn: {
    backgroundColor: ACCENT,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 4,
  },
  ctaBtnText: { fontSize: 17, fontWeight: '800', color: '#000', letterSpacing: -0.3 },

  // ── Ready ──────────────────────────────────────────────────
  readyTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 8,
  },
  readyMeta: { fontSize: 13, color: 'rgba(255,255,255,0.4)', fontWeight: '600' },
  readyScroll: { padding: 20, gap: 16 },
  readyLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: ACCENT,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  readyTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.9,
    lineHeight: 38,
  },
  badgeGreen: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(38,222,129,0.14)',
    borderWidth: 0.5,
    borderColor: 'rgba(38,222,129,0.35)',
    borderRadius: 99,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  badgeGreenText: { fontSize: 13, fontWeight: '700', color: GREEN },
  badgeOrange: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(247,169,79,0.14)',
    borderWidth: 0.5,
    borderColor: 'rgba(247,169,79,0.35)',
    borderRadius: 99,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  badgeOrangeText: { fontSize: 13, fontWeight: '700', color: '#F7A94F' },
  readyIngredientsCard: {
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: '#222222',
    overflow: 'hidden',
  },
  ingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  ingRowDivider: { borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a' },
  ingCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  ingCheckGreen: {
    backgroundColor: 'rgba(38,222,129,0.1)',
    borderWidth: 0.5,
    borderColor: 'rgba(38,222,129,0.25)',
  },
  ingCheckGray: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 0.5,
    borderColor: '#333',
  },
  ingText: { flex: 1, fontSize: 14, color: 'rgba(255,255,255,0.8)', lineHeight: 20 },
  ingTextMissing: { color: 'rgba(255,255,255,0.35)' },
  readyFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: '#0a0a0a',
    borderTopWidth: 0.5,
    borderTopColor: '#1a1a1a',
  },

  // ── Cooking ────────────────────────────────────────────────
  progressTrack: {
    height: 3,
    backgroundColor: '#1a1a1a',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  progressFill: {
    height: '100%',
    backgroundColor: ACCENT,
    borderRadius: 99,
  },
  cookHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1a1a1a',
  },
  cookStepLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: ACCENT,
    letterSpacing: -0.2,
  },
  cookRecipeName: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
    fontWeight: '500',
    marginTop: 2,
    maxWidth: SW * 0.55,
  },
  cookHeaderRight: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: { fontSize: 16, color: 'rgba(255,255,255,0.6)' },
  cookScrollContent: {
    paddingBottom: 8,
  },
  cookContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 10,
  },
  cookStepNumber: {
    fontSize: 72,
    fontWeight: '800',
    color: ACCENT,
    letterSpacing: -4,
    lineHeight: 76,
    opacity: 0.85,
  },
  cookStepText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    lineHeight: 28,
    letterSpacing: -0.4,
  },
  timerSection: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    gap: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#1a1a1a',
  },
  timerCircleWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerTime: {
    fontSize: 22,
    fontWeight: '800',
    color: ACCENT,
    letterSpacing: -1,
  },
  timerLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  timerBtn: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
  },
  timerBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  cookNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: 0.5,
    borderTopColor: '#1a1a1a',
    backgroundColor: '#0a0a0a',
  },
  cookNavBack: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#181818',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    alignItems: 'center',
  },
  cookNavBackDisabled: { opacity: 0.5 },
  cookNavBackText: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.6)' },
  cookNavNext: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: ACCENT,
    alignItems: 'center',
  },
  cookNavNextText: { fontSize: 15, fontWeight: '800', color: '#000', letterSpacing: -0.2 },

  // Side panel
  panelBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  sidePanel: {
    width: SW * 0.78,
    backgroundColor: '#111111',
    borderLeftWidth: 0.5,
    borderLeftColor: '#222222',
    padding: 24,
    paddingTop: 52,
  },
  sidePanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  sidePanelTitle: { fontSize: 18, fontWeight: '800', color: '#fff', letterSpacing: -0.4 },
  sidePanelSub: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 },
  sidePanelClose: { fontSize: 18, color: 'rgba(255,255,255,0.5)', fontWeight: '700' },

  // ── Done ───────────────────────────────────────────────────
  doneScroll: {
    padding: 24,
    gap: 18,
    alignItems: 'stretch',
  },
  doneCheckWrap: { alignItems: 'center', marginTop: 20, marginBottom: 4 },
  doneCheckCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(38,222,129,0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(38,222,129,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneCheckIcon: { fontSize: 40, color: GREEN },
  doneTitle: {
    fontSize: 36,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -1,
    textAlign: 'center',
  },
  doneSub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    fontWeight: '500',
    marginTop: -6,
  },
  doneNutrCard: {
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: '#222222',
    padding: 18,
    gap: 14,
  },
  doneNutrLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  doneNutrRow: { flexDirection: 'row', justifyContent: 'space-between' },
  nutrPill: { flex: 1, alignItems: 'center', gap: 4 },
  nutrPillValue: { fontSize: 18, fontWeight: '800', letterSpacing: -0.4 },
  nutrPillLabel: { fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: '600' },
  doneMealLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  doneMealRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mealChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 99,
    backgroundColor: '#181818',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
  },
  mealChipActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  mealChipText: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },
  mealChipTextActive: { color: '#000' },
  skipLink: { alignItems: 'center', paddingVertical: 4 },
  skipLinkText: { fontSize: 14, color: 'rgba(255,255,255,0.3)', fontWeight: '500' },
});
