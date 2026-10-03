import { useContext } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import ScreenContainer from '../components/ScreenContainer';
import { ParticipationContext } from '../context/ParticipationContext';

export default function EventConfirmationScreen({ navigation, route }) {
  const { setParticipation } = useContext(ParticipationContext);
  const { event } = route.params;

  function handleConfirmEntry() {
    // Eventos com fila externa começam em espera; os demais entram direto na Arena.
    if (event.hasArenaQueue) {
      setParticipation({
        event,
        status: 'waiting',
        // Posição temporariamente simulada enquanto não há integração com backend.
        queuePosition: 5,
        experienceQueue: null,
        // Será preenchida quando o participante for chamado para uma experiência.
        activeExperience: null,
      });
    } else {
      setParticipation({
        event,
        status: 'active',
        queuePosition: null,
        experienceQueue: null,
        activeExperience: null,
      });
    }

    // Remove as telas de entrada para não retornar a elas com participação ativa.
    navigation.reset({
      index: 0,
      routes: [{ name: 'MainTabs' }],
    });
  }

  return (
    <ScreenContainer>
      <Text style={styles.title}>Evento encontrado</Text>
      <Text style={styles.eventName}>{event.name}</Text>
      <Text style={styles.location}>{event.location}</Text>
      <Pressable style={styles.button} onPress={handleConfirmEntry}>
        <Text style={styles.buttonText}>Confirmar entrada</Text>
      </Pressable>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  eventName: {
    fontSize: 18,
    marginTop: 24,
  },
  location: {
    fontSize: 16,
    marginTop: 8,
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
