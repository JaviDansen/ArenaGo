import { StyleSheet, Text, View } from 'react-native';

import StaffButton from './StaffButton';
import { staffColors, staffSpacing } from './staffTheme';

// Ferramentas exclusivas da demonstração (ex.: forçar erro na próxima ação).
export default function StaffDemoTools({ failNextAction, onToggleFailure }) {
  return (
    <View style={styles.box}>
      <Text style={styles.title}>Ferramentas da demonstração</Text>
      <Text style={styles.text}>
        {failNextAction
          ? 'A próxima ação vai falhar de propósito para mostrar o estado de erro.'
          : 'Use para ver como a tela reage a uma falha de comunicação.'}
      </Text>
      <StaffButton
        label={failNextAction ? 'Cancelar erro simulado' : 'Simular erro na próxima ação'}
        variant="secondary"
        onPress={onToggleFailure}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderColor: staffColors.border,
    borderRadius: staffSpacing.radius,
    borderStyle: 'dashed',
    borderWidth: 1,
    marginTop: 28,
    padding: 12,
  },
  title: { color: staffColors.muted, fontSize: 13, fontWeight: 'bold' },
  text: { color: staffColors.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
});
