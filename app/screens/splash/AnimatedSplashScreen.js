import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  StyleSheet,
  View,
} from 'react-native';
import { colors } from '../../theme';
import {
  hideNativeSplashAsync,
  markSplashCompleted,
} from '../../services/splashScreenService';

function loadOfficialLogo() {
  try {
    // eslint-disable-next-line global-require
    return require('../../assets/images/logo-arenago.png');
  } catch {
    try {
      // eslint-disable-next-line global-require
      return require('../../assets/splash-icon.png');
    } catch {
      return null;
    }
  }
}

const defaultLogoSource = loadOfficialLogo();

export const ANIMATION_DEFAULTS = {
  INTRO_DURATION_MS: 700,
  HOLD_DURATION_MS: 1500,
  FADE_DURATION_MS: 300,
  TARGET_TOTAL_DURATION_MS: 2500, // 700 + 1500 + 300 = 2500ms
  MIN_DISPLAY_TIME_MS: 2200,      // 700 + 1500 = 2200ms antes da saída
  MAX_WAIT_MS: 3500,              // Limite máximo de espera por inicializações lentas
  SAFETY_TIMEOUT_MS: 5000,        // Timeout absoluto de segurança
  PREPARATION_TIMEOUT_MS: 250,    // Timeout de segurança para ambientes sem medição onLayout
  SCALE_START: 0.9,
  SCALE_END: 1.0,
};

