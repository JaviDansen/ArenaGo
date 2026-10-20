import { FlatList, StyleSheet, Text } from 'react-native';

import ParticipationCard from '../components/ParticipationCard';
import ScreenContainer from '../components/ScreenContainer';
import { mockParticipations } from '../data/mockData';
import {
  getEvaluationSituation,
  getPendingEvaluationParticipations,
} from '../utils/evaluation';

export default function EventsScreen({ navigation }) {
  // Dados mockados enquanto não há integração com backend.
  const seenParticipationIds = new Set();
  const participations = (Array.isArray(mockParticipations) ? mockParticipations : []).filter((participation) => {
    const id = participation?.id;
    if (!participation || !Object.prototype.hasOwnProperty.call(participation, 'id')
      || typeof id !== 'string' || id.trim() === '' || seenParticipationIds.has(id)) {
      return false;
    }
    seenParticipationIds.add(id);
    return true;
  });
  const pendingEvaluations = getPendingEvaluationParticipations(participations);
  const hasParticipations = Array.isArray(participations) && participations.length > 0;

  function openDetails(participationId) {
    navigation.navigate('ParticipationDetails', { participationId });
  }

  function renderParticipation(participation) {
    return (
      <ParticipationCard
        participation={participation}
        evaluationSituation={getEvaluationSituation(participation)}
        onPress={() => openDetails(participation.id)}
      />
    );
  }

  // Pendências de avaliação, cada uma ligada ao ID da sua participação.
  const pendingSection = (
    <>
      <Text style={styles.sectionTitle}>Avaliações pendentes</Text>
      {pendingEvaluations.length > 0 ? (
        pendingEvaluations.map((participation) => (
          <ParticipationCard
            key={participation.id}
            participation={participation}
            evaluationSituation={getEvaluationSituation(participation)}
            onPress={() => openDetails(participation.id)}
          />
        ))
      ) : (
        <Text style={styles.emptyPending}>Você não possui avaliações pendentes.</Text>
      )}
      <Text style={styles.sectionTitle}>Todas as participações</Text>
    </>
  );

  return (
    <ScreenContainer>
      <Text style={styles.title}>Minhas Participações</Text>
      <FlatList
        data={participations}
        keyExtractor={(participation) => participation.id}
        renderItem={({ item }) => renderParticipation(item)}
        ListHeaderComponent={hasParticipations ? pendingSection : null}
        ListEmptyComponent={
          <Text style={styles.emptyMessage}>
            Você ainda não possui participações em eventos.
          </Text>
        }
        contentContainerStyle={styles.listContent}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 20,
  },
  emptyPending: {
    color: '#777',
    fontSize: 14,
    marginTop: 8,
  },
  listContent: {
    paddingBottom: 24,
  },
  emptyMessage: {
    fontSize: 16,
    marginTop: 24,
  },
});
