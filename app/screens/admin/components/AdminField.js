import { StyleSheet, Text, TextInput, View } from 'react-native';

import { adminColors, adminSpacing } from './adminTheme';

// Campo de formulário com rótulo, dica e erro associados (acessíveis).
export default function AdminField({
  label,
  hint,
  error,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize = 'sentences',
  editable = true,
  multiline = false,
  maxLength,
}) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error || hint}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        editable={editable}
        keyboardType={keyboardType}
        maxLength={maxLength}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={adminColors.muted}
        style={[styles.input, multiline && styles.multiline, error ? styles.inputError : null,
          !editable && styles.readOnly]}
        value={value}
      />
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 16 },
  label: { color: adminColors.text, fontSize: 14, fontWeight: 'bold' },
  hint: { color: adminColors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  input: {
    backgroundColor: adminColors.surface,
    borderColor: adminColors.border,
    borderRadius: adminSpacing.buttonRadius,
    borderWidth: 1,
    color: adminColors.text,
    fontSize: 16,
    marginTop: 8,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  inputError: { borderColor: adminColors.danger },
  readOnly: { opacity: 0.6 },
  error: { color: adminColors.danger, fontSize: 13, lineHeight: 18, marginTop: 6 },
});
