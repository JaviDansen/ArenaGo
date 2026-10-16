import { ScrollView, StyleSheet, Text, View } from 'react-native';

import ScreenContainer from '../components/ScreenContainer';
import { mockParticipations } from '../data/mockData';
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
  message: {
    fontSize: 16,
    marginTop: 24,
  },
});
