/**
 * ArenaGo Design System — TagChip Component
 * Chip de seleção e remoção rápida (utilizado no catálogo de jogos e filtros)
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import colors from '../../theme/colors.js';
import radii from '../../theme/radii.js';
import spacing from '../../theme/spacing.js';
import typography from '../../theme/typography.js';

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
  const isClickable = typeof onPress === 'function' && !disabled;
  const canRemove = typeof onRemove === 'function' && !disabled;

  const containerStyles = [
    styles.base,
    selected ? styles.selected : styles.unselected,
    disabled && styles.disabled,
    style,
  ];

  const labelStyles = [
    styles.text,
    selected ? styles.textSelected : styles.textUnselected,
    disabled && styles.textDisabled,
    textStyle,
  ];

  const content = (
    <View style={styles.innerRow}>
      <Text style={labelStyles}>{label}</Text>
      {canRemove && (
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          style={styles.removeButton}
          accessibilityRole="button"
          accessibilityLabel={`Remover ${label}`}
        >
          <Text style={styles.removeIcon}>✕</Text>
        </Pressable>
      )}
    </View>
  );

  if (isClickable) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          containerStyles,
          pressed && styles.pressed,
        ]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected, disabled }}
        testID={testID}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View style={containerStyles} testID={testID}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignSelf: 'flex-start',
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
  },
  innerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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
    width: 18,
    height: 18,
    borderRadius: radii.full,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeIcon: {
    color: colors.text.primary,
    fontSize: 10,
    fontWeight: typography.weights.bold,
  },
});

export default TagChip;
