import { useCallback, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import AnimatedSplashScreen, { ANIMATION_DEFAULTS } from './AnimatedSplashScreen';
import { isSplashCompleted } from '../../services/splashScreenService';
import { colors } from '../../theme';

export default function SplashScreenGate({
  children,
  isReady = true,
  forceShow = false,
  onAnimationFinish,
  animationDurationMs = ANIMATION_DEFAULTS.INTRO_DURATION_MS,
  holdDurationMs = ANIMATION_DEFAULTS.HOLD_DURATION_MS,
  fadeDurationMs = ANIMATION_DEFAULTS.FADE_DURATION_MS,
  maxWaitMs = ANIMATION_DEFAULTS.MAX_WAIT_MS,
  safetyTimeoutMs = ANIMATION_DEFAULTS.SAFETY_TIMEOUT_MS,
  preparationTimeoutMs = ANIMATION_DEFAULTS.PREPARATION_TIMEOUT_MS,
  imageSource,
  reduceMotion,
  splashModule,
}) {
  const [isSplashVisible, setIsSplashVisible] = useState(
    () => forceShow || !isSplashCompleted()
  );
  const [isDismissing, setIsDismissing] = useState(false);

  // appOpacity: 0 enquanto a Splash está ativa; 1 se a Splash já foi concluída
  const appOpacity = useRef(
    new Animated.Value(forceShow || !isSplashCompleted() ? 0 : 1)
  ).current;

  // Notificado no exato momento em que a Splash inicia o fade-out de saída
  // Executa a revelação gradual e síncrona do conteúdo principal (cross-fade)
  const handleDismissStart = useCallback(() => {
    setIsDismissing(true);
    Animated.timing(appOpacity, {
      toValue: 1,
      duration: fadeDurationMs,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [appOpacity, fadeDurationMs]);

  // Notificado quando o fade-out termina (ao final dos 2.500 ms)
  const handleDismiss = useCallback(() => {
    setIsSplashVisible(false);
    setIsDismissing(false);
    appOpacity.setValue(1);
    if (typeof onAnimationFinish === 'function') {
      onAnimationFinish();
    }
  }, [appOpacity, onAnimationFinish]);

  return (
    <View style={styles.rootContainer} testID="splash-screen-gate-root">
      <Animated.View
        style={[
          styles.appContainer,
          { opacity: appOpacity },
        ]}
        pointerEvents={isSplashVisible ? 'none' : 'auto'}
        accessibilityElementsHidden={isSplashVisible && !isDismissing}
        importantForAccessibility={
          isSplashVisible && !isDismissing ? 'no-hide-descendants' : 'auto'
        }
      >
        {children}
      </Animated.View>

      {isSplashVisible && (
        <View style={styles.splashOverlayContainer} pointerEvents="none">
          <AnimatedSplashScreen
            isReady={isReady}
            onDismissStart={handleDismissStart}
            onDismiss={handleDismiss}
            animationDurationMs={animationDurationMs}
            holdDurationMs={holdDurationMs}
            fadeDurationMs={fadeDurationMs}
            maxWaitMs={maxWaitMs}
            safetyTimeoutMs={safetyTimeoutMs}
            preparationTimeoutMs={preparationTimeoutMs}
            imageSource={imageSource}
            reduceMotion={reduceMotion}
            splashModule={splashModule}
          />
        </View>
      )}
    </View>
  );
}

export const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    position: 'relative',
    backgroundColor: colors.background.canvas,
  },
  appContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  appContainerHidden: {
    opacity: 0,
  },
  splashOverlayContainer: {
    ...StyleSheet.absoluteFillObject,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    zIndex: 999999,
    elevation: 999999,
    backgroundColor: 'transparent',
  },
});
