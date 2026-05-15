import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useFoodLog } from '@/context/food-log-context';
import { fetchProductByBarcode } from '@/services/open-food-facts';
import { getApiKey, getRecipeSuggestion, saveApiKey } from '@/services/anthropic';

export default function CookScreen() {
  const { totals, goals } = useFoodLog();
  const remaining = {
    calories: Math.max(0, goals.calories - totals.calories),
    protein: Math.max(0, goals.protein - totals.protein),
    carbs: Math.max(0, goals.carbs - totals.carbs),
    fat: Math.max(0, goals.fat - totals.fat),
  };

  const [apiKey, setApiKey] = useState('');
  const [apiKeyStored, setApiKeyStored] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');

  const [ingredients, setIngredients] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const [loading, setLoading] = useState(false);
  const [recipe, setRecipe] = useState<string | null>(null);

  const scannedRef = useRef(false);

  useEffect(() => {
    getApiKey().then(key => {
      setApiKeyStored(key);
    });
  }, []);

  const handleSaveApiKey = useCallback(async () => {
    if (!apiKeyInput.trim()) return;
    await saveApiKey(apiKeyInput.trim());
    setApiKeyStored(apiKeyInput.trim());
    setApiKeyInput('');
  }, [apiKeyInput]);

  const addIngredient = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setIngredients(prev => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setInputValue('');
  }, []);

  const removeIngredient = useCallback((item: string) => {
    setIngredients(prev => prev.filter(i => i !== item));
  }, []);

  const handleBarcode = useCallback(async ({ data }: { data: string }) => {
    if (scannedRef.current || scanLoading) return;
    scannedRef.current = true;
    setScanLoading(true);
    const product = await fetchProductByBarcode(data);
    setScanLoading(false);
    if (product) {
      const label = product.brand ? `${product.name} (${product.brand})` : product.name;
      setIngredients(prev => (prev.includes(label) ? prev : [...prev, label]));
      setScanning(false);
    } else {
      Alert.alert('Nicht gefunden', 'Produkt nicht in der Datenbank.', [
        { text: 'OK', onPress: () => { scannedRef.current = false; } },
      ]);
    }
  }, [scanLoading]);

  const openScanner = useCallback(async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }
    scannedRef.current = false;
    setScanning(true);
  }, [permission, requestPermission]);

  const handleGetRecipe = useCallback(async () => {
    const key = apiKeyStored;
    if (!key) {
      Alert.alert('API Key fehlt', 'Bitte zuerst den Anthropic API Key eingeben.');
      return;
    }
    if (ingredients.length === 0) {
      Alert.alert('Keine Zutaten', 'Bitte mindestens eine Zutat eintragen.');
      return;
    }
    setLoading(true);
    setRecipe(null);
    try {
      const result = await getRecipeSuggestion(ingredients, remaining, key);
      setRecipe(result);
    } catch (e: any) {
      Alert.alert('Fehler', e.message ?? 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  }, [apiKeyStored, ingredients, remaining]);

  // ── Scanner overlay ───────────────────────────────────────────────────────
  if (scanning) {
    return (
      <View style={styles.container}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'] }}
          onBarcodeScanned={handleBarcode}
        />
        <View style={styles.scanOverlay}>
          <View style={styles.scanFrame} />
          <Text style={styles.scanHint}>Barcode in den Rahmen halten</Text>
          <TouchableOpacity style={styles.scanCancelBtn} onPress={() => setScanning(false)}>
            <Text style={styles.scanCancelText}>Abbrechen</Text>
          </TouchableOpacity>
        </View>
        {scanLoading && (
          <View style={styles.scanLoadingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.scanLoadingText}>Produkt wird gesucht…</Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancelBtn}>Abbrechen</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Was kann ich kochen?</Text>
        <View style={{ width: 80 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* API Key Setup */}
        {!apiKeyStored && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Anthropic API Key</Text>
            <Text style={styles.cardSubtitle}>Einmalig eingeben – wird sicher gespeichert.</Text>
            <View style={styles.apiKeyRow}>
              <TextInput
                style={styles.apiKeyInput}
                placeholder="sk-ant-..."
                placeholderTextColor="#bbb"
                value={apiKeyInput}
                onChangeText={setApiKeyInput}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity style={styles.apiKeySaveBtn} onPress={handleSaveApiKey}>
                <Text style={styles.apiKeySaveText}>Speichern</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Remaining macros */}
        <View style={styles.macroBar}>
          <Text style={styles.macroBarLabel}>Noch übrig:</Text>
          <Text style={styles.macroBarValue}>{Math.round(remaining.calories)} kcal</Text>
          <Text style={styles.macroBarDot}>·</Text>
          <Text style={[styles.macroBarValue, { color: '#4F8EF7' }]}>{remaining.protein.toFixed(0)}g P</Text>
          <Text style={styles.macroBarDot}>·</Text>
          <Text style={[styles.macroBarValue, { color: '#F7A94F' }]}>{remaining.carbs.toFixed(0)}g K</Text>
          <Text style={styles.macroBarDot}>·</Text>
          <Text style={[styles.macroBarValue, { color: '#F74F4F' }]}>{remaining.fat.toFixed(0)}g F</Text>
        </View>

        {/* Ingredient input */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Kühlschrank-Inhalt</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.ingredientInput}
              placeholder="Zutat eingeben…"
              placeholderTextColor="#bbb"
              value={inputValue}
              onChangeText={setInputValue}
              onSubmitEditing={() => addIngredient(inputValue)}
              returnKeyType="done"
            />
            <TouchableOpacity style={styles.addBtn} onPress={() => addIngredient(inputValue)}>
              <Text style={styles.addBtnText}>+</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.scanBtn} onPress={openScanner}>
              <Text style={styles.scanBtnText}>📷</Text>
            </TouchableOpacity>
          </View>

          {ingredients.length > 0 ? (
            <View style={styles.chips}>
              {ingredients.map(item => (
                <Pressable key={item} style={styles.chip} onPress={() => removeIngredient(item)}>
                  <Text style={styles.chipText}>{item}</Text>
                  <Text style={styles.chipRemove}>✕</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyHint}>Noch keine Zutaten eingetragen.</Text>
          )}
        </View>

        {/* Get recipe button */}
        <TouchableOpacity
          style={[styles.recipeBtn, (loading || ingredients.length === 0) && styles.recipeBtnDisabled]}
          onPress={handleGetRecipe}
          disabled={loading || ingredients.length === 0}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.recipeBtnText}>Rezept vorschlagen ✨</Text>
          )}
        </TouchableOpacity>

        {/* Recipe result */}
        {recipe && (
          <View style={styles.recipeCard}>
            <RecipeText text={recipe} />
            <TouchableOpacity style={styles.retryBtn} onPress={handleGetRecipe}>
              <Text style={styles.retryBtnText}>Anderes Rezept</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Renders **bold** markers as styled text
function RecipeText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <View style={{ gap: 4 }}>
      {lines.map((line, i) => {
        const isBold = line.startsWith('**') && line.includes('**', 2);
        const clean = isBold ? line.replace(/\*\*/g, '') : line;
        return (
          <Text key={i} style={isBold ? styles.recipeBold : styles.recipeLine}>
            {clean}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111',
  },
  cancelBtn: {
    fontSize: 16,
    color: '#4F8EF7',
    width: 80,
  },
  scroll: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111',
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#999',
    marginTop: -6,
  },
  apiKeyRow: {
    flexDirection: 'row',
    gap: 8,
  },
  apiKeyInput: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111',
  },
  apiKeySaveBtn: {
    backgroundColor: '#4F8EF7',
    borderRadius: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  apiKeySaveText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  macroBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 6,
    flexWrap: 'wrap',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  macroBarLabel: {
    fontSize: 14,
    color: '#888',
    marginRight: 2,
  },
  macroBarValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
  },
  macroBarDot: {
    color: '#ddd',
    fontSize: 14,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  ingredientInput: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111',
  },
  addBtn: {
    backgroundColor: '#4F8EF7',
    borderRadius: 10,
    width: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '400',
    lineHeight: 28,
  },
  scanBtn: {
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    width: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanBtnText: {
    fontSize: 20,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  chipText: {
    fontSize: 14,
    color: '#333',
  },
  chipRemove: {
    fontSize: 11,
    color: '#aaa',
  },
  emptyHint: {
    fontSize: 13,
    color: '#ccc',
    textAlign: 'center',
    paddingVertical: 8,
  },
  recipeBtn: {
    backgroundColor: '#111',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  recipeBtnDisabled: {
    opacity: 0.4,
  },
  recipeBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  recipeCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    gap: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  recipeBold: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
    marginTop: 8,
  },
  recipeLine: {
    fontSize: 15,
    color: '#333',
    lineHeight: 22,
  },
  retryBtn: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  retryBtnText: {
    fontSize: 15,
    color: '#555',
    fontWeight: '500',
  },
  // Scanner
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanFrame: {
    width: 240,
    height: 160,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 12,
  },
  scanHint: {
    marginTop: 16,
    color: '#fff',
    fontSize: 14,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  scanCancelBtn: {
    marginTop: 32,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  scanCancelText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  scanLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  scanLoadingText: {
    color: '#fff',
    fontSize: 15,
  },
});
