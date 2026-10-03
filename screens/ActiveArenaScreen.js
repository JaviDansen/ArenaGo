import { useContext } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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
    // O participante não pode entrar em outra fila enquanto aguarda em uma fila ou realiza uma experiência.
    if (participation.experienceQueue || participation.activeExperience) {
      return;
    }

    setParticipation({
      ...participation,
      experienceQueue: {
        experienceId: experience.id,
        // Simulação temporária sem backend: entra após as pessoas do mock.
        position: experience.queueSize + 1,
      },
    });
  }

  function handleLeaveExperienceQueue() {
    // Sair da fila não encerra a participação na Arena; apenas remove esta fila.
    setParticipation({
      ...participation,
      experienceQueue: null,
    });
  }

  function handleSimulateExperienceCall() {
    if (!participation.experienceQueue) {
      return;
    }

    const { experienceId } = participation.experienceQueue;

    // Simulação temporária: no fluxo real, a equipe ou o backend fará a chamada.
    setParticipation({
      ...participation,
      experienceQueue: null,
      activeExperience: {
        experienceId,
      },
    });
  }

  function handleSimulateStaffCheck() {
    if (!participation.activeExperience) {
      return;
    }

    // Botão temporário para desenvolvimento; no fluxo real, o staff/backend confirmará que o participante realizou a experiência.
    setParticipation({
      ...participation,
      activeExperience: null,
    });
  }

  function handleSimulateAbsence() {
    if (!participation.activeExperience) {
      return;
    }

    const { experienceId } = participation.activeExperience;
    const experience = participation.event.experiences.find(
      (eventExperience) => eventExperience.id === experienceId
    );

    if (!experience) {
      return;
    }

    // Posição temporária: futuramente o backend reposicionará o participante no fim da fila.
    setParticipation({
      ...participation,
      activeExperience: null,
      experienceQueue: {
        experienceId,
        position: experience.queueSize + 1,
      },
    });
  }

  const activeExperience = participation.event.experiences.find(
    (experience) =>
      experience.id === participation.activeExperience?.experienceId
  );

  return (
    <ScreenContainer>
      {/* As experiências variam por evento; a rolagem acomoda listas maiores. */}
      <ScrollView>
        <Text style={styles.eventName}>BEAST Arena</Text>
        <Text style={styles.title}>Arena ativa</Text>
        <Text style={styles.message}>Sua participação na Arena está ativa.</Text>
        {participation.activeExperience && (
          <View style={styles.experience}>
            <Text style={styles.experienceName}>É A SUA VEZ!</Text>
            <Text style={styles.message}>
              Dirija-se ao estande de {activeExperience?.name}.
            </Text>
            <Pressable
              style={styles.leaveButton}
              onPress={handleSimulateStaffCheck}
            >
              <Text style={styles.leaveButtonText}>Simular check do staff</Text>
            </Pressable>
            <Pressable
              style={styles.leaveButton}
              onPress={handleSimulateAbsence}
            >
              <Text style={styles.leaveButtonText}>Simular ausência</Text>
            </Pressable>
          </View>
        )}
        <Text style={styles.experiencesTitle}>Experiências</Text>
        {participation.event.experiences.map((experience) => {
          // Controla as ações disponíveis enquanto o participante ocupa uma fila.
          const hasExperienceQueue = Boolean(participation.experienceQueue);
          const hasActiveExperience = Boolean(participation.activeExperience);

          const isActiveExperience =
            participation.activeExperience?.experienceId === experience.id;
          // Indica se esta experiência renderizada é a fila atual do participante.
          const isCurrentQueue =
            participation.experienceQueue?.experienceId === experience.id;

          return (
            <View key={experience.id} style={styles.experience}>
              <Text style={styles.experienceName}>{experience.name}</Text>
              <Text style={styles.message}>
                {experience.queueSize} pessoa(s) na fila
              </Text>
              {isCurrentQueue && !hasActiveExperience && (
                <Text style={styles.message}>
                  Sua posição: {participation.experienceQueue.position}º
                </Text>
              )}
              {isActiveExperience ? (
                <Text style={styles.message}>Você foi chamado</Text>
              ) : hasActiveExperience ? (
                <Text style={styles.message}>
                  Indisponível enquanto você estiver em outra experiência
                </Text>
              ) : isCurrentQueue ? (
                <>
                  <Pressable
                    style={styles.leaveButton}
                    onPress={handleLeaveExperienceQueue}
                  >
                    <Text style={styles.leaveButtonText}>Sair da fila</Text>
                  </Pressable>
                  <Pressable
                    style={styles.leaveButton}
                    onPress={handleSimulateExperienceCall}
                  >
                    <Text style={styles.leaveButtonText}>Simular chamada</Text>
                  </Pressable>
                </>
              ) : hasExperienceQueue ? (
                <Text style={styles.message}>
                  Indisponível enquanto você estiver em outra fila
                </Text>
              ) : (
                <Pressable
                  style={styles.leaveButton}
                  onPress={() => handleJoinExperienceQueue(experience)}
                >
                  <Text style={styles.leaveButtonText}>Entrar na fila</Text>
                </Pressable>
              )}
            </View>
          );
        })}
        <Pressable style={styles.leaveButton} onPress={handleLeaveArena}>
          <Text style={styles.leaveButtonText}>Sair da Arena</Text>
        </Pressable>
      </ScrollView>
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
