/**
 * ArenaGo Design System — ScreenHeader Component
 * Barra superior unificada com botão de retorno, título e slot de ação à direita.
 *
 * Geometria e Acessibilidade (C05 / C07):
 * - O controle interativo de retorno (`Pressable`) possui dimensões mínimas próprias de 48x48dp
 *   (MIN_TOUCH_TARGET = 48), sem depender exclusivamente de hitSlop.
 * - O círculo visual de 40x40dp do Figma é preservado como elemento decorativo interno
 *   (`pointerEvents="none"`) centralizado na área interativa de 48x48dp.
 * - O cabeçalho utiliza `minHeight` (sem altura fixa restritiva) para acomodar fontes ampliadas.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import colors from '../../theme/colors.js';
import radii from '../../theme/radii.js';
import spacing from '../../theme/spacing.js';
import typography from '../../theme/typography.js';

export const MIN_TOUCH_TARGET = 48;
export const BACK_BUTTON_VISUAL_SIZE = 40;

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

function sanitizeHeaderStyle(styleInput) {
  const flat = { ...flattenStyleInput(styleInput) };
  const safeMinHeight = typeof flat.minHeight === 'number' ? Math.max(flat.minHeight, 56) : 56;
  flat.minHeight = safeMinHeight;
  if (typeof flat.height === 'number' && flat.height < safeMinHeight) {
    delete flat.height;
  }
  return flat;
}

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  rightAction,
  showBack = true,
  backDisabled = false,
  style,
  testID,
}) {
  const canGoBack = showBack && typeof onBack === 'function';
  const isBackDisabled = Boolean(backDisabled);
  const safeHeaderStyle = sanitizeHeaderStyle(style);

  function handleBackPress(event) {
    if (isBackDisabled) return;
    if (canGoBack) {
      onBack(event);
    }
  }

  return (
    <View style={[styles.header, safeHeaderStyle]} testID={testID}>
      {/* Botão de Voltar: Pressable de 48x48dp com círculo visual interno de 40x40dp */}
      <View style={styles.sideSlot}>
        {canGoBack ? (
          <Pressable
            style={({ pressed }) => [
              styles.backButton,
              isBackDisabled && styles.backButtonDisabled,
              pressed && !isBackDisabled && styles.backButtonPressed,
            ]}
            onPress={isBackDisabled ? undefined : handleBackPress}
            disabled={isBackDisabled}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            accessibilityState={{ disabled: isBackDisabled }}
            testID={testID ? `${testID}-back` : undefined}
          >
            <View
              pointerEvents="none"
              style={styles.backButtonCircle}
              testID={testID ? `${testID}-back-circle` : undefined}
            >
              <Text style={styles.backButtonText} allowFontScaling={false}>
                ←
              </Text>
            </View>
          </Pressable>
        ) : null}
      </View>

      {/* Título e Subtítulo Central */}
      <View style={styles.centerSlot}>
        {title && (
          <Text style={styles.title} numberOfLines={2} accessibilityRole="header">
            {title}
          </Text>
        )}
        {subtitle && (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        )}
      </View>

      {/* Ação à Direita (ex: Logout ou Badge) */}
      <View style={[styles.sideSlot, styles.rightSlot]}>
        {rightAction || null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.layout.screenPaddingHorizontal,
    paddingVertical: spacing.sm,
    minHeight: 56,
  },
  sideSlot: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  rightSlot: {
    alignItems: 'flex-end',
  },
  centerSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  backButton: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonCircle: {
    width: BACK_BUTTON_VISUAL_SIZE,
    height: BACK_BUTTON_VISUAL_SIZE,
    borderRadius: radii.full,
    backgroundColor: colors.background.surface,
    borderWidth: 1,
    borderColor: colors.border.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonDisabled: {
    opacity: 0.45,
  },
  backButtonPressed: {
    opacity: 0.85,
  },
  backButtonText: {
    fontFamily: typography.fontFamily,
    color: colors.text.primary,
    fontSize: 18,
    fontWeight: typography.weights.bold,
  },
  title: {
    ...typography.titleMedium,
    color: colors.text.primary,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: 2,
  },
});

export default ScreenHeader;
