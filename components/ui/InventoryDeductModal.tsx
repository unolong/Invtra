import React, { useEffect, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import type { InventoryMatch } from '@/lib/inventoryMatching';
import { parseGrams } from '@/lib/inventoryMatching';

const ACCENT = '#c8ff00';
const GREEN = '#26de81';

interface Props {
  visible: boolean;
  meal?: string;
  matches: InventoryMatch[];
  onDeduct: (selected: InventoryMatch[]) => void;
  onSkip: () => void;
}

export default function InventoryDeductModal({ visible, meal, matches, onDeduct, onSkip }: Props) {
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    setChecked(new Set(matches.map(m => m.inventoryItem.id)));
  }, [matches, visible]);

  const toggle = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selected = matches.filter(m => checked.has(m.inventoryItem.id));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onSkip}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Title */}
          <Text style={styles.title}>Vom Inventar abziehen?</Text>

          {/* Info card */}
          <View style={styles.infoCard}>
            <Text style={styles.infoCount}>
              {matches.length} Zutat{matches.length !== 1 ? 'en' : ''} in deinem Inventar
            </Text>
            {meal && (
              <Text style={styles.infoSub}>
                Aus {meal} – wähle was du verbraucht hast
              </Text>
            )}
          </View>

          {/* Item list */}
          <ScrollView
            style={styles.list}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {matches.map((match, i) => {
              const isChecked = checked.has(match.inventoryItem.id);
              const invGrams = parseGrams(match.inventoryItem.qty);
              const deductGrams = match.trackedAmountGrams;

              return (
                <TouchableOpacity
                  key={match.inventoryItem.id}
                  style={[styles.row, i < matches.length - 1 && styles.rowDivider]}
                  onPress={() => toggle(match.inventoryItem.id)}
                  activeOpacity={0.7}
                >
                  {/* Checkbox */}
                  <View style={[styles.checkbox, isChecked && styles.checkboxOn]}>
                    {isChecked && <Text style={styles.checkmark}>✓</Text>}
                  </View>

                  {/* Initial icon */}
                  <View style={styles.icon}>
                    <Text style={styles.iconText}>
                      {(match.inventoryItem.name[0] ?? '?').toUpperCase()}
                    </Text>
                  </View>

                  {/* Name */}
                  <Text style={styles.itemName} numberOfLines={1}>
                    {match.inventoryItem.name}
                  </Text>

                  {/* Amounts */}
                  <View style={styles.amounts}>
                    <Text style={styles.invQty}>{match.inventoryItem.qty}</Text>
                    {deductGrams > 0 && (
                      <Text style={styles.deductQty}>-{deductGrams}g</Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Buttons */}
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.skipBtn} onPress={onSkip} activeOpacity={0.8}>
              <Text style={styles.skipText}>Überspringen</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.deductBtn, selected.length === 0 && styles.deductBtnDisabled]}
              onPress={() => onDeduct(selected)}
              disabled={selected.length === 0}
              activeOpacity={0.85}
            >
              <Text style={styles.deductText}>{selected.length} Artikel abziehen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 0.5,
    borderBottomWidth: 0,
    borderColor: '#222222',
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 12,
    maxHeight: '80%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.5,
    marginBottom: 14,
  },
  infoCard: {
    backgroundColor: `${GREEN}12`,
    borderWidth: 0.5,
    borderColor: `${GREEN}28`,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
    gap: 3,
  },
  infoCount: {
    fontSize: 14,
    fontWeight: '700',
    color: GREEN,
    letterSpacing: -0.2,
  },
  infoSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    fontWeight: '500',
  },
  list: {
    maxHeight: 300,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    gap: 10,
  },
  rowDivider: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#1e1e1e',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkboxOn: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  checkmark: {
    fontSize: 12,
    fontWeight: '800',
    color: '#000',
    lineHeight: 14,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconText: {
    fontSize: 14,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.65)',
  },
  itemName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.1,
  },
  amounts: {
    alignItems: 'flex-end',
    gap: 2,
    flexShrink: 0,
  },
  invQty: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
  },
  deductQty: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F74F4F',
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  skipBtn: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: '#181818',
    borderWidth: 0.5,
    borderColor: '#2a2a2a',
    alignItems: 'center',
  },
  skipText: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
  },
  deductBtn: {
    flex: 2,
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: ACCENT,
    alignItems: 'center',
  },
  deductBtnDisabled: {
    opacity: 0.4,
  },
  deductText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#000',
    letterSpacing: -0.2,
  },
});
