/**
 * ArenaGo Design System — Badge Component
 * Pílula para exibição de status, tags e contadores (Ativo, Em Espera, Sua Vez, etc.)
 */

import { StyleSheet, Text, View } from 'react-native';
import colors from '../../theme/colors.js';
import radii from '../../theme/radii.js';
import spacing from '../../theme/spacing.js';
import typography from '../../theme/typography.js';

export function Badge({
  label,
  children,
  variant = 'default',
  size = 'md',
  icon,
  style,
  textStyle,
}) {
  const containerStyles = [
    styles.base,
    styles[`size_${size}`] || styles.size_md,
    styles[`variant_${variant}`] || styles.variant_default,
    style,
  ];

  const labelStyles = [
    styles.textBase,
    styles[`textSize_${size}`] || styles.textSize_md,
    styles[`textVariant_${variant}`] || styles.textVariant_default,
    textStyle,
  ];

  return (
    <View style={containerStyles}>
      {icon && <View style={styles.iconContainer}>{icon}</View>}
      {label ? <Text style={labelStyles}>{label}</Text> : children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  iconContainer: {
    marginRight: spacing.xs,
  },

  // Tamanhos
  size_sm: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  size_md: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },

  // Variantes de Contêiner
  variant_default: {
    backgroundColor: colors.background.elevated,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  variant_brand: {
    backgroundColor: colors.brand.primaryDim,
    borderWidth: 1,
    borderColor: colors.brand.primary,
  },
  variant_success: {
    backgroundColor: colors.semantic.successBg,
    borderWidth: 1,
    borderColor: colors.semantic.success,
  },
  variant_danger: {
    backgroundColor: colors.semantic.dangerBg,
    borderWidth: 1,
    borderColor: colors.semantic.danger,
  },
  variant_warning: {
    backgroundColor: colors.semantic.warningBg,
    borderWidth: 1,
    borderColor: colors.semantic.warning,
  },
  variant_info: {
    backgroundColor: colors.semantic.infoBg,
    borderWidth: 1,
    borderColor: colors.semantic.info,
  },

  // Tipografia
  textBase: {
    fontWeight: typography.weights.bold,
    letterSpacing: 0.5,
  },
  textSize_sm: {
    fontSize: typography.sizes.micro,
    lineHeight: typography.lineHeights.micro,
  },
  textSize_md: {
    fontSize: typography.sizes.caption,
    lineHeight: typography.lineHeights.caption,
  },

  // Variantes de Texto
  textVariant_default: {
    color: colors.text.secondary,
  },
  textVariant_brand: {
    color: colors.brand.primaryLight,
  },
  textVariant_success: {
    color: colors.semantic.success,
  },
  textVariant_danger: {
    color: colors.semantic.danger,
  },
  textVariant_warning: {
    color: colors.semantic.warning,
  },
  textVariant_info: {
    color: colors.semantic.info,
  },
});

export default Badge;
