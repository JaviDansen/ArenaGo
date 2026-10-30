/**
 * ArenaGo Design System — Card Component
 * Superfície para cards de arena, participações, opções de formulário e containers.
 *
 * Geometria, Robustez e Acessibilidade (C05 / C07):
 * - Quando interativo (`onPress` definido), garante alvo mínimo de 48x48dp (MIN_TOUCH_TARGET = 48)
 *   diretamente no Pressable e protege essas dimensões contra sobrescritas acidentais via `style`,
 *   preservando customizações legítimas de aparência.
 * - Não fixa altura estática, permitindo expansão vertical fluida para textos longos e fontes ampliadas.
 * - IMPORTANTE (Acessibilidade): Em cards interativos cujo conteúdo React composto não exponha
 *   um nome claro para leitores de tela, informe explicitamente `accessibilityLabel`. O comportamento
 *   final de toque e leitura de tela depende também do layout dos contêineres ancestrais.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import colors from '../../theme/colors.js';
import radii from '../../theme/radii.js';
import spacing from '../../theme/spacing.js';

export const MIN_TOUCH_TARGET = 48;

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

function sanitizeCardStyle(styleInput, minWidth = MIN_TOUCH_TARGET, minHeight = MIN_TOUCH_TARGET) {
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

  const resolvedCustomStyle = isClickable
    ? sanitizeCardStyle(style, MIN_TOUCH_TARGET, MIN_TOUCH_TARGET)
    : style;

  const cardStyles = [
    styles.base,
    styles[`variant_${variant}`] || styles.variant_default,
    isClickable && styles.clickableMinTarget,
    { padding },
    resolvedCustomStyle,
    isDisabled && styles.disabled,
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
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
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
