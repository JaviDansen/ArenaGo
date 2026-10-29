/**
 * ArenaGo Design System — Tipografia
 * Adaptada do Figma para dimensões lógicas do React Native
 */

// Família de fonte padrão do sistema (San Francisco no iOS, Roboto no Android)
const defaultFontFamily = 'System';

export const typography = {
  fontFamily: defaultFontFamily,

  weights: {
    regular: '400',
    medium: '500',
    semiBold: '600',
    bold: '700',
    extraBold: '800',
  },

  sizes: {
    micro: 10,
    caption: 12,
    bodySmall: 13,
    body: 14,
    bodyLarge: 16,
    titleSmall: 18,
    titleMedium: 20,
    titleLarge: 24,
    hero: 28,
  },

  lineHeights: {
    micro: 14,
    caption: 16,
    bodySmall: 18,
    body: 20,
    bodyLarge: 22,
    titleSmall: 24,
    titleMedium: 26,
    titleLarge: 32,
    hero: 36,
  },

  // Estilos tipográficos prontos para uso em StyleSheet
  hero: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '800',
  },
  titleLarge: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
  },
  titleMedium: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  titleSmall: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
  },
  bodyLarge: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
  },
  bodySmall: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  micro: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
  },
  button: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
  },
  tag: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
};

export default typography;
