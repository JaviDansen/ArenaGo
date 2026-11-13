import { StyleSheet, Text, View } from 'react-native';

import { shiftLocal } from '../adminTime';
import AdminButton from './AdminButton';
import { adminColors } from './adminTheme';

const SHORTCUTS = [0, 30, 60];

// Atalhos para preencher o limite operacional a partir do encerramento oficial
// digitado (+0, +30 ou +60 min). O Admin continua podendo digitar outro valor.
export default function MarginShortcuts({ officialDate, officialTime, onPick, disabled = false }) {
  const base = shiftLocal(officialDate, officialTime, 0);
  return (
    <View style={styles.wrapper}>
      <Text style={styles.hint}>
        {base ? 'Preencher o limite a partir do encerramento oficial:' : 'Preencha o encerramento oficial para usar os atalhos.'}
      </Text>
      <View style={styles.row}>
        {SHORTCUTS.map((minutes) => (
          <View key={minutes} style={styles.item}>
            <AdminButton
              compact
              variant="secondary"
              label={minutes === 0 ? 'Igual ao oficial' : `+${minutes} min`}
              accessibilityLabel={`Limite operacional ${minutes} minutos após o encerramento oficial`}
              disabled={disabled || !base}
              onPress={() => onPick(shiftLocal(officialDate, officialTime, minutes))}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 8 },
  hint: { color: adminColors.muted, fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  item: { paddingHorizontal: 4 },
});
