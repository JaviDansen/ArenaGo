import { useContext } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import ScreenContainer from '../components/ScreenContainer';
import { ParticipationContext } from '../context/ParticipationContext';

export default function ArenaQueueScreen() {
  const { participation, setParticipation } = useContext(
    ParticipationContext
  );

  function handleRelease() {
    setParticipation({
      ...participation,
      status: 'active',
      queuePosition: null,
    });
  }

  function handleLeaveQueue() {
    setParticipation(null);
  }

  function handleQueueDisabled() {
    setParticipation({
      ...participation,
      status: 'active',
      queuePosition: null,
    });
  }

  return (
    <ScreenContainer>
      <Text style={styles.eventName}>BEAST Arena</Text>
      <Text style={styles.title}>Você está na fila</Text>
      <Text style={styles.positionLabel}>Sua posição:</Text>
      <Text style={styles.position}>{participation.queuePosition}º</Text>
      <Text style={styles.message}>
        Aguarde sua vez. Você será avisado quando sua entrada na Arena for liberada.
      </Text>
      <Text style={styles.note}>
        O tempo de permanência só começa quando sua entrada for liberada.
      </Text>
      <Pressable style={styles.button} onPress={handleRelease}>
        <Text style={styles.buttonText}>Simular entrada liberada</Text>
      </Pressable>
      <Pressable style={styles.button} onPress={handleQueueDisabled}>
        <Text style={styles.buttonText}>Simular staff desativando fila</Text>
      </Pressable>
      <Pressable style={styles.button} onPress={handleLeaveQueue}>
        <Text style={styles.buttonText}>Sair da fila</Text>
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
  positionLabel: {
    fontSize: 16,
    marginTop: 24,
  },
  position: {
    fontSize: 32,
    fontWeight: 'bold',
    marginTop: 8,
  },
  message: {
    fontSize: 16,
    marginTop: 24,
  },
  note: {
    fontSize: 16,
    marginTop: 16,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#000',
    borderRadius: 4,
    marginTop: 24,
    padding: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
