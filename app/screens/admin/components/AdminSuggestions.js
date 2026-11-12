import { StyleSheet, Text, View } from 'react-native';

import AdminButton from './AdminButton';
import { adminColors } from './adminTheme';

// Atalhos de preenchimento: só copiam o texto para o campo. Não são catálogo
// global nem criam entidades; a experiência/estação continua sendo criada
// dentro do evento/experiência atual.
export default function AdminSuggestions({ label, items, onPick, disabled = false }) {
  if (!items || items.length === 0) return null;
  return (
    <View style={styles.wrapper}>
      <Text style={styles.hint}>{label}</Text>
      <View style={styles.row}>
        {items.map((item) => (
          <View key={item} style={styles.item}>
            <AdminButton
              compact
              variant="secondary"
              label={item}
              accessibilityLabel={`Preencher com ${item}`}
              disabled={disabled}
              onPress={() => onPick(item)}
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
