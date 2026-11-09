/**
 * ArenaGo Design System — InputField Component
 * Caixa de texto estilizada com foco dinâmico, ícones e mensagem de erro acessível
 */

import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import colors from '../../theme/colors.js';
import radii from '../../theme/radii.js';
import spacing from '../../theme/spacing.js';
import typography from '../../theme/typography.js';

export function InputField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  hint,
  leftIcon,
  rightIcon,
  secureTextEntry = false,
  editable = true,
  required = false,
  keyboardType = 'default',
  autoCapitalize = 'none',
  containerStyle,
  inputStyle,
  labelStyle,
  testID,
  onFocus,
  onBlur,
  ...rest
}) {
  const [isFocused, setIsFocused] = useState(false);

  function handleFocus(e) {
    setIsFocused(true);
    if (typeof onFocus === 'function') onFocus(e);
  }

  function handleBlur(e) {
    setIsFocused(false);
    if (typeof onBlur === 'function') onBlur(e);
  }

  const hasError = Boolean(error);

  const boxStyle = [
    styles.inputBox,
    isFocused && styles.inputBoxFocused,
    hasError && styles.inputBoxError,
    !editable && styles.inputBoxDisabled,
  ];

  return (
    <View style={[styles.container, containerStyle]}>
      {label && (
        <Text style={[styles.label, labelStyle]}>
          {label}
          {required && <Text style={styles.requiredMark}> *</Text>}
        </Text>
      )}

      <View style={boxStyle}>
        {leftIcon && <View style={styles.leftIconContainer}>{leftIcon}</View>}

        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.text.muted}
          secureTextEntry={secureTextEntry}
          editable={editable}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          style={[styles.input, inputStyle]}
          onFocus={handleFocus}
          onBlur={handleBlur}
          testID={testID}
          accessibilityLabel={label || placeholder}
          accessibilityState={{ disabled: !editable }}
          {...rest}
        />

        {rightIcon && <View style={styles.rightIconContainer}>{rightIcon}</View>}
      </View>

      {hasError ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hintText}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: spacing.md,
  },
  label: {
    ...typography.caption,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
    fontWeight: typography.weights.medium,
  },
  requiredMark: {
    color: colors.semantic.danger,
    fontWeight: typography.weights.bold,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.surface,
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radii.lg,
    minHeight: spacing.layout.inputHeight,
    paddingHorizontal: spacing.lg,
  },
  inputBoxFocused: {
    borderColor: colors.brand.primary,
    backgroundColor: colors.background.elevated,
  },
  inputBoxError: {
    borderColor: colors.semantic.danger,
  },
  inputBoxDisabled: {
    opacity: 0.5,
  },
  input: {
    flex: 1,
    ...typography.bodyLarge,
    color: colors.text.primary,
    paddingVertical: spacing.md,
  },
  leftIconContainer: {
    marginRight: spacing.sm,
  },
  rightIconContainer: {
    marginLeft: spacing.sm,
  },
  errorText: {
    ...typography.caption,
    color: colors.semantic.danger,
    marginTop: spacing.xs,
  },
  hintText: {
    ...typography.caption,
    color: colors.text.muted,
    marginTop: spacing.xs,
  },
});

export default InputField;