export default function AnimatedSplashScreen({
  isReady = true,
  onDismissStart,
  onDismiss,
  animationDurationMs = ANIMATION_DEFAULTS.INTRO_DURATION_MS,
  holdDurationMs = ANIMATION_DEFAULTS.HOLD_DURATION_MS,
  fadeDurationMs = ANIMATION_DEFAULTS.FADE_DURATION_MS,
  maxWaitMs = ANIMATION_DEFAULTS.MAX_WAIT_MS,
  safetyTimeoutMs = ANIMATION_DEFAULTS.SAFETY_TIMEOUT_MS,
  preparationTimeoutMs = ANIMATION_DEFAULTS.PREPARATION_TIMEOUT_MS,
  imageSource = defaultLogoSource,
  reduceMotion = undefined,
  splashModule = undefined,
}) {
  const [isReducedMotion, setIsReducedMotion] = useState(Boolean(reduceMotion));
  const [isPrepared, setIsPrepared] = useState(false);
  const [introFinished, setIntroFinished] = useState(false);
  const [holdFinished, setHoldFinished] = useState(false);

  const isPreparedRef = useRef(false);
  const isDismissingRef = useRef(false);

  const containerOpacity = useRef(new Animated.Value(1)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(ANIMATION_DEFAULTS.SCALE_START)).current;

  // 1. Detectar preferência por movimento reduzido
  useEffect(() => {
    let mounted = true;
    if (typeof reduceMotion === 'boolean') {
      setIsReducedMotion(reduceMotion);
      return;
    }
    if (typeof AccessibilityInfo?.isReduceMotionEnabled === 'function') {
      AccessibilityInfo.isReduceMotionEnabled()
        .then((enabled) => {
          if (mounted) {
            setIsReducedMotion(Boolean(enabled));
          }
        })
        .catch(() => {
          // Mantém valor padrão se API nativa estiver inacessível
        });
    }
    return () => {
      mounted = false;
    };
  }, [reduceMotion]);

  // Função centralizada para confirmar preparação da composição React Native
  const markPrepared = useCallback(() => {
    if (isPreparedRef.current) {
      return;
    }
    isPreparedRef.current = true;
    setIsPrepared(true);
    void hideNativeSplashAsync(splashModule);
  }, [splashModule]);

  // 2. Ocultar Splash nativa somente após a camada React Native concluir layout com medição válida
  const handleLayout = useCallback(
    (event) => {
      const layout = event?.nativeEvent?.layout;
      if (!layout || (layout.width > 0 && layout.height > 0)) {
        markPrepared();
      }
    },
    [markPrepared]
  );

  // Fallback de segurança para ambientes onde onLayout não dispara (mocks de teste, headless)
  useEffect(() => {
    const timer = setTimeout(() => {
      markPrepared();
    }, preparationTimeoutMs);
    return () => clearTimeout(timer);
  }, [markPrepared, preparationTimeoutMs]);

  // 3. Execução da fase de entrada (fade-in + zoom suave)
  // Inicia rigorosamente após a preparação da camada React Native
  useEffect(() => {
    if (!isPrepared) {
      return;
    }

    let animation = null;

    if (isReducedMotion) {
      logoScale.setValue(1);
      animation = Animated.timing(logoOpacity, {
        toValue: 1,
        duration: Math.min(animationDurationMs, 200),
        useNativeDriver: true,
      });
    } else {
      logoScale.setValue(ANIMATION_DEFAULTS.SCALE_START);
      animation = Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: animationDurationMs,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: ANIMATION_DEFAULTS.SCALE_END,
          duration: animationDurationMs,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);
    }

    animation.start(() => {
      setIntroFinished(true);
    });

    return () => {
      if (animation && typeof animation.stop === 'function') {
        animation.stop();
      }
    };
  }, [animationDurationMs, isPrepared, isReducedMotion, logoOpacity, logoScale]);

  // 4. Fase de permanência estável da logo (1.500 ms)
  useEffect(() => {
    if (!introFinished) {
      return;
    }

    const holdTimer = setTimeout(() => {
      setHoldFinished(true);
    }, holdDurationMs);

    return () => clearTimeout(holdTimer);
  }, [holdDurationMs, introFinished]);

  // 5. Função de encerramento com fade-out suave (300 ms) e notificação de início
  const dismissSplash = useCallback(() => {
    if (isDismissingRef.current) {
      return;
    }
    isDismissingRef.current = true;

    // Notifica o início da saída para sincronizar a revelação gradual do conteúdo principal
    if (typeof onDismissStart === 'function') {
      onDismissStart();
    }

    Animated.timing(containerOpacity, {
      toValue: 0,
      duration: fadeDurationMs,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      markSplashCompleted();
      if (typeof onDismiss === 'function') {
        onDismiss();
      }
    });
  }, [containerOpacity, fadeDurationMs, onDismiss, onDismissStart]);

  // 6. Transição após tempo mínimo e prontidão da aplicação
  useEffect(() => {
    if (!introFinished || !holdFinished) {
      return;
    }

    if (isReady) {
      dismissSplash();
      return;
    }

    // Se o tempo mínimo (2,2s) expirou mas o backend/auth ainda não respondeu,
    // aguarda até maxWaitMs para não congelar indefinidamente a tela.
    const waitTimer = setTimeout(() => {
      dismissSplash();
    }, maxWaitMs);

    return () => clearTimeout(waitTimer);
  }, [dismissSplash, holdFinished, introFinished, isReady, maxWaitMs]);

  // 7. Timeout de segurança absoluto contra Splash presa
  useEffect(() => {
    const safetyTimer = setTimeout(() => {
      dismissSplash();
    }, safetyTimeoutMs);

    return () => clearTimeout(safetyTimer);
  }, [dismissSplash, safetyTimeoutMs]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: containerOpacity,
        },
      ]}
      onLayout={handleLayout}
      testID="animated-splash-screen"
      pointerEvents="box-none"
    >
      <Animated.View
        style={[
          styles.logoWrapper,
          {
            opacity: logoOpacity,
            transform: [{ scale: logoScale }],
          },
        ]}
      >
        {imageSource && (
          <Image
            source={imageSource}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="ArenaGO"
            accessibilityRole="image"
          />
        )}
      </Animated.View>
    </Animated.View>
  );
}

export const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    backgroundColor: colors.background.canvas,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999999,
    elevation: 999999,
  },
  logoWrapper: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    width: '72%',
    maxWidth: 320,
    aspectRatio: 1024 / 341, // Proporção oficial da logo horizontal
  },
});
