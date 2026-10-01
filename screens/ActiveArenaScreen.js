import { useContext } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text } from 'react-native';

import { ParticipationContext } from '../context/ParticipationContext';

export default function ActiveArenaScreen() {
  const { setParticipation } = useContext(ParticipationContext);

  function handleLeaveArena() {
    setParticipation(null);
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.eventName}>BEAST Arena</Text>
      <Text style={styles.title}>Arena ativa</Text>
      <Text style={styles.message}>Sua participação na Arena está ativa.</Text>
      <Text style={styles.experiencesTitle}>Experiências</Text>
      <Text style={styles.message}>As experiências disponíveis aparecerão aqui.</Text>
      <Pressable style={styles.leaveButton} onPress={handleLeaveArena}>
        <Text style={styles.leaveButtonText}>Sair da Arena</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 24,
  },
  eventName: {
    fontSize: 18,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
  },
  message: {
    fontSize: 16,
    marginTop: 16,
  },
  experiencesTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 24,
  },
  leaveButton: {
    alignItems: 'center',
    backgroundColor: '#000',
    borderRadius: 4,
    marginTop: 24,
    padding: 12,
  },
  leaveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
