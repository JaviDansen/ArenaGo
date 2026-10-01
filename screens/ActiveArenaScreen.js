import { useContext } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import ScreenContainer from '../components/ScreenContainer';
import { ParticipationContext } from '../context/ParticipationContext';

export default function ActiveArenaScreen() {
  const { participation, setParticipation } = useContext(
    ParticipationContext
  );

  function handleLeaveArena() {
    setParticipation(null);
  }

  function handleJoinExperienceQueue(experience) {
    if (participation.experienceQueue) {
      return;
    }

    setParticipation({
      ...participation,
      experienceQueue: {
        experienceId: experience.id,
        position: experience.queueSize + 1,
      },
    });
  }

  return (
    <ScreenContainer>
      <Text style={styles.eventName}>BEAST Arena</Text>
      <Text style={styles.title}>Arena ativa</Text>
      <Text style={styles.message}>Sua participação na Arena está ativa.</Text>
      <Text style={styles.experiencesTitle}>Experiências</Text>
      {participation.event.experiences.map((experience) => {
        const isCurrentQueue =
          participation.experienceQueue?.experienceId === experience.id;

        return (
          <View key={experience.id} style={styles.experience}>
            <Text style={styles.experienceName}>{experience.name}</Text>
            <Text style={styles.message}>
              {experience.queueSize} pessoa(s) na fila
            </Text>
            {isCurrentQueue && (
              <Text style={styles.message}>
                Sua posição: {participation.experienceQueue.position}º
              </Text>
            )}
            <Pressable
              style={styles.leaveButton}
              onPress={() => handleJoinExperienceQueue(experience)}
            >
              <Text style={styles.leaveButtonText}>Entrar na fila</Text>
            </Pressable>
          </View>
        );
      })}
      <Pressable style={styles.leaveButton} onPress={handleLeaveArena}>
        <Text style={styles.leaveButtonText}>Sair da Arena</Text>
      </Pressable>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
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
  experience: {
    marginTop: 16,
  },
  experienceName: {
    fontSize: 18,
    fontWeight: 'bold',
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
