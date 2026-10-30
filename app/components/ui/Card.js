/**
 * ArenaGo Design System — Card Component
 * Superfície para cards de arena, participações, opções de formulário e containers
 */

import { Pressable, StyleSheet, View } from 'react-native';
import colors from '../../theme/colors.js';
import radii from '../../theme/radii.js';
import spacing from '../../theme/spacing.js';

export function Card({
  children,
  variant = 'default',
  onPress,
  disabled = false,
  padding = spacing.layout.cardPadding,
  style,
  testID,
  accessibilityRole,
  accessibilityLabel,
  accessibilityState,
}) {
  const isClickable = typeof onPress === 'function';
  const isDisabled = Boolean(disabled);

  const cardStyles = [
    styles.base,
    styles[`variant_${variant}`] || styles.variant_default,
    isClickable && styles.clickableMinTarget,
    isDisabled && styles.disabled,
    { padding },
    style,
  ];

  function handlePress(event) {
    if (isDisabled) return;
    if (isClickable) {
      onPress(event);
    }
  }

  if (isClickable) {
    return (
      <Pressable
        onPress={isDisabled ? undefined : handlePress}
        disabled={isDisabled}
        style={({ pressed }) => [
          cardStyles,
          pressed && !isDisabled && styles.pressed,
        ]}
        accessibilityRole={accessibilityRole || 'button'}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ ...accessibilityState, disabled: isDisabled }}
        testID={testID}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={cardStyles} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.xl,
    overflow: 'hidden',
  },
  clickableMinTarget: {
    minHeight: 44,
    minWidth: 44,
  },
  variant_default: {
    backgroundColor: colors.background.surface,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  variant_highlight: {
    backgroundColor: colors.background.surface,
    borderWidth: 1.5,
    borderColor: colors.brand.primary,
  },
  variant_elevated: {
    backgroundColor: colors.background.elevated,
    borderWidth: 1,
    borderColor: colors.border.input,
  },
  variant_glass: {
    backgroundColor: colors.background.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border.glass,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.85,
    borderColor: colors.brand.primaryLight,
  },
});

export default Card;
