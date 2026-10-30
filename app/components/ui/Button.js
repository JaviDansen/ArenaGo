/**
 * ArenaGo Design System — Button Component
 * Suporta variantes: primary, secondary, outline, danger, dangerOutline, ghost.
 *
 * Geometria, Robustez e Acessibilidade (C05 / C07):
 * - Referência interativa mínima de 48x48dp (MIN_TOUCH_TARGET = 48) diretamente no Pressable
 *   em todos os tamanhos (sm: minHeight 48dp, md: minHeight 48dp, lg: minHeight 52dp),
 *   sem depender exclusivamente de hitSlop.
 * - Protege as dimensões interativas mínimas contra sobrescritas acidentais via prop `style`,
 *   preservando customizações legítimas de aparência (cores, bordas, margens, larguras maiores).
 * - Utiliza `minHeight` + `paddingVertical` e `flexShrink: 1` (em vez de `height` fixo) para
 *   acomodar rótulos longos em múltiplas linhas e fontes ampliadas do sistema sem cortes,
 *   mantendo `contentRow` montado (`opacity: 0`) durante `loading` para estabilidade dimensional.
 * - IMPORTANTE (Acessibilidade): Quando o conteúdo for passado via `children` utilizando
 *   componentes customizados ou elementos visuais opacos (como ícones sem texto extraível),
 *   informe explicitamente a prop `accessibilityLabel`. A geometria final de toque e leitura
 *   de tela em runtime também depende de os contêineres ancestrais não recortarem o botão.
 */

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import colors from '../../theme/colors.js';
import radii from '../../theme/radii.js';
import spacing from '../../theme/spacing.js';
import typography from '../../theme/typography.js';

export const MIN_TOUCH_TARGET = 48;

export const BUTTON_MIN_HEIGHT_BY_SIZE = {
  sm: MIN_TOUCH_TARGET,
  md: MIN_TOUCH_TARGET,
  lg: spacing.layout.buttonHeight,
};

function flattenStyleInput(styleInput) {
  if (!styleInput) return {};
  if (typeof StyleSheet.flatten === 'function') {
    return StyleSheet.flatten(styleInput) || {};
  }
  if (Array.isArray(styleInput)) {
    return Object.assign({}, ...styleInput.map(flattenStyleInput));
  }
  if (typeof styleInput === 'object') {
    return { ...styleInput };
  }
  return {};
}

export function sanitizeInteractiveStyle(styleInput, minWidth = MIN_TOUCH_TARGET, minHeight = MIN_TOUCH_TARGET) {
  const flat = { ...flattenStyleInput(styleInput) };

  const safeMinWidth = typeof flat.minWidth === 'number'
    ? Math.max(flat.minWidth, minWidth)
    : minWidth;
  const safeMinHeight = typeof flat.minHeight === 'number'
    ? Math.max(flat.minHeight, minHeight)
    : minHeight;

  flat.minWidth = safeMinWidth;
  flat.minHeight = safeMinHeight;

  if (typeof flat.width === 'number' && flat.width < safeMinWidth) {
    flat.width = safeMinWidth;
  }
  if (typeof flat.height === 'number' && flat.height < safeMinHeight) {
    delete flat.height;
  }
  if (typeof flat.maxWidth === 'number' && flat.maxWidth < safeMinWidth) {
    flat.maxWidth = safeMinWidth;
  }
  if (typeof flat.maxHeight === 'number' && flat.maxHeight < safeMinHeight) {
    flat.maxHeight = safeMinHeight;
  }

  return flat;
}

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
  const minHeightForSize = BUTTON_MIN_HEIGHT_BY_SIZE[size] || BUTTON_MIN_HEIGHT_BY_SIZE.lg;
  const safeCustomStyle = sanitizeInteractiveStyle(style, MIN_TOUCH_TARGET, minHeightForSize);

  const buttonStyles = [
    styles.base,
    styles[`size_${size}`] || styles.size_lg,
    styles[`variant_${variant}`] || styles.variant_primary,
    fullWidth && styles.fullWidth,
    safeCustomStyle,
    isDisabled && styles.disabled,
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
      hitSlop={hitSlop}
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
    flexShrink: 1,
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

  // Tamanhos com minHeight >= 48dp (permite expansão vertical para textos longos / fontes ampliadas)
  size_sm: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  size_md: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  size_lg: {
    minHeight: spacing.layout.buttonHeight,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
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
    flexShrink: 1,
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
