import { useContext, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import ScreenContainer from '../../components/ScreenContainer';
import { AuthContext } from '../../context/AuthContext';
import { fetchParticipationEvaluation, validateHistoryItem } from '../../services/participationHistoryService';
import { formatStayDuration } from '../../utils/participation';

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
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
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
    return <ScreenContainer><Text style={styles.notice}>
      Os detalhes não estão disponíveis nesta navegação. Volte à aba Eventos e selecione a participação.
    </Text></ScreenContainer>;
  }

  const evaluation = evaluationState.evaluation;
  const entry = item.arenaEnteredAt ?? item.joinedAt;

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{item.event.name}</Text>
        <Text style={styles.note}>Dados reais da sua participação. Horários no fuso do dispositivo.</Text>
        <Text style={styles.section}>Participação</Text>
        <DetailRow label="Situação" value={item.status} />
        <DetailRow label="Ingresso" value={dateText(item.joinedAt)} />
        <DetailRow label="Entrada na Arena" value={dateText(item.arenaEnteredAt)} />
        <DetailRow label="Saída" value={dateText(item.finishedAt)} />
        <DetailRow label="Permanência" value={durationText(entry, item.finishedAt)} />
        <DetailRow label="Atendimentos concluídos" value={String(item.completedServicesCount)} />
        {item.finishReason ? <DetailRow label="Motivo da saída" value={item.finishReason} /> : null}
        <Text style={styles.section}>Avaliação</Text>
        {submitted ? (
          evaluationState.loading ? <Text>Carregando avaliação...</Text>
          : evaluationState.error ? <Text style={styles.error}>{evaluationState.error}</Text>
          : evaluation ? (
            <>
              <DetailRow label="Nota" value={`${evaluation.rating} de 5 estrelas`} />
              {evaluation.comment ? <Text style={styles.comment}>{evaluation.comment}</Text> : null}
            </>
          ) : <Text style={styles.notice}>Avaliação indisponível.</Text>
        ) : item.evaluation.pending ? (
          <>
            <Text style={styles.notice}>Sua avaliação está pendente.</Text>
            <Pressable style={styles.button} accessibilityRole="button"
              onPress={() => navigation.navigate('RealEvaluation', { participationId, historyItem: item })}>
              <Text style={styles.buttonText}>Avaliar evento</Text>
            </Pressable>
          </>
        ) : <Text style={styles.notice}>Nenhuma avaliação pendente para esta participação.</Text>}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 24 },
  title: { fontSize: 24, fontWeight: 'bold', marginTop: 16 },
  note: { marginTop: 8, color: '#666', fontSize: 13 },
  section: { marginTop: 24, marginBottom: 10, fontWeight: 'bold', fontSize: 17 },
  row: { paddingVertical: 8, borderBottomColor: '#ddd', borderBottomWidth: 1 },
  label: { fontSize: 13, color: '#666' },
  value: { marginTop: 3, fontWeight: '600', fontSize: 15 },
  notice: { marginTop: 18, fontSize: 15, color: '#555' },
  error: { marginTop: 18, fontSize: 15, color: '#9b1c1c' },
  comment: { marginTop: 10, fontSize: 15 },
  button: { marginTop: 18, padding: 12, backgroundColor: '#111', borderRadius: 6, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
});
