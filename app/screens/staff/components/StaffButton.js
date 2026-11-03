import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { staffBrandFill, staffColors, staffSpacing } from './staffTheme';

const variants = {
  primary: { fill: staffBrandFill, text: staffColors.onBrand },
  secondary: { fill: { backgroundColor: staffColors.secondary }, text: staffColors.text },
  danger: { fill: { backgroundColor: staffColors.danger }, text: staffColors.onBrand },
};

// Botão padrão das telas Staff (degradê, cinza ou vermelho), com estados de
// desabilitado e carregando. "compact" gera a pílula usada dentro das listas.
export default function StaffButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  compact = false,
  accessibilityLabel,
  accessibilityHint,
}) {
  const colors = variants[variant] ?? variants.primary;
  const isDisabled = disabled || loading;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        colors.fill,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      hitSlop={compact ? 6 : undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
    >
      {loading ? <ActivityIndicator color={colors.text} style={styles.spinner} /> : null}
      <Text style={[styles.text, compact && styles.compactText, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: staffSpacing.buttonRadius,
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: staffSpacing.gap,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  compact: { borderRadius: 8, marginTop: 0, minHeight: 32, paddingHorizontal: 12, paddingVertical: 6 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  spinner: { marginRight: 8 },
  text: { fontSize: 15, fontWeight: 'bold', textAlign: 'center' },
  compactText: { fontSize: 13 },
});
