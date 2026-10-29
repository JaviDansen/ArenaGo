/**
 * ArenaGo Design System — StepperIndicator Component
 * Cabeçalho e indicador de progresso em etapas (utilizado no Questionário de Perfil)
 */

import { StyleSheet, Text, View } from 'react-native';
import colors from '../../theme/colors.js';
import radii from '../../theme/radii.js';
import spacing from '../../theme/spacing.js';
import typography from '../../theme/typography.js';

export function StepperIndicator({
  totalSteps = 3,
  currentStep = 1,
  stepTag,
  title,
  subtitle,
  style,
}) {
  const normalizedStep = Math.max(1, Math.min(currentStep, totalSteps));
  const tagText = stepTag || `ETAPA ${normalizedStep} DE ${totalSteps}`;

  return (
    <View style={[styles.container, style]}>
      {/* Barras de progresso segmentadas */}
      <View style={styles.barsRow}>
        {Array.from({ length: totalSteps }, (_, index) => {
          const stepNumber = index + 1;
          const isActive = stepNumber <= normalizedStep;
          return (
            <View
              key={stepNumber}
              style={[
                styles.segmentBar,
                isActive ? styles.segmentBarActive : styles.segmentBarInactive,
              ]}
            />
          );
        })}
      </View>

      {/* Rótulo de identificação da etapa */}
      <Text style={styles.tag}>{tagText}</Text>

      {/* Título da etapa */}
      {title && <Text style={styles.title}>{title}</Text>}

      {/* Subtítulo explicativo */}
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: spacing.xl,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  segmentBar: {
    flex: 1,
    height: 4,
    borderRadius: radii.full,
  },
  segmentBarActive: {
    backgroundColor: colors.brand.primary,
  },
  segmentBarInactive: {
    backgroundColor: colors.border.subtle,
  },
  tag: {
    ...typography.tag,
    color: colors.brand.primaryLight,
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.titleLarge,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.text.secondary,
  },
});

export default StepperIndicator;
