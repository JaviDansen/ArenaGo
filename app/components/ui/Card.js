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
  padding = spacing.layout.cardPadding,
  style,
  testID,
  accessibilityRole,
  accessibilityLabel,
  accessibilityState,
}) {
  const isClickable = typeof onPress === 'function';

  const cardStyles = [
    styles.base,
    styles[`variant_${variant}`] || styles.variant_default,
    { padding },
    style,
  ];

  if (isClickable) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          cardStyles,
          pressed && styles.pressed,
        ]}
        accessibilityRole={accessibilityRole || 'button'}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
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
  pressed: {
    opacity: 0.85,
    borderColor: colors.brand.primaryLight,
  },
});

export default Card;
