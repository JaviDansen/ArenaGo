import { useEffect, useRef, useState } from 'react';
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

function loadSplashIcon() {
  try {
    // eslint-disable-next-line global-require
    return require('../../assets/splash-icon.png');
  } catch {
    return null;
  }
}

const defaultSplashIcon = loadSplashIcon();

export const ANIMATION_DEFAULTS = {
  INTRO_DURATION_MS: 700,
  FADE_DURATION_MS: 250,
  MAX_WAIT_MS: 1500,
  SAFETY_TIMEOUT_MS: 2500,
  SCALE_START: 0.9,
  SCALE_END: 1.0,
};

export default function AnimatedSplashScreen({
  isReady = true,
  onDismiss,
  animationDurationMs = ANIMATION_DEFAULTS.INTRO_DURATION_MS,
  fadeDurationMs = ANIMATION_DEFAULTS.FADE_DURATION_MS,
  maxWaitMs = ANIMATION_DEFAULTS.MAX_WAIT_MS,
  safetyTimeoutMs = ANIMATION_DEFAULTS.SAFETY_TIMEOUT_MS,
  imageSource = defaultSplashIcon,
  reduceMotion = undefined,
  splashModule = undefined,
}) {
  const [isReducedMotion, setIsReducedMotion] = useState(Boolean(reduceMotion));
  const [introFinished, setIntroFinished] = useState(false);
  const isDismissingRef = useRef(false);

  const containerOpacity = useRef(new Animated.Value(1)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(ANIMATION_DEFAULTS.SCALE_START)).current;

  // 1. Detectar preferência de movimento reduzido
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
          // Mantém o estado padrão se a API nativa não estiver disponível
        });
    }
    return () => {
      mounted = false;
    };
  }, [reduceMotion]);

  // 2. Executar ocultação da Splash nativa e animação de abertura
  useEffect(() => {
    // Oculta a Splash nativa assim que o componente React Native é montado
    void hideNativeSplashAsync(splashModule);

    let animation = null;

    if (isReducedMotion) {
      // Movimento reduzido: sem zoom/escala, transição rápida de opacidade
      logoScale.setValue(1);
      animation = Animated.timing(logoOpacity, {
        toValue: 1,
        duration: Math.min(fadeDurationMs, 150),
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
  }, [animationDurationMs, fadeDurationMs, isReducedMotion, splashModule]);

  // 3. Função para encerrar a Splash com fade-out suave
  const dismissSplash = () => {
    if (isDismissingRef.current) {
      return;
    }
    isDismissingRef.current = true;

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
  };

  // 4. Transição quando a introdução terminar e a interface estiver pronta
  useEffect(() => {
    if (!introFinished) {
      return;
    }

    if (isReady) {
      dismissSplash();
      return;
    }

    // Se a interface ainda não estiver pronta (ex.: rede lenta na restauração da sessão),
    // aguarda até maxWaitMs para não congelar indefinidamente a tela.
    const waitTimer = setTimeout(() => {
      dismissSplash();
    }, maxWaitMs);

    return () => {
      clearTimeout(waitTimer);
    };
  }, [introFinished, isReady, maxWaitMs]);

  // 5. Timeout de segurança absoluto contra Splash infinita
  useEffect(() => {
    const safetyTimer = setTimeout(() => {
      dismissSplash();
    }, safetyTimeoutMs);

    return () => {
      clearTimeout(safetyTimer);
    };
  }, [safetyTimeoutMs]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: containerOpacity,
        },
      ]}
      testID="animated-splash-screen"
      pointerEvents="none"
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
        <Image
          source={imageSource}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="ArenaGO"
          accessibilityRole="image"
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background.canvas,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  logoWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 280,
    height: 280,
  },
});
