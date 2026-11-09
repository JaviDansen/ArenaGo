/**
 * ArenaGo Design System — AuthBackground Component (UI-02A)
 *
 * Contêiner visual reutilizável para autenticação e telas do participante:
 * - Fundo base dark (#05050A / #0B0B12) com ambientação roxa controlada.
 * - Suporte ao asset compartilhado vertical `app/assets/images/auth/shared-background.png` (941x1672, cover)
 *   posicionado atrás do conteúdo com `pointerEvents="none"`.
 * - Fallback dark automático quando `imageSource={null}`, `disableImage={true}` ou caso
 *   o asset local não esteja disponível ou falhe ao carregar.
 * - Proteção de contraste no topo (`topStatusScrim`) para garantir legibilidade da StatusBar
 *   no Android mesmo sobre artes mais claras.
 * - Transição vertical progressiva na metade inferior (`bottomScrimLayer` com faixas graduais
 *   suavizadas por curva Hermite/smoothstep), eliminando cortes horizontais bruscos sem exigir
 *   bibliotecas nativas adicionais.
 * - Compatível com SafeAreaView, KeyboardAvoidingView e ScrollView sem interceptar toques.
 */

import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import colors from '../../theme/colors.js';

export const AUTH_BACKGROUND_ASSET_PATH = 'app/assets/images/auth/shared-background.png';
export const WELCOME_BACKGROUND_ASSET_PATH = 'app/assets/images/auth/welcome-background.png';

export const AUTH_BACKGROUND_PRESETS = {
  welcome: {
    imageOpacity: 0.94,
    topOverlayOpacity: 0.16,
    bottomOverlayOpacity: 0.92,
    statusScrimOpacity: 0.42,
  },
  login: {
    imageOpacity: 0.65,
    topOverlayOpacity: 0.48,
    bottomOverlayOpacity: 0.9,
    statusScrimOpacity: 0.36,
  },
  register: {
    imageOpacity: 0.52,
    topOverlayOpacity: 0.62,
    bottomOverlayOpacity: 0.92,
    statusScrimOpacity: 0.32,
  },
  forgotPassword: {
    imageOpacity: 0.58,
    topOverlayOpacity: 0.55,
    bottomOverlayOpacity: 0.9,
    statusScrimOpacity: 0.36,
  },
};

const BOTTOM_SCRIM_STEP_COUNT = 24;
const TOP_STATUS_SCRIM_STEP_COUNT = 8;

function createBottomScrimWeights(stepCount) {
  const weights = [];
  const fadeZoneRatio = 0.68;

  for (let i = 0; i < stepCount; i += 1) {
    const t = i / (stepCount - 1);
    if (t <= fadeZoneRatio) {
      const u = t / fadeZoneRatio;
      // Smoothstep (3u^2 - 2u^3): derivada zero no início e no fim da rampa
      const eased = u * u * (3 - 2 * u);
      weights.push(Number(eased.toFixed(4)));
    } else {
      weights.push(1);
    }
  }

  return weights;
}

function createTopStatusScrimWeights(stepCount) {
  const weights = [];
  for (let i = 0; i < stepCount; i += 1) {
    const u = 1 - i / (stepCount - 1);
    const eased = u * u * (3 - 2 * u);
    weights.push(Number(eased.toFixed(4)));
  }
  return weights;
}

export const BOTTOM_SCRIM_WEIGHTS = createBottomScrimWeights(BOTTOM_SCRIM_STEP_COUNT);
export const TOP_STATUS_SCRIM_WEIGHTS = createTopStatusScrimWeights(TOP_STATUS_SCRIM_STEP_COUNT);

function loadDefaultAuthBackground() {
  try {
    // eslint-disable-next-line global-require
    return require('../../assets/images/auth/shared-background.png');
  } catch {
    return null;
  }
}

function loadDefaultWelcomeBackground() {
  try {
    // eslint-disable-next-line global-require
    return require('../../assets/images/auth/welcome-background.png');
  } catch {
    return null;
  }
}

