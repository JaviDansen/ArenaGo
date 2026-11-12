import { Pressable, StyleSheet, View } from 'react-native';

import { adminColors, adminSpacing } from './adminTheme';

// Cartão escuro da Área Admin. "accent" desenha a faixa roxa à esquerda; com
// onPress o cartão vira botão acessível.
export default function AdminCard({ children, accent, onPress, accessibilityLabel, style }) {
  const cardStyle = [styles.card, accent && styles.accent, style];
  if (onPress) {
    return (
      <Pressable
        style={({ pressed }) => [...cardStyle, pressed && styles.pressed]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={cardStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: adminColors.surface,
    borderColor: adminColors.border,
    borderRadius: adminSpacing.radius,
    borderWidth: 1,
    marginTop: adminSpacing.gap,
    padding: 16,
  },
  accent: { borderLeftColor: adminColors.accent, borderLeftWidth: 4 },
  pressed: { opacity: 0.7 },
});
