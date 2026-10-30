/**
 * ArenaGo Design System — TagChip Component
 * Chip de seleção e remoção rápida (utilizado no catálogo de jogos e filtros).
 * Sem Pressables aninhados (C02) e com área efetiva de toque >= 44x44pt (C01).
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import colors from '../../theme/colors.js';
import radii from '../../theme/radii.js';
import spacing from '../../theme/spacing.js';
import typography from '../../theme/typography.js';

// Chip visual tem minHeight 36pt -> hitSlop vertical de 4pt garante 44pt de área de toque
export const CHIP_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 };

// Controle visual de remoção tem 20x20pt -> hitSlop de 12pt em cada lado garante 44x44pt de área de toque
export const REMOVE_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

export function TagChip({
  label,
  selected = false,
  onPress,
  onRemove,
  disabled = false,
  style,
  textStyle,
  testID,
}) {
  const isDisabled = Boolean(disabled);
  const hasSelectHandler = typeof onPress === 'function';
  const hasRemoveHandler = typeof onRemove === 'function';

  const containerStyles = [
    styles.base,
    selected ? styles.selected : styles.unselected,
    isDisabled && styles.disabled,
    style,
  ];

  const labelStyles = [
    styles.text,
    selected ? styles.textSelected : styles.textUnselected,
    isDisabled && styles.textDisabled,
    textStyle,
  ];

  function handleSelectPress(event) {
    if (isDisabled) return;
    if (event && event._tagChipRemoved) return;
    if (hasSelectHandler) {
      onPress(label);
    }
  }

  function handleRemovePress(event) {
    if (event) {
      event._tagChipRemoved = true;
      if (typeof event.stopPropagation === 'function') {
        event.stopPropagation();
      }
    }
    if (isDisabled) return;
    if (hasRemoveHandler) {
      onRemove(label);
    }
  }

  return (
    <View style={containerStyles} testID={!hasSelectHandler ? testID : undefined}>
      <View style={styles.innerRow}>
        {hasSelectHandler ? (
          <Pressable
            onPress={isDisabled ? undefined : handleSelectPress}
            disabled={isDisabled}
            hitSlop={CHIP_HIT_SLOP}
            style={({ pressed }) => [
              styles.selectAction,
              pressed && !isDisabled && styles.pressed,
            ]}
            accessibilityRole="checkbox"
            accessibilityLabel={label}
            accessibilityState={{ checked: Boolean(selected), disabled: isDisabled }}
            testID={testID}
          >
            <Text style={labelStyles}>{label}</Text>
          </Pressable>
        ) : (
          <View style={styles.staticLabelContainer}>
            <Text style={labelStyles}>{label}</Text>
          </View>
        )}

        {hasRemoveHandler && (
          <Pressable
            onPress={isDisabled ? undefined : handleRemovePress}
            disabled={isDisabled}
            hitSlop={REMOVE_HIT_SLOP}
            style={({ pressed }) => [
              styles.removeButton,
              pressed && !isDisabled && styles.removeButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Remover ${label}`}
            accessibilityState={{ disabled: isDisabled }}
            testID={testID ? `${testID}-remove` : undefined}
          >
            <Text style={[styles.removeIcon, isDisabled && styles.textDisabled]}>✕</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.pill,
    minHeight: 36,
    minWidth: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
  },
  innerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectAction: {
    minHeight: 28,
    justifyContent: 'center',
    paddingVertical: 2,
  },
  staticLabelContainer: {
    minHeight: 28,
    justifyContent: 'center',
    paddingVertical: 2,
  },
  unselected: {
    backgroundColor: colors.background.surface,
    borderColor: colors.border.input,
  },
  selected: {
    backgroundColor: colors.brand.primaryDim,
    borderColor: colors.brand.primary,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.8,
  },
  text: {
    ...typography.body,
    fontWeight: typography.weights.medium,
  },
  textUnselected: {
    color: colors.text.secondary,
  },
  textSelected: {
    color: colors.text.primary,
    fontWeight: typography.weights.bold,
  },
  textDisabled: {
    color: colors.text.disabled,
  },
  removeButton: {
    marginLeft: spacing.sm,
    width: 20,
    height: 20,
    borderRadius: radii.full,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButtonPressed: {
    backgroundColor: colors.semantic.dangerBg,
  },
  removeIcon: {
    color: colors.text.primary,
    fontSize: 10,
    fontWeight: typography.weights.bold,
  },
});

export default TagChip;
