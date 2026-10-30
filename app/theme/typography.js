/**
 * ArenaGo Design System — Tipografia
 * Adaptada para famílias sans-serif nativas modernas no Android e iOS.
 *
 * Nota técnica (UI-02A):
 * - No Android, omitir `fontFamily` ou usar `'System'` faz o React Native cair na fonte
 *   OEM global configurada no aparelho (que pode ser cursiva/manuscrita em dispositivos
 *   Samsung, Xiaomi ou Motorola).
 * - Por isso, resolvemos explicitamente `'sans-serif'` no Android (e `'System'` no iOS) e
 *   injetamos `fontFamily` em todos os presets tipográficos, mantendo a escala de fonte
 *   acessível do sistema (`allowFontScaling` ativo por padrão).
 */

export function resolveSystemSansFontFamily(platformOS) {
  if (platformOS === 'ios') {
    return 'System';
  }
  return 'sans-serif';
}

function detectPlatformOS() {
  try {
    // eslint-disable-next-line global-require
    const rn = require('react-native');
    if (rn && rn.Platform && typeof rn.Platform.OS === 'string') {
      return rn.Platform.OS;
    }
  } catch {
    // Ambiente Node de testes sem mock global de react-native
  }
  return 'android';
}

const defaultFontFamily = resolveSystemSansFontFamily(detectPlatformOS());

export const typography = {
  fontFamily: defaultFontFamily,

  families: {
    regular: defaultFontFamily,
    medium: defaultFontFamily === 'sans-serif' ? 'sans-serif-medium' : defaultFontFamily,
    bold: defaultFontFamily,
  },

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

  // Estilos tipográficos prontos para uso em StyleSheet (todos com fontFamily explícito)
  hero: {
    fontFamily: defaultFontFamily,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  titleLarge: {
    fontFamily: defaultFontFamily,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  titleMedium: {
    fontFamily: defaultFontFamily,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  titleSmall: {
    fontFamily: defaultFontFamily,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
  },
  bodyLarge: {
    fontFamily: defaultFontFamily,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
  },
  body: {
    fontFamily: defaultFontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
  },
  bodySmall: {
    fontFamily: defaultFontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
  },
  caption: {
    fontFamily: defaultFontFamily,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  micro: {
    fontFamily: defaultFontFamily,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
  },
  button: {
    fontFamily: defaultFontFamily,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  tag: {
    fontFamily: defaultFontFamily,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
};

export default typography;
