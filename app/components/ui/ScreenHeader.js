/**
 * ArenaGo Design System — ScreenHeader Component
 * Barra superior unificada com botão de retorno, título e slot de ação à direita
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import colors from '../../theme/colors.js';
import radii from '../../theme/radii.js';
import spacing from '../../theme/spacing.js';
import typography from '../../theme/typography.js';

// Botão de retorno visual 40x40pt + hitSlop de 6pt = 52x52pt de área efetiva de toque (>= 44x44pt)
export const BACK_BUTTON_HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 };

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

  function handleBackPress(event) {
    if (isBackDisabled) return;
    if (canGoBack) {
      onBack(event);
    }
  }

  return (
    <View style={[styles.header, style]} testID={testID}>
      {/* Botão de Voltar */}
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
            hitSlop={BACK_BUTTON_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            accessibilityState={{ disabled: isBackDisabled }}
          >
            <Text style={styles.backButtonText}>←</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Título e Subtítulo Central */}
      <View style={styles.centerSlot}>
        {title && (
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        )}
        {subtitle && (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>

      {/* Ação à Direita (ex: Logout ou Ícone) */}
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
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  sideSlot: {
    width: 44,
    minHeight: 44,
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
  },
  backButton: {
    width: 40,
    height: 40,
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
    backgroundColor: colors.background.elevated,
    borderColor: colors.brand.primary,
  },
  backButtonText: {
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
