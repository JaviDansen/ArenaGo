import { Pressable, StyleSheet, Text } from 'react-native';

import {
  formatParticipationDate,
  formatStayDuration,
  getStayDurationInMinutes,
} from '../utils/participation';

/**
 * Item da lista de Minhas Participações.
 *
 * Já é um Pressable para, futuramente, abrir os Detalhes da Participação:
 * basta passar `onPress`. Sem `onPress` o item fica desabilitado (a tela de
 * detalhes ainda não existe).
 */
export default function ParticipationCard({ participation, onPress }) {
  const date = formatParticipationDate(participation.enteredAt);
  const stayDuration = formatStayDuration(getStayDurationInMinutes(participation));

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && onPress && styles.cardPressed]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <Text style={styles.eventName}>{participation.event.name}</Text>
      {date ? <Text style={styles.info}>{date}</Text> : null}
      {stayDuration ? (
        <Text style={styles.info}>Permanência: {stayDuration}</Text>
      ) : (
        // Sem saída registrada não há permanência válida: não estimamos um valor.
        <Text style={styles.infoMuted}>Permanência não registrada</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderColor: '#ddd',
    borderRadius: 4,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  cardPressed: {
    opacity: 0.6,
  },
  eventName: {
    fontSize: 16,
    fontWeight: 'bold',
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
});
