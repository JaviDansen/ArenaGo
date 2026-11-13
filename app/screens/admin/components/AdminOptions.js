import { StyleSheet, Text, View } from 'react-native';

import AdminButton from './AdminButton';
import { adminColors } from './adminTheme';

// Grupo de opções de escolha única (fuso, filtros, fila externa, modo).
export default function AdminOptions({ label, hint, options, value, onChange, error, disabled = false }) {
  return (
    <View style={styles.wrapper} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.row}>
        {options.map((option) => (
          <View key={String(option.value)} style={styles.item}>
            <AdminButton
              compact
              variant="secondary"
              label={option.label}
              accessibilityLabel={option.accessibilityLabel ?? option.label}
              selected={value === option.value}
              disabled={disabled}
              onPress={() => onChange(option.value)}
            />
          </View>
        ))}
      </View>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 16 },
  label: { color: adminColors.text, fontSize: 14, fontWeight: 'bold' },
  hint: { color: adminColors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  item: { paddingHorizontal: 4 },
  error: { color: adminColors.danger, fontSize: 13, lineHeight: 18, marginTop: 6 },
});
