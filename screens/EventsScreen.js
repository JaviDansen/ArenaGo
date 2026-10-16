import { FlatList, StyleSheet, Text } from 'react-native';

import ParticipationCard from '../components/ParticipationCard';
import ScreenContainer from '../components/ScreenContainer';
import { mockParticipations } from '../data/mockData';

export default function EventsScreen({ navigation }) {
  // Dados mockados enquanto não há integração com backend.
  const participations = mockParticipations;

  return (
    <ScreenContainer>
      <Text style={styles.title}>Minhas Participações</Text>
      <FlatList
        data={participations}
        keyExtractor={(participation) => participation.id}
        renderItem={({ item }) => (
          <ParticipationCard
            participation={item}
            onPress={() => navigation.navigate('ParticipationDetails', { participationId: item.id })}
          />
        )}
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
  listContent: {
    paddingBottom: 24,
  },
  emptyMessage: {
    fontSize: 16,
    marginTop: 24,
  },
});
