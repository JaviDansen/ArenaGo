import { useContext, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AuthBackground } from '../../components/ui/AuthBackground';
import { Button, MIN_TOUCH_TARGET } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { InputField } from '../../components/ui/InputField';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { AuthContext } from '../../context/AuthContext';
import { colors, radii, spacing, typography } from '../../theme';
import { validateRegisterForm } from '../../utils/validation';

export default function RegisterScreen({ navigation, auth: propAuth }) {
  const contextAuth = typeof useContext === 'function' ? useContext(AuthContext) : null;
  const auth = propAuth ?? contextAuth;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [timeoutNotice, setTimeoutNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  async function handleRegister() {
    if (submittingRef.current || isSubmitting) {
      return;
    }

    setFormError('');
    setTimeoutNotice('');

    // Validação local de todos os campos do formulário (nome 2..150, email válido, senha 8..128, confirmação idêntica)
    const validation = validateRegisterForm({
      name,
      email,
      password,
      confirmPassword,
    });

    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});

    if (!auth || typeof auth.register !== 'function') {
      setFormError(
        'Serviço de autenticação indisponível. Verifique a configuração da API e tente novamente.'
      );
      return;
    }

    // Payload estrito do contrato K01: enviar somente name, email e password (jamais confirmPassword)
    const payload = {
      name: name.trim(),
      email: email.trim(),
      password,
    };

    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      // AuthSessionGate seleciona a pilha autenticada a partir da sessão atualizada.
      // Esta tela pertence ao navegador público anterior e não deve navegar.
      await auth.register(payload);
    } catch (error) {
      if (error?.isTimeout) {
        setTimeoutNotice(
          'O servidor demorou para responder e não foi possível confirmar se o seu cadastro foi concluído. Antes de tentar criar novamente, acesse a tela de Login para verificar se sua conta já foi criada.'
        );
        return;
      }

      if (error?.isNetworkError) {
        setFormError(
          error.detail ||
            'Não foi possível conectar ao servidor. Verifique sua conexão com a internet e tente novamente.'
        );
        return;
      }

      const status = error?.status;
      const code = error?.code;
      const detail =
        error?.detail || 'Não foi possível concluir o cadastro. Verifique os dados informados.';

      if (status === 400 || code === 'VALIDATION_ERROR') {
        const nextFieldErrors = { ...(error?.fieldErrors || {}) };
        setErrors(nextFieldErrors);
        setFormError(detail);
        return;
      }

      if (status === 409 || code === 'EMAIL_ALREADY_REGISTERED') {
        setErrors({
          email: detail,
        });
        setFormError(detail);
        return;
      }

      if (status === 422 || code === 'PASSWORD_COMPROMISED_OR_COMMON') {
        setErrors({
          password: detail,
        });
        setFormError(detail);
        return;
      }

      if (status === 429 || code === 'TOO_MANY_REGISTRATION_ATTEMPTS') {
        const waitHint =
          typeof error?.retryAfterSeconds === 'number' && error.retryAfterSeconds > 0
            ? ` Aguarde cerca de ${error.retryAfterSeconds}s antes de tentar novamente.`
            : '';
        setFormError(`${detail}${waitHint}`);
        return;
      }

      setFormError(detail);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  const passwordToggle = (
    <Pressable
      onPress={() => setShowPassword((prev) => !prev)}
      disabled={isSubmitting}
      style={({ pressed }) => [
        styles.visibilityButton,
        pressed && !isSubmitting && styles.pressedControl,
      ]}
      accessibilityRole="button"
      accessibilityLabel={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
      accessibilityState={{ disabled: isSubmitting }}
      testID="register-toggle-password"
    >
      <Text style={styles.visibilityButtonText}>
        {showPassword ? 'Ocultar' : 'Mostrar'}
      </Text>
    </Pressable>
  );

  const confirmPasswordToggle = (
    <Pressable
      onPress={() => setShowConfirmPassword((prev) => !prev)}
      disabled={isSubmitting}
      style={({ pressed }) => [
        styles.visibilityButton,
        pressed && !isSubmitting && styles.pressedControl,
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        showConfirmPassword ? 'Ocultar confirmação de senha' : 'Mostrar confirmação de senha'
      }
      accessibilityState={{ disabled: isSubmitting }}
      testID="register-toggle-confirm-password"
    >
      <Text style={styles.visibilityButtonText}>
        {showConfirmPassword ? 'Ocultar' : 'Mostrar'}
      </Text>
    </Pressable>
  );

  return (
    <AuthBackground variant="register" testID="register-background">
      <StatusBar style="light" />

      <ScreenHeader
        title="ArenaGO"
        onBack={() => navigation.goBack()}
        backDisabled={isSubmitting}
        testID="register-header"
      />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Cabeçalho textual enxuto */}
          <View style={styles.heroHeader}>
            <Text style={styles.title}>Comece sua jornada.</Text>
            <Text style={styles.subtitle}>
              Preencha suas informações básicas. Seu perfil de jogador será configurado na próxima etapa.
            </Text>
          </View>

          {/* Superfície de formulário com prioridade total à legibilidade */}
          <View style={styles.formSurface}>
            {timeoutNotice ? (
              <Card
                variant="default"
                padding={spacing.md}
                style={styles.timeoutCard}
                testID="register-timeout-notice"
              >
                <Text style={styles.timeoutTitle}>Resultado do cadastro não confirmado</Text>
                <Text style={styles.timeoutText}>{timeoutNotice}</Text>
                <Button
                  title="Verificar fazendo Login"
                  variant="secondary"
                  size="md"
                  fullWidth
                  onPress={() => navigation.navigate('Login', { email: email.trim() })}
                  accessibilityLabel="Verificar fazendo Login"
                  style={styles.timeoutButton}
                  testID="register-timeout-login-button"
                />
              </Card>
            ) : null}

            {formError ? (
              <Card
                variant="default"
                padding={spacing.md}
                style={styles.formErrorCard}
                testID="register-form-error"
              >
                <Text style={styles.formErrorText} accessibilityRole="alert">
                  {formError}
                </Text>
              </Card>
            ) : null}

            <InputField
              label="Nome completo"
              required
              placeholder="Como quer ser chamado?"
              value={name}
              editable={!isSubmitting}
              error={errors.name}
              onChangeText={(text) => {
                setName(text);
                if (errors.name) {
                  setErrors((prev) => ({ ...prev, name: null }));
                }
                if (formError) setFormError('');
                if (timeoutNotice) setTimeoutNotice('');
              }}
              autoCapitalize="words"
              autoCorrect={false}
              containerStyle={styles.fieldContainer}
              testID="register-name-input"
            />

            <InputField
              label="E-mail"
              required
              placeholder="seu.email@exemplo.com"
              value={email}
              editable={!isSubmitting}
              error={errors.email}
              onChangeText={(text) => {
                setEmail(text);
                if (errors.email) {
                  setErrors((prev) => ({ ...prev, email: null }));
                }
                if (formError) setFormError('');
                if (timeoutNotice) setTimeoutNotice('');
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              containerStyle={styles.fieldContainer}
              testID="register-email-input"
            />

            <InputField
              label="Senha"
              required
              placeholder="Crie uma senha de acesso"
              value={password}
              editable={!isSubmitting}
              error={errors.password}
              hint="Mínimo de 8 caracteres"
              onChangeText={(text) => {
                setPassword(text);
                if (errors.password) {
                  setErrors((prev) => ({ ...prev, password: null }));
                }
                if (formError) setFormError('');
                if (timeoutNotice) setTimeoutNotice('');
              }}
              secureTextEntry={!showPassword}
              rightIcon={passwordToggle}
              containerStyle={styles.fieldContainer}
              testID="register-password-input"
            />

            <InputField
              label="Confirmar senha"
              required
              placeholder="Digite a mesma senha novamente"
              value={confirmPassword}
              editable={!isSubmitting}
              error={errors.confirmPassword}
              onChangeText={(text) => {
                setConfirmPassword(text);
                if (errors.confirmPassword) {
                  setErrors((prev) => ({ ...prev, confirmPassword: null }));
                }
                if (formError) setFormError('');
                if (timeoutNotice) setTimeoutNotice('');
              }}
              secureTextEntry={!showConfirmPassword}
              rightIcon={confirmPasswordToggle}
              containerStyle={styles.fieldContainer}
              testID="register-confirm-password-input"
            />

            <Button
              title={isSubmitting ? 'Criando sua conta...' : 'Criar minha conta'}
              variant="primary"
              size="lg"
              fullWidth
              loading={isSubmitting}
              disabled={isSubmitting}
              onPress={handleRegister}
              accessibilityLabel="Criar minha conta"
              style={styles.submitButton}
              testID="register-submit-button"
            />

            <Text style={styles.stepFootnote}>
              Ao criar sua conta, você seguirá para o questionário rápido de perfil de jogador.
            </Text>
          </View>

          {/* Navegação cruzada para Login */}
          <Pressable
            style={({ pressed }) => [
              styles.switchAuthContainer,
              isSubmitting && styles.disabledControl,
              pressed && !isSubmitting && styles.pressedControl,
            ]}
            onPress={() => navigation.navigate('Login')}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel="Já possui uma conta? Acesse aqui"
            accessibilityState={{ disabled: isSubmitting }}
            testID="register-switch-login-button"
          >
            <Text style={styles.switchAuthText}>Já possui uma conta? Acesse aqui</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.layout.screenPaddingHorizontal,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  heroHeader: {
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.hero,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.bodyLarge,
    color: colors.text.secondary,
  },
  formSurface: {
    backgroundColor: 'rgba(22, 22, 38, 0.90)',
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  fieldContainer: {
    marginBottom: 0,
  },
  visibilityButton: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visibilityButtonText: {
    ...typography.caption,
    color: colors.brand.primaryLight,
    fontWeight: typography.weights.bold,
  },
  formErrorCard: {
    backgroundColor: colors.semantic.dangerBg,
    borderColor: colors.semantic.danger,
  },
  formErrorText: {
    ...typography.body,
    color: colors.semantic.danger,
    fontWeight: typography.weights.semiBold,
    textAlign: 'center',
  },
  timeoutCard: {
    backgroundColor: colors.semantic.warningBg,
    borderColor: colors.semantic.warning,
    gap: spacing.sm,
  },
  timeoutTitle: {
    ...typography.body,
    color: colors.semantic.warning,
    fontWeight: typography.weights.bold,
  },
  timeoutText: {
    ...typography.bodySmall,
    color: colors.text.primary,
  },
  timeoutButton: {
    marginTop: spacing.xs,
  },
  submitButton: {
    marginTop: spacing.xs,
  },
  stepFootnote: {
    ...typography.caption,
    color: colors.text.muted,
    textAlign: 'center',
    marginTop: spacing.xxs,
  },
  switchAuthContainer: {
    marginTop: spacing.xl,
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
  },
  switchAuthText: {
    ...typography.body,
    color: colors.brand.primaryLight,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
  },
  disabledControl: {
    opacity: 0.45,
  },
  pressedControl: {
    opacity: 0.8,
  },
});
