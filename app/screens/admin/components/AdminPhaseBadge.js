import { StyleSheet, Text, View } from 'react-native';

import { adminPhaseLabels } from '../../../data/adminDemoData';
import { adminColors, adminPhaseColors } from './adminTheme';

// Etiqueta da fase efetiva (Agendado, Aberto, Encerrando, Encerrado).
export default function AdminPhaseBadge({ phase, waitingReadiness = false }) {
  const label = adminPhaseLabels[phase] ?? phase;
  const color = adminPhaseColors[phase] ?? adminColors.muted;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.text, { color }]}>
        ● {label}{waitingReadiness ? ' · aguardando prontidão' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  text: { fontSize: 12, fontWeight: 'bold' },
});
