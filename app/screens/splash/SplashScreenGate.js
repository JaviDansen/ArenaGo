import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
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
  imageSource,
  reduceMotion,
  splashModule,
}) {
  const [isSplashVisible, setIsSplashVisible] = useState(
    () => forceShow || !isSplashCompleted()
  );

  const handleDismiss = useCallback(() => {
    setIsSplashVisible(false);
    if (typeof onAnimationFinish === 'function') {
      onAnimationFinish();
    }
  }, [onAnimationFinish]);

  return (
    <View style={styles.rootContainer} testID="splash-screen-gate-root">
      <View
        style={[
          styles.appContainer,
          isSplashVisible && styles.appContainerHidden,
        ]}
        pointerEvents={isSplashVisible ? 'none' : 'auto'}
        accessibilityElementsHidden={isSplashVisible}
        importantForAccessibility={isSplashVisible ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>

      {isSplashVisible && (
        <View style={styles.splashOverlayContainer} pointerEvents="auto">
          <AnimatedSplashScreen
            isReady={isReady}
            onDismiss={handleDismiss}
            animationDurationMs={animationDurationMs}
            holdDurationMs={holdDurationMs}
            fadeDurationMs={fadeDurationMs}
            maxWaitMs={maxWaitMs}
            safetyTimeoutMs={safetyTimeoutMs}
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
    backgroundColor: colors.background.canvas,
  },
});