const DEFAULT_AUTH_BACKGROUND_SOURCE = loadDefaultAuthBackground();
const DEFAULT_WELCOME_BACKGROUND_SOURCE = loadDefaultWelcomeBackground() || DEFAULT_AUTH_BACKGROUND_SOURCE;
const DEFAULT_BACKGROUND_SOURCE = DEFAULT_AUTH_BACKGROUND_SOURCE;

export function resolveDefaultBackgroundForVariant(variant = 'login') {
  if (variant === 'welcome') {
    return DEFAULT_WELCOME_BACKGROUND_SOURCE;
  }
  return DEFAULT_AUTH_BACKGROUND_SOURCE;
}

export function resolveAuthBackgroundPreset(variant = 'login', customOverlayOpacity) {
  const base = AUTH_BACKGROUND_PRESETS[variant] || AUTH_BACKGROUND_PRESETS.login;
  if (typeof customOverlayOpacity === 'number' && !Number.isNaN(customOverlayOpacity)) {
    const clamped = Math.max(0, Math.min(1, customOverlayOpacity));
    return {
      ...base,
      topOverlayOpacity: clamped,
      bottomOverlayOpacity: Math.min(1, clamped + 0.16),
    };
  }
  return base;
}

export function AuthBackground({
  children,
  variant = 'login',
  imageSource,
  disableImage = false,
  showAmbientGlow = true,
  overlayOpacity,
  useSafeArea = true,
  style,
  contentStyle,
  testID = 'auth-background',
}) {
  const [imageLoadFailed, setImageLoadFailed] = useState(false);

  const preset = resolveAuthBackgroundPreset(variant, overlayOpacity);
  const defaultSource = resolveDefaultBackgroundForVariant(variant);
  const resolvedSource =
    disableImage || imageLoadFailed
      ? null
      : imageSource !== undefined
      ? imageSource
      : defaultSource;

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
        {showAmbientGlow ? (
          <>
            <View style={styles.ambientTopGlow} pointerEvents="none" />
            <View style={styles.ambientBottomGlow} pointerEvents="none" />
          </>
        ) : null}

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

        {/* Camada global de proteção de contraste */}
        <View
          style={[
            styles.overlayLayer,
            { backgroundColor: colors.background.canvas, opacity: preset.topOverlayOpacity },
          ]}
          pointerEvents="none"
          testID={`${testID}-overlay-top`}
        />

        {/* Proteção suave no topo para garantir contraste consistente da StatusBar (V03) */}
        <View
          style={styles.topStatusScrimLayer}
          pointerEvents="none"
          testID={`${testID}-overlay-status`}
        >
          {TOP_STATUS_SCRIM_WEIGHTS.map((weight, index) => (
            <View
              // eslint-disable-next-line react/no-array-index-key
              key={`top-scrim-${index}`}
              style={[
                styles.scrimBand,
                {
                  backgroundColor: colors.background.canvas,
                  opacity: Number((weight * preset.statusScrimOpacity).toFixed(4)),
                },
              ]}
              pointerEvents="none"
            />
          ))}
        </View>

        {/* Transição gradual inferior sem corte retangular brusco (V01) */}
        <View
          style={styles.bottomScrimLayer}
          pointerEvents="none"
          testID={`${testID}-overlay-bottom`}
        >
          {BOTTOM_SCRIM_WEIGHTS.map((weight, index) => (
            <View
              // eslint-disable-next-line react/no-array-index-key
              key={`bottom-scrim-${index}`}
              style={[
                styles.scrimBand,
                {
                  backgroundColor: colors.background.base,
                  opacity: Number((weight * preset.bottomOverlayOpacity).toFixed(4)),
                },
              ]}
              pointerEvents="none"
              testID={
                index === 0
                  ? `${testID}-overlay-bottom-start`
                  : index === BOTTOM_SCRIM_WEIGHTS.length - 1
                  ? `${testID}-overlay-bottom-end`
                  : undefined
              }
            />
          ))}
        </View>
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
    ...StyleSheet.absoluteFill,
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
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
  overlayLayer: {
    ...StyleSheet.absoluteFill,
  },
  topStatusScrimLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 88,
    flexDirection: 'column',
  },
  bottomScrimLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '74%',
    flexDirection: 'column',
  },
  scrimBand: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});

export default AuthBackground;
