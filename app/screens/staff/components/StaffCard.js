import { Pressable, StyleSheet, View } from 'react-native';

import { staffColors, staffSpacing } from './staffTheme';

// Cartão cinza das telas Staff. "accent" desenha a faixa roxa à esquerda vista
// nos prints; com onPress o cartão vira botão acessível.
export default function StaffCard({ children, accent, onPress, accessibilityLabel, style }) {
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
    backgroundColor: staffColors.surface,
    borderRadius: staffSpacing.radius,
    marginTop: staffSpacing.gap,
    padding: 16,
  },
  accent: { borderLeftColor: staffColors.accent, borderLeftWidth: 3 },
  pressed: { opacity: 0.7 },
});
