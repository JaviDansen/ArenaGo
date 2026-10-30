/**
 * ArenaGo Design System — AuthBackground Component (UI-02A)
 *
 * Contêiner visual reutilizável para as telas públicas de autenticação:
 * - Fundo base dark (#05050A / #0B0B12) com ambientação roxa controlada.
 * - Suporte ao asset vertical `app/assets/images/auth/auth-background.jpg` (1440x3200, cover)
 *   posicionado atrás do conteúdo com `pointerEvents="none"`.
 * - Fallback dark automático quando `imageSource={null}`, `disableImage={true}` ou caso
 *   o asset local não esteja disponível ou falhe ao carregar.
 * - Camadas de proteção de contraste configuráveis por variante de tela:
 *   - `welcome`: imagem mais evidente no topo/centro, escurecimento forte na base textual.
 *   - `login`: imagem discreta, maior escurecimento na região do formulário.
 *   - `register`: prioridade máxima à legibilidade, background apenas como ambientação.
 *   - `forgotPassword`: ambientação discreta e uniforme.
 * - Compatível com SafeAreaView, KeyboardAvoidingView e ScrollView sem interceptar toques.
 */

import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import colors from '../../theme/colors.js';

export const AUTH_BACKGROUND_ASSET_PATH = 'app/assets/images/auth/auth-background.jpg';

export const AUTH_BACKGROUND_PRESETS = {
  welcome: {
    imageOpacity: 0.92,
    topOverlayOpacity: 0.26,
    bottomOverlayOpacity: 0.84,
  },
  login: {
    imageOpacity: 0.52,
    topOverlayOpacity: 0.62,
    bottomOverlayOpacity: 0.86,
  },
  register: {
    imageOpacity: 0.38,
    topOverlayOpacity: 0.74,
    bottomOverlayOpacity: 0.9,
  },
  forgotPassword: {
    imageOpacity: 0.45,
    topOverlayOpacity: 0.68,
    bottomOverlayOpacity: 0.88,
  },
};

function loadDefaultAuthBackground() {
  try {
    // eslint-disable-next-line global-require
    return require('../../assets/images/auth/auth-background.jpg');
  } catch {
    return null;
  }
}

const DEFAULT_BACKGROUND_SOURCE = loadDefaultAuthBackground();

export function resolveAuthBackgroundPreset(variant = 'login', customOverlayOpacity) {
  const base = AUTH_BACKGROUND_PRESETS[variant] || AUTH_BACKGROUND_PRESETS.login;
  if (typeof customOverlayOpacity === 'number' && !Number.isNaN(customOverlayOpacity)) {
    const clamped = Math.max(0, Math.min(1, customOverlayOpacity));
    return {
      ...base,
      topOverlayOpacity: clamped,
      bottomOverlayOpacity: Math.min(1, clamped + 0.12),
    };
  }
  return base;
}

export function AuthBackground({
  children,
  variant = 'login',
  imageSource,
  disableImage = false,
  overlayOpacity,
  useSafeArea = true,
  style,
  contentStyle,
  testID = 'auth-background',
}) {
  const [imageLoadFailed, setImageLoadFailed] = useState(false);

  const preset = resolveAuthBackgroundPreset(variant, overlayOpacity);
  const resolvedSource =
    disableImage || imageLoadFailed
      ? null
      : imageSource !== undefined
      ? imageSource
      : DEFAULT_BACKGROUND_SOURCE;

  const ContentWrapper = useSafeArea ? SafeAreaView : View;

  return (
    <View style={[styles.root, style]} testID={testID}>
      {/* Camada de fundo e contraste (nunca intercepta toques nem leitura de tela) */}
      <View
        style={styles.backdropContainer}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID={`${testID}-backdrop`}
      >
        {/* Ambientação dark base / fallback */}
        <View style={styles.ambientTopGlow} pointerEvents="none" />
        <View style={styles.ambientBottomGlow} pointerEvents="none" />

        {resolvedSource ? (
          <Image
            source={resolvedSource}
            resizeMode="cover"
            style={[styles.backgroundImage, { opacity: preset.imageOpacity }]}
            onError={() => setImageLoadFailed(true)}
            accessible={false}
            testID={`${testID}-image`}
          />
        ) : null}

        {/* Camada superior de proteção de contraste */}
        <View
          style={[
            styles.overlayLayer,
            { backgroundColor: colors.background.canvas, opacity: preset.topOverlayOpacity },
          ]}
          pointerEvents="none"
          testID={`${testID}-overlay-top`}
        />

        {/* Camada inferior mais densa para proteger leitura de títulos, inputs e botões */}
        <View
          style={[
            styles.bottomScrimLayer,
            { backgroundColor: colors.background.base, opacity: preset.bottomOverlayOpacity },
          ]}
          pointerEvents="none"
          testID={`${testID}-overlay-bottom`}
        />
      </View>

      {/* Conteúdo interativo respeitando Safe Areas */}
      <ContentWrapper style={[styles.safeArea, contentStyle]}>
        {children}
      </ContentWrapper>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background.base,
  },
  backdropContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background.canvas,
    overflow: 'hidden',
  },
  ambientTopGlow: {
    position: 'absolute',
    top: -120,
    right: -80,
    width: 340,
    height: 340,
    borderRadius: 9999,
    backgroundColor: colors.brand.primaryDim,
  },
  ambientBottomGlow: {
    position: 'absolute',
    bottom: -140,
    left: -100,
    width: 300,
    height: 300,
    borderRadius: 9999,
    backgroundColor: 'rgba(95, 51, 250, 0.08)',
  },
  backgroundImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  overlayLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  bottomScrimLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '58%',
  },
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});

export default AuthBackground;
