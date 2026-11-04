import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { adminColors, adminSpacing } from './adminTheme';

const variants = {
  primary: { fill: { backgroundColor: adminColors.accentStrong }, text: adminColors.onAccent },
  secondary: {
    fill: { backgroundColor: adminColors.surfaceRaised, borderColor: adminColors.border, borderWidth: 1 },
    text: adminColors.text,
  },
  danger: { fill: { backgroundColor: adminColors.dangerFill }, text: adminColors.onAccent },
  ghost: {
    fill: { backgroundColor: 'transparent', borderColor: adminColors.border, borderWidth: 1 },
    text: adminColors.text,
  },
};

// Botão padrão da Área Admin, com estados desabilitado e carregando.
// Com "selected" (true/false) vira uma opção de escolha única acessível.
export default function AdminButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  compact = false,
  selected,
  accessibilityLabel,
  accessibilityHint,
}) {
  const colors = variants[variant] ?? variants.primary;
  const isDisabled = disabled || loading;
  const isOption = typeof selected === 'boolean';

  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        colors.fill,
        isOption && selected && styles.selected,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      hitSlop={compact ? 6 : undefined}
      accessibilityRole={isOption ? 'radio' : 'button'}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={isOption
        ? { disabled: isDisabled, busy: loading, selected, checked: selected }
        : { disabled: isDisabled, busy: loading }}
    >
      {loading ? <ActivityIndicator color={colors.text} style={styles.spinner} /> : null}
      <Text style={[styles.text, compact && styles.compactText, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: adminSpacing.buttonRadius,
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: adminSpacing.gap,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  compact: { borderRadius: 8, marginTop: 8, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8 },
  selected: { backgroundColor: adminColors.accentStrong, borderColor: adminColors.accent },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  spinner: { marginRight: 8 },
  text: { fontSize: 15, fontWeight: 'bold', textAlign: 'center' },
  compactText: { fontSize: 13 },
});
