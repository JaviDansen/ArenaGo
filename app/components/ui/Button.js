/**
 * ArenaGo Design System — Button Component
 * Suporta variantes: primary, secondary, outline, danger, dangerOutline, ghost
 * Garante área mínima de toque de 44x44pt (C01) e estabilidade dimensional em loading (C03).
 */

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import colors from '../../theme/colors.js';
import radii from '../../theme/radii.js';
import spacing from '../../theme/spacing.js';
import typography from '../../theme/typography.js';

export const MIN_TOUCH_TARGET = 44;

export const BUTTON_HIT_SLOP_BY_SIZE = {
  sm: { top: 4, bottom: 4, left: 4, right: 4 }, // 36pt visual + 8pt hitSlop = 44pt efetivo
  md: { top: 0, bottom: 0, left: 0, right: 0 }, // 44pt visual = 44pt efetivo
  lg: { top: 0, bottom: 0, left: 0, right: 0 }, // 52pt visual >= 44pt efetivo
};

export function extractAccessibleText(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node).trim();
  if (Array.isArray(node)) {
    return node
      .map(extractAccessibleText)
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  if (typeof node === 'object') {
    if (typeof node.props?.accessibilityLabel === 'string' && node.props.accessibilityLabel.trim()) {
      return node.props.accessibilityLabel.trim();
    }
    if (typeof node.props?.title === 'string' && node.props.title.trim()) {
      return node.props.title.trim();
    }
    if (typeof node.props?.label === 'string' && node.props.label.trim()) {
      return node.props.label.trim();
    }
    if (node.props?.children !== undefined) {
      return extractAccessibleText(node.props.children);
    }
  }
  return '';
}

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
  hitSlop,
  style,
  textStyle,
  accessibilityLabel,
  testID,
}) {
  const isDisabled = Boolean(disabled || loading);
  const resolvedHitSlop = hitSlop ?? (BUTTON_HIT_SLOP_BY_SIZE[size] || BUTTON_HIT_SLOP_BY_SIZE.lg);

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

  const resolvedLabel =
    (typeof accessibilityLabel === 'string' && accessibilityLabel.trim()) ||
    (typeof title === 'string' && title.trim()) ||
    extractAccessibleText(children) ||
    'Botão';

  function handlePress(event) {
    if (isDisabled) return;
    if (typeof onPress === 'function') {
      onPress(event);
    }
  }

  const renderedContent = title ? (
    <Text style={labelStyles}>{title}</Text>
  ) : typeof children === 'string' || typeof children === 'number' ? (
    <Text style={labelStyles}>{children}</Text>
  ) : (
    children
  );

  return (
    <Pressable
      onPress={isDisabled ? undefined : handlePress}
      disabled={isDisabled}
      hitSlop={resolvedHitSlop}
      style={({ pressed }) => [
        buttonStyles,
        pressed && !isDisabled && (styles[`pressed_${variant}`] || styles.pressed_default),
      ]}
      accessibilityRole="button"
      accessibilityLabel={resolvedLabel}
      accessibilityState={{ disabled: isDisabled, busy: Boolean(loading) }}
      testID={testID}
    >
      <View
        style={[styles.contentRow, loading && styles.contentHidden]}
        accessibilityElementsHidden={Boolean(loading)}
        importantForAccessibility={loading ? 'no-hide-descendants' : 'auto'}
      >
        {leftIcon && <View style={styles.leftIconContainer}>{leftIcon}</View>}
        {renderedContent}
        {rightIcon && <View style={styles.rightIconContainer}>{rightIcon}</View>}
      </View>
      {loading && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="small" color={spinnerColor} />
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
    minWidth: MIN_TOUCH_TARGET,
    position: 'relative',
  },
  fullWidth: {
    width: '100%',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentHidden: {
    opacity: 0,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leftIconContainer: {
    marginRight: spacing.sm,
  },
  rightIconContainer: {
    marginLeft: spacing.sm,
  },

  // Tamanhos (preservam altura e largura mínimas entre estados normal e loading)
  size_sm: {
    height: 36,
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  size_md: {
    height: 44,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  size_lg: {
    height: spacing.layout.buttonHeight,
    minHeight: spacing.layout.buttonHeight,
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
  pressed_danger: {
    opacity: 0.85,
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
