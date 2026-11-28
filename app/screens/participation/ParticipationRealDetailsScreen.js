import { useContext, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthBackground, Badge, Button, Card, LineIcon, ScreenHeader } from '../../components/ui';
import { AuthContext } from '../../context/AuthContext';
import { fetchParticipationEvaluation, validateHistoryItem } from '../../services/participationHistoryService';
import { formatStayDuration } from '../../utils/participation';
import { colors, spacing, typography } from '../../theme';

export function dateText(value) {
  if (!value) return 'Não registrado';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Registro inválido';
  const date = new Date(timestamp);
  return `${date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })} • ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function durationText(start, end) {
  if (!start || !end) return 'Não registrado';
  const startMs = Date.parse(start), endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 'Não registrado';
  return formatStayDuration(Math.round((endMs - startMs) / 60000)) ?? 'Menos de 1 minuto';
}

const STATUS_LABELS = {
  finished: 'Finalizada', active: 'Ativa', waiting: 'Aguardando', canceled: 'Cancelada',
};
const FINISH_REASON_LABELS = {
  voluntary: 'Saída voluntária',
  external_wait_withdrawal: 'Desistência da espera de entrada',
  staff_external_wait_removed: 'Retirada da espera pelo Staff',
  external_absence_after_entry_cutoff: 'Ausência após o limite de entrada',
  admin_immediate: 'Encerramento imediato do evento',
  admin_controlled_external_wait_closed: 'Encerramento da espera de entrada pelo evento',
  automatic_operational_deadline: 'Fim do prazo operacional do evento',
  automatic_admin_deadline: 'Fim do prazo de encerramento do evento',
};
export const participationStatusText = value => Object.prototype.hasOwnProperty.call(STATUS_LABELS, value) ? STATUS_LABELS[value] : 'Não informada';
export const finishReasonText = value => Object.prototype.hasOwnProperty.call(FINISH_REASON_LABELS, value) ? FINISH_REASON_LABELS[value] : 'Motivo não informado';

function SummaryCard({ icon, value, label }) {
  return (
    <Card variant="elevated" padding={spacing.md} style={styles.summaryCard}>
      <View style={styles.summaryIcon}>
        <LineIcon name={icon} size={20} color={colors.brand.primaryLight} />
      </View>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </Card>
  );
}

function DetailRow({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export default function ParticipationRealDetailsScreen({ route, navigation }) {
  const auth = useContext(AuthContext);
  const client = auth?.httpClient;
  const userId = auth?.isAuthenticated ? auth?.user?.id : null;
  const epoch = auth?.getSessionEpoch?.() ?? null;
  const item = route?.params?.historyItem;
  const participationId = route?.params?.participationId;
  const valid = validateHistoryItem(item) && item.participationId === participationId;
  const submitted = valid && item.evaluation.submitted;
  const [evaluationState, setEvaluationState] = useState({ loading: false, evaluation: null, error: null });

  useEffect(() => {
    let current = true;
    if (!submitted || !client || !userId) {
      setEvaluationState({ loading: false, evaluation: null, error: null });
      return () => { current = false; };
    }
    setEvaluationState({ loading: true, evaluation: null, error: null });
    fetchParticipationEvaluation(client, participationId).then(evaluation => {
      if (current) setEvaluationState({ loading: false, evaluation, error: null });
    }).catch(() => {
      if (current) setEvaluationState({ loading: false, evaluation: null,
        error: 'Não foi possível carregar a avaliação registrada.' });
    });
    return () => { current = false; };
  }, [client, userId, epoch, participationId, submitted]);

  if (!valid) {
    return (
      <AuthBackground variant="login" overlayOpacity={0.68} testID="participation-details-background">
        <StatusBar style="light" />
        <ScreenHeader title="Detalhes da participação" onBack={() => navigation.goBack()} testID="participation-details-header" />
        <View style={styles.messageScreen}>
          <Card variant="elevated" style={styles.unavailableCard}>
            <Badge label="DETALHES INDISPONÍVEIS" variant="warning" />
            <Text style={styles.notice}>
              Os detalhes não estão disponíveis nesta navegação. Volte à aba Eventos e selecione a participação.
            </Text>
          </Card>
        </View>
      </AuthBackground>
    );
  }

  const evaluation = evaluationState.evaluation;
  const entry = item.arenaEnteredAt ?? item.joinedAt;
  const statusLabel = `PARTICIPAÇÃO ${participationStatusText(item.status).toLocaleUpperCase('pt-BR')}`;
  const statusVariant = item.status === 'finished' || item.status === 'active' ? 'success' : item.status === 'canceled' ? 'default' : 'warning';

  return (
    <AuthBackground variant="login" overlayOpacity={0.68} testID="participation-details-background">
      <StatusBar style="light" />
      <ScreenHeader title="Detalhes da participação" onBack={() => navigation.goBack()} testID="participation-details-header" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Badge label={statusLabel} variant={statusVariant} style={item.status === 'canceled' ? styles.neutralBadge : undefined} />
        <Text style={styles.title}>{item.event.name}</Text>
        <Text style={styles.note}>Data da participação: {dateText(item.joinedAt)}</Text>
        <View style={styles.summary} testID="participation-summary">
          <SummaryCard icon="clock" value={durationText(entry, item.finishedAt)} label="Permanência" />
          <SummaryCard icon="check" value={String(item.completedServicesCount)} label="Atendimentos concluídos" />
        </View>
        <Card variant="default" padding={spacing.md} style={styles.detailCard}>
          <Text style={styles.section} accessibilityRole="header">Informações da participação</Text>
          <DetailRow label="Ingresso" value={dateText(item.joinedAt)} />
          <DetailRow label="Entrada na Arena" value={dateText(item.arenaEnteredAt)} />
          <DetailRow label="Saída" value={dateText(item.finishedAt)} />
          {item.finishReason ? <DetailRow label="Motivo da saída" value={finishReasonText(item.finishReason)} /> : null}
          <Text style={styles.timezone}>Horários no fuso do dispositivo.</Text>
        </Card>
        <Card variant="elevated" padding={spacing.md} style={[styles.detailCard, styles.evaluationCard]}>
          <Text style={styles.section} accessibilityRole="header">Sua avaliação</Text>
          {submitted ? (
            evaluationState.loading ? <Text style={styles.notice}>Carregando avaliação...</Text>
            : evaluationState.error ? <Text style={styles.error}>{evaluationState.error}</Text>
            : evaluation ? (
              <>
                <View style={styles.ratingRow} accessible accessibilityLabel={`${evaluation.rating} de 5 estrelas`} testID="participation-rating">
                  {[1, 2, 3, 4, 5].map(star => (
                    <Text key={star} style={[styles.star, star <= evaluation.rating && styles.starFilled]}
                      accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
                      testID={`participation-star-${star}-${star <= evaluation.rating ? 'filled' : 'empty'}`}>
                      {star <= evaluation.rating ? '★' : '☆'}
                    </Text>
                  ))}
                </View>
                <Text style={styles.ratingValue}>{evaluation.rating} de 5 estrelas</Text>
                <Text style={styles.note}>Avaliação registrada</Text>
                {evaluation.comment ? <Text style={styles.comment}>{evaluation.comment}</Text> : null}
              </>
            ) : <Text style={styles.notice}>Avaliação indisponível.</Text>
          ) : item.evaluation.pending ? (
            <>
              <Badge label="AVALIAÇÃO PENDENTE" variant="warning" />
              <Text style={styles.notice}>Sua avaliação está pendente.</Text>
              <Button style={styles.actionButton} title="Avaliar evento" variant="primary" accessibilityLabel="Avaliar este evento"
                onPress={() => navigation.navigate('RealEvaluation', { participationId, historyItem: item })} />
            </>
          ) : <Text style={styles.notice}>Nenhuma avaliação pendente para esta participação.</Text>}
        </Card>
      </ScrollView>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  messageScreen: { flex: 1, justifyContent: 'center', padding: spacing.layout.screenPaddingHorizontal },
  content: { flexGrow: 1, paddingHorizontal: spacing.layout.screenPaddingHorizontal, paddingTop: spacing.xs, paddingBottom: spacing.xxxl },
  title: { ...typography.titleLarge, color: colors.text.primary, marginTop: spacing.sm },
  note: { ...typography.bodySmall, color: colors.text.secondary, marginTop: spacing.sm },
  section: { ...typography.titleSmall, color: colors.text.primary, marginBottom: spacing.xs },
  detailCard: { alignItems: 'stretch', marginTop: spacing.md, backgroundColor: colors.background.base, borderColor: `${colors.brand.primaryLight}40` },
  unavailableCard: { backgroundColor: colors.background.base, borderColor: colors.semantic.warning },
  evaluationCard: { borderColor: colors.brand.primary },
  neutralBadge: { backgroundColor: colors.background.base },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: spacing.xs, paddingVertical: spacing.sm },
  label: { ...typography.caption, color: colors.text.muted },
  value: { ...typography.body, color: colors.text.primary, fontWeight: '600', flexGrow: 1, flexShrink: 1, flexBasis: 170, textAlign: 'right' },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  summaryCard: { flexGrow: 1, flexShrink: 1, flexBasis: 140, alignItems: 'flex-start', backgroundColor: colors.background.base, borderColor: `${colors.brand.primaryLight}40` },
  summaryIcon: { padding: spacing.sm, borderRadius: spacing.sm, backgroundColor: colors.brand.primaryDim },
  summaryValue: { ...typography.titleMedium, color: colors.brand.primaryLight, marginTop: spacing.sm },
  summaryLabel: { ...typography.bodySmall, color: colors.text.secondary, marginTop: spacing.xs },
  timezone: { ...typography.caption, color: colors.text.muted, marginTop: spacing.xs },
  ratingRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  star: { color: colors.text.muted, fontSize: 30, lineHeight: 36 },
  starFilled: { color: colors.semantic.warning },
  ratingValue: { ...typography.titleSmall, color: colors.text.primary, marginTop: spacing.sm },
  notice: { ...typography.body, color: colors.text.secondary, marginTop: spacing.md },
  error: { ...typography.body, color: '#FF9AAE', marginTop: spacing.md },
  comment: { ...typography.body, color: colors.text.secondary, marginTop: spacing.md },
  actionButton: { marginTop: spacing.lg },
});
