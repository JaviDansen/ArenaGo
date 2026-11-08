import { useContext, useRef } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import ScreenContainer from '../../components/ScreenContainer';
import { ParticipationContext } from '../../context/ParticipationContext';

export default function EventConfirmationScreen({ navigation, route }) {
  const { admission, confirmEventEntry, retryEntrySync, isCurrentAdmission } = useContext(ParticipationContext);
  const { event, eligibility } = route.params;
  const inFlight = useRef(false);
  const current = admission?.event?.id === event.id;
  const busy = current && ['joining', 'looking_up'].includes(admission.status);
  const confirmed = current && admission.confirmedParticipationId;
  const blocked = !eligibility?.eligible;

  async function handleConfirmEntry() {
    if (inFlight.current || busy || blocked || !isCurrentAdmission()) return;
    inFlight.current = true;
    try {
      const result = confirmed ? await retryEntrySync() : await confirmEventEntry(event.id);
      if (result?.kind === 'complete' && isCurrentAdmission()) {
        navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
      }
    } finally {
      inFlight.current = false;
    }
  }

  const message = !current ? 'Consulte novamente o evento para confirmar o ingresso.' : admission?.error;

  return (
    <ScreenContainer>
      <Text style={styles.title}>Evento encontrado</Text>
      <Text style={styles.eventName}>{event.name}</Text>
      <Text style={styles.detail}>Fuso horário: {event.timezone}</Text>
      <Text style={styles.detail}>Início: {event.startsAt}</Text>
      <Text style={styles.detail}>Término oficial: {event.officialEndsAt}</Text>
      <Text style={styles.detail}>Prazo operacional: {event.operationalDeadlineAt}</Text>
      <Text style={styles.detail}>{event.externalQueueEnabled ? 'Fila externa habilitada' : 'Sem fila externa'}</Text>
      {blocked ? <Text style={styles.error}>Ingresso indisponível: {eligibility.blockingReasons.join(', ')}</Text> : null}
      {message ? <Text style={styles.error}>{message}</Text> : null}
      <Pressable style={styles.button} onPress={handleConfirmEntry}
        disabled={busy || blocked || !current || admission.status === 'complete'}>
        <Text style={styles.buttonText}>{busy ? 'Aguarde...' : confirmed ? 'Atualizar participação' : 'Confirmar entrada'}</Text>
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
  detail: {
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
