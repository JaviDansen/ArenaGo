import { useContext, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthBackground, Badge, Button, Card } from '../../components/ui';
import { AuthContext } from '../../context/AuthContext';
import { fetchParticipationEvaluation, validateHistoryItem } from '../../services/participationHistoryService';
import { formatStayDuration } from '../../utils/participation';
import { colors, spacing, typography } from '../../theme';

function dateText(value) {
  if (!value) return 'Não registrado';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Registro inválido';
  return new Date(timestamp).toLocaleString('pt-BR');
}

function durationText(start, end) {
  if (!start || !end) return 'Não registrado';
  const startMs = Date.parse(start), endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 'Não registrado';
  return formatStayDuration(Math.round((endMs - startMs) / 60000)) ?? 'Menos de 1 minuto';
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
        <View style={styles.messageScreen}>
          <Card variant="elevated">
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
  const statusLabel = item.status === 'finished'
    ? 'PARTICIPAÇÃO FINALIZADA'
    : item.status === 'active'
      ? 'PARTICIPAÇÃO ATIVA'
      : 'PARTICIPAÇÃO NA FILA';
  const statusVariant = item.status === 'finished' ? 'success' : item.status === 'active' ? 'brand' : 'warning';

  return (
    <AuthBackground variant="login" overlayOpacity={0.68} testID="participation-details-background">
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Badge label={statusLabel} variant={statusVariant} />
        <Text style={styles.title}>{item.event.name}</Text>
        <Text style={styles.note}>Dados reais da sua participação. Horários no fuso do dispositivo.</Text>
        <Text style={styles.section}>Participação</Text>
        <Card variant="default" style={styles.detailCard}>
          <DetailRow label="Situação" value={item.status} />
          <DetailRow label="Ingresso" value={dateText(item.joinedAt)} />
          <DetailRow label="Entrada na Arena" value={dateText(item.arenaEnteredAt)} />
          <DetailRow label="Saída" value={dateText(item.finishedAt)} />
          <DetailRow label="Permanência" value={durationText(entry, item.finishedAt)} />
          <DetailRow label="Atendimentos concluídos" value={String(item.completedServicesCount)} />
          {item.finishReason ? <DetailRow label="Motivo da saída" value={item.finishReason} /> : null}
        </Card>
        <Text style={styles.section}>Avaliação</Text>
        <Card variant="elevated" style={styles.detailCard}>
          {submitted ? (
            evaluationState.loading ? <Text style={styles.notice}>Carregando avaliação...</Text>
            : evaluationState.error ? <Text style={styles.error}>{evaluationState.error}</Text>
            : evaluation ? (
              <>
                <DetailRow label="Nota" value={`${evaluation.rating} de 5 estrelas`} />
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
  content: { flexGrow: 1, paddingHorizontal: spacing.layout.screenPaddingHorizontal, paddingTop: spacing.lg, paddingBottom: spacing.xxxl },
  title: { ...typography.titleLarge, color: colors.text.primary, marginTop: spacing.md },
  note: { ...typography.bodySmall, color: colors.text.secondary, marginTop: spacing.sm },
  section: { ...typography.titleSmall, color: colors.text.primary, marginTop: spacing.xxl, marginBottom: spacing.sm },
  detailCard: { alignItems: 'stretch' },
  row: { borderBottomColor: colors.border.subtle, borderBottomWidth: 1, paddingVertical: spacing.md },
  label: { ...typography.caption, color: colors.text.muted },
  value: { ...typography.body, color: colors.text.primary, fontWeight: '600', marginTop: spacing.xxs },
  notice: { ...typography.body, color: colors.text.secondary, marginTop: spacing.md },
  error: { ...typography.body, color: '#FF9AAE', marginTop: spacing.md },
  comment: { ...typography.body, color: colors.text.secondary, marginTop: spacing.md },
  actionButton: { marginTop: spacing.lg },
});
