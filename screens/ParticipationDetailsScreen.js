import { ScrollView, StyleSheet, Text, View } from 'react-native';

import ScreenContainer from '../components/ScreenContainer';
import { mockEvaluations, mockParticipations } from '../data/mockData';
import {
  EVALUATION_SITUATIONS,
  findEvaluationByParticipationId,
  getEvaluationSituation,
} from '../utils/evaluation';
import {
  findParticipationById,
  formatParticipationDate,
  formatStayDuration,
  getExperienceOccurrences,
  getParticipationTimes,
} from '../utils/participation';

// Texto exibido quando um horário não foi registrado ou o registro é inválido.
const TIME_STATUS_LABELS = {
  missing: 'Não registrada',
  invalid: 'Registro inválido',
};

function DetailRow({ label, value, muted }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={muted ? styles.valueMuted : styles.value}>{value}</Text>
    </View>
  );
}

// Mensagem da seção Avaliação para cada situação informada nos dados.
const EVALUATION_MESSAGES = {
  [EVALUATION_SITUATIONS.PENDING]: 'Esta participação ainda não foi avaliada.',
  [EVALUATION_SITUATIONS.EXPIRED]: 'O prazo para a primeira avaliação desta participação terminou.',
  [EVALUATION_SITUATIONS.NOT_FINISHED]: 'A participação ainda não foi finalizada. Não há avaliação disponível.',
  [EVALUATION_SITUATIONS.NOT_ELIGIBLE]: 'Esta participação não possui avaliação disponível.',
  [EVALUATION_SITUATIONS.INVALID]: 'Não foi possível exibir a avaliação desta participação.',
};

function EvaluationSection({ situation, evaluation }) {
  // Sem informação de avaliação nos dados, a seção não é exibida: não se
  // presume elegibilidade, prazo ou estado.
  if (situation === EVALUATION_SITUATIONS.UNAVAILABLE) {
    return null;
  }

  if (situation === EVALUATION_SITUATIONS.EVALUATED && evaluation) {
    return (
      <>
        <Text style={styles.sectionTitle}>Avaliação</Text>
        <DetailRow label="Nota" value={`${evaluation.rating} de 5`} />
        {evaluation.comment ? (
          <>
            <Text style={styles.commentLabel}>Comentário</Text>
            <Text style={styles.comment}>{evaluation.comment}</Text>
          </>
        ) : null}
      </>
    );
  }

  // Avaliada sem um registro válido de nota: não se exibe nota inventada.
  const key = situation === EVALUATION_SITUATIONS.EVALUATED ? EVALUATION_SITUATIONS.INVALID : situation;
  const message = situation === EVALUATION_SITUATIONS.EVALUATED
    ? 'Esta participação foi avaliada, mas os detalhes da avaliação estão indisponíveis.'
    : Object.prototype.hasOwnProperty.call(EVALUATION_MESSAGES, key) ? EVALUATION_MESSAGES[key] : null;

  return message ? (
    <>
      <Text style={styles.sectionTitle}>Avaliação</Text>
      <Text style={styles.infoMuted}>{message}</Text>
    </>
  ) : null;
}

function TimeRow({ label, registeredTime }) {
  return (
    <DetailRow
      label={label}
      value={registeredTime.time ?? TIME_STATUS_LABELS[registeredTime.status]}
      muted={!registeredTime.time}
    />
  );
}

export default function ParticipationDetailsScreen({ route }) {
  // Dados mockados enquanto não há integração com backend.
  const participation = findParticipationById(mockParticipations, route?.params?.participationId);

  if (!participation) {
    return (
      <ScreenContainer>
        <Text style={styles.message}>Participação não encontrada.</Text>
      </ScreenContainer>
    );
  }

  const date = formatParticipationDate(participation.enteredAt);
  const { entry, exit, stayDurationInMinutes } = getParticipationTimes(participation);
  const stayDuration = formatStayDuration(stayDurationInMinutes);
  const experiences = getExperienceOccurrences(participation);
  const evaluationSituation = getEvaluationSituation(participation);
  const evaluation = findEvaluationByParticipationId(mockEvaluations, participation.id);

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{participation.event?.name ?? 'Evento não informado'}</Text>
        <Text style={date ? styles.info : styles.infoMuted}>{date ?? 'Data não registrada'}</Text>

        <Text style={styles.sectionTitle}>Permanência</Text>
        <TimeRow label="Entrada" registeredTime={entry} />
        <TimeRow label="Saída" registeredTime={exit} />
        <DetailRow
          label="Tempo de permanência"
          value={stayDuration ?? 'Não registrado'}
          muted={!stayDuration}
        />

        <Text style={styles.sectionTitle}>Experiências realizadas</Text>
        {experiences.length > 0 ? (
          // Cada ocorrência é exibida pelo seu próprio id: a mesma experiência
          // pode ter sido realizada mais de uma vez na participação.
          experiences.map((occurrence) => (
            <View key={occurrence.id} style={styles.experience}>
              <Text style={styles.experienceName}>
                {occurrence.experience?.name ?? 'Experiência não identificada'}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.infoMuted}>Nenhuma experiência registrada nesta participação.</Text>
        )}

        <EvaluationSection situation={evaluationSituation} evaluation={evaluation} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
  },
  info: {
    fontSize: 14,
    marginTop: 4,
  },
  infoMuted: {
    color: '#777',
    fontSize: 14,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 24,
  },
  row: {
    borderBottomColor: '#ddd',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  label: {
    fontSize: 14,
  },
  value: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  valueMuted: {
    color: '#777',
    fontSize: 14,
  },
  experience: {
    borderColor: '#ddd',
    borderRadius: 4,
    borderWidth: 1,
    marginTop: 8,
    padding: 12,
  },
  experienceName: {
    fontSize: 14,
  },
  commentLabel: {
    fontSize: 14,
    marginTop: 8,
  },
  comment: {
    fontSize: 14,
    marginTop: 4,
  },
  message: {
    fontSize: 16,
    marginTop: 24,
  },
});
