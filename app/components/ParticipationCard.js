import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../theme';
import { EVALUATION_SITUATIONS } from '../utils/evaluation';
import {
  formatParticipationDate,
  formatStayDuration,
  getStayDurationInMinutes,
} from '../utils/participation';

// Indicação exibida no card somente quando a situação da avaliação é conhecida.
const EVALUATION_LABELS = {
  [EVALUATION_SITUATIONS.PENDING]: 'Avaliação pendente',
  [EVALUATION_SITUATIONS.EVALUATED]: 'Avaliada',
  [EVALUATION_SITUATIONS.EXPIRED]: 'Prazo de avaliação encerrado',
  [EVALUATION_SITUATIONS.NOT_FINISHED]: 'Em andamento · avaliação indisponível',
};

const EVALUATION_COLORS = {
  [EVALUATION_SITUATIONS.PENDING]: { text: colors.semantic.warning, bg: colors.semantic.warningBg, border: colors.semantic.warning },
  [EVALUATION_SITUATIONS.EVALUATED]: { text: colors.semantic.success, bg: colors.semantic.successBg, border: colors.semantic.success },
  [EVALUATION_SITUATIONS.EXPIRED]: { text: colors.text.secondary, bg: colors.background.elevated, border: colors.border.subtle },
  [EVALUATION_SITUATIONS.NOT_FINISHED]: { text: colors.semantic.info, bg: colors.semantic.infoBg, border: colors.semantic.info },
};

/** Item visual da lista. Todas as informações vêm do histórico real do servidor. */
export default function ParticipationCard({ participation, onPress, evaluationSituation }) {
  if (!participation || !Object.prototype.hasOwnProperty.call(participation, 'id')
    || typeof participation.id !== 'string' || participation.id.trim() === '') {
    return null;
  }

  const date = formatParticipationDate(participation.enteredAt);
  const stayDuration = formatStayDuration(getStayDurationInMinutes(participation));
  const eventName = typeof participation.event?.name === 'string' && participation.event.name.trim() !== ''
    ? participation.event.name
    : 'Evento indisponível';
  const evaluationLabel = Object.prototype.hasOwnProperty.call(EVALUATION_LABELS, evaluationSituation)
    ? EVALUATION_LABELS[evaluationSituation]
    : null;
  const evaluationColor = EVALUATION_COLORS[evaluationSituation];

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && onPress && styles.cardPressed]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${eventName}${date ? `, ${date}` : ''}`}
      accessibilityState={{ disabled: !onPress }}
    >
      <View style={styles.headingRow}>
        <Text style={styles.eventName}>{eventName}</Text>
        {evaluationLabel ? (
          <View style={[styles.badge, { backgroundColor: evaluationColor.bg, borderColor: evaluationColor.border }]}>
            <Text style={[styles.badgeText, { color: evaluationColor.text }]}>{evaluationLabel}</Text>
          </View>
        ) : null}
      </View>
      {date ? <Text style={styles.info}>{date}</Text> : null}
      {stayDuration ? (
        <Text style={styles.info}>Permanência: {stayDuration}</Text>
      ) : (
        // Sem saída registrada não há permanência válida: não estimamos um valor.
        <Text style={styles.infoMuted}>Permanência não registrada</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background.surface,
    borderColor: colors.border.subtle,
    borderRadius: radii.xl,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.layout.cardPadding,
  },
  cardPressed: {
    opacity: 0.82,
    borderColor: colors.brand.primaryLight,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  eventName: {
    ...typography.titleSmall,
    color: colors.text.primary,
    flex: 1,
  },
  badge: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    maxWidth: '52%',
  },
  badgeText: {
    ...typography.micro,
    fontWeight: '700',
  },
  info: {
    ...typography.bodySmall,
    color: colors.text.secondary,
    marginTop: spacing.sm,
  },
  infoMuted: {
    ...typography.bodySmall,
    color: colors.text.muted,
    marginTop: spacing.sm,
  },
});
