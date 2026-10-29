/**
 * ArenaGo Design System — Button Component
 * Suporta variantes: primary, secondary, outline, danger, dangerOutline, ghost
 */

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import colors from '../../theme/colors.js';
import radii from '../../theme/radii.js';
import spacing from '../../theme/spacing.js';
import typography from '../../theme/typography.js';

export function Button({
  title,
  children,
  onPress,
  variant = 'primary',
  size = 'lg',
  loading = false,
  disabled = false,
  leftIcon,
  rightIcon,
  fullWidth = true,
  style,
  textStyle,
  accessibilityLabel,
  testID,
}) {
  const isDisabled = disabled || loading;

  const buttonStyles = [
    styles.base,
    styles[`size_${size}`] || styles.size_lg,
    styles[`variant_${variant}`] || styles.variant_primary,
    fullWidth && styles.fullWidth,
    isDisabled && styles.disabled,
    style,
  ];

  const labelStyles = [
    styles.textBase,
    styles[`textSize_${size}`] || styles.textSize_lg,
    styles[`textVariant_${variant}`] || styles.textVariant_primary,
    isDisabled && styles.textDisabled,
    textStyle,
  ];

  const spinnerColor = variant === 'outline' || variant === 'ghost'
    ? colors.brand.primary
    : variant === 'dangerOutline'
    ? colors.semantic.danger
    : colors.text.primary;

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        buttonStyles,
        pressed && !isDisabled && (styles[`pressed_${variant}`] || styles.pressed_default),
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || (typeof title === 'string' ? title : 'Botão')}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator size="small" color={spinnerColor} />
      ) : (
        <View style={styles.contentRow}>
          {leftIcon && <View style={styles.leftIconContainer}>{leftIcon}</View>}
          {title ? <Text style={labelStyles}>{title}</Text> : children}
          {rightIcon && <View style={styles.rightIconContainer}>{rightIcon}</View>}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leftIconContainer: {
    marginRight: spacing.sm,
  },
  rightIconContainer: {
    marginLeft: spacing.sm,
  },

  // Tamanhos
  size_sm: {
    height: 36,
    paddingHorizontal: spacing.md,
  },
  size_md: {
    height: 44,
    paddingHorizontal: spacing.lg,
  },
  size_lg: {
    height: spacing.layout.buttonHeight,
    paddingHorizontal: spacing.xl,
  },

  // Variantes de Contêiner
  variant_primary: {
    backgroundColor: colors.brand.primary,
  },
  variant_secondary: {
    backgroundColor: colors.background.surface,
    borderWidth: 1,
    borderColor: colors.border.input,
  },
  variant_outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.brand.primary,
  },
  variant_danger: {
    backgroundColor: colors.semantic.danger,
  },
  variant_dangerOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.semantic.danger,
  },
  variant_ghost: {
    backgroundColor: 'transparent',
  },

  // Estados
  disabled: {
    opacity: 0.45,
  },
  pressed_default: {
    opacity: 0.85,
  },
  pressed_primary: {
    backgroundColor: colors.brand.primaryHover,
  },
  pressed_secondary: {
    backgroundColor: colors.background.elevated,
  },
  pressed_outline: {
    backgroundColor: colors.brand.primaryDim,
  },
  pressed_dangerOutline: {
    backgroundColor: colors.semantic.dangerBg,
  },

  // Tipografia dos Rótulos
  textBase: {
    ...typography.button,
    textAlign: 'center',
  },
  textSize_sm: {
    fontSize: typography.sizes.bodySmall,
    lineHeight: typography.lineHeights.bodySmall,
  },
  textSize_md: {
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
  },
  textSize_lg: {
    fontSize: typography.sizes.bodyLarge,
    lineHeight: typography.lineHeights.bodyLarge,
  },

  // Variantes de Texto
  textVariant_primary: {
    color: colors.text.onBrand,
  },
  textVariant_secondary: {
    color: colors.text.primary,
  },
  textVariant_outline: {
    color: colors.brand.primary,
  },
  textVariant_danger: {
    color: colors.text.primary,
  },
  textVariant_dangerOutline: {
    color: colors.semantic.danger,
  },
  textVariant_ghost: {
    color: colors.text.secondary,
  },
  textDisabled: {
    color: colors.text.disabled,
  },
});

export default Button;
