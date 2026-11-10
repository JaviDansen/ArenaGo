import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import AnimatedSplashScreen from './AnimatedSplashScreen';
import { isSplashCompleted } from '../../services/splashScreenService';

export default function SplashScreenGate({
  children,
  isReady = true,
  forceShow = false,
  onAnimationFinish,
  animationDurationMs,
  fadeDurationMs,
  maxWaitMs,
  safetyTimeoutMs,
  imageSource,
  reduceMotion,
  splashModule,
}) {
  const [visible, setVisible] = useState(() => forceShow || !isSplashCompleted());

  if (!visible) {
    return children;
  }

  return (
    <View style={styles.gateContainer}>
      {children}
      <AnimatedSplashScreen
        isReady={isReady}
        onDismiss={() => {
          setVisible(false);
          if (typeof onAnimationFinish === 'function') {
            onAnimationFinish();
          }
        }}
        animationDurationMs={animationDurationMs}
        fadeDurationMs={fadeDurationMs}
        maxWaitMs={maxWaitMs}
        safetyTimeoutMs={safetyTimeoutMs}
        imageSource={imageSource}
        reduceMotion={reduceMotion}
        splashModule={splashModule}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gateContainer: {
    flex: 1,
  },
});
