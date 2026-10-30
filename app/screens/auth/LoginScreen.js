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
import { validateLoginForm } from '../../utils/validation';

export default function LoginScreen({ navigation, route, auth: propAuth }) {
  const contextAuth = typeof useContext === 'function' ? useContext(AuthContext) : null;
  const auth = propAuth ?? contextAuth;

  const initialEmail =
    typeof route?.params?.email === 'string' ? route.params.email : '';

  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [authError, setAuthError] = useState('');
  const [twoFactorNotice, setTwoFactorNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const sessionNotice = auth?.authNotice || '';

  async function handleLogin() {
    if (submittingRef.current || isSubmitting) {
      return;
    }

    setAuthError('');
    setTwoFactorNotice('');
    if (auth && typeof auth.clearNotices === 'function') {
      auth.clearNotices();
    }

    // Validação local dos campos
    const validation = validateLoginForm({ email, password });

    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});

    if (!auth || typeof auth.login !== 'function') {
      setAuthError(
        'Serviço de autenticação indisponível. Verifique a configuração da API e tente novamente.'
      );
      return;
    }

    const payload = {
      email: email.trim(),
      password,
    };

    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      const result = await auth.login(payload);

      if (result?.status === 'requires_2fa' || result?.requires2FA === true) {
        const totpDetail = result.isTotpConfigured
          ? 'Informe o código do segundo fator (TOTP) para concluir o acesso administrativo.'
          : 'Esta conta administrativa exige configuração e confirmação do segundo fator (TOTP) antes do acesso.';
        setTwoFactorNotice(
          `${result.message || 'Segundo fator obrigatório para conta Admin.'} ${totpDetail}`
        );
        return;
      }

      if ((result?.status === 'authenticated' || result?.requires2FA === false) && result?.user) {
        // AuthSessionGate seleciona MainTabs quando a sessão autenticada é publicada.
        return;
      }

      setAuthError('Não foi possível iniciar uma sessão autenticada válida.');
    } catch (error) {
      if (error?.isTimeout) {
        setAuthError(
          'O servidor demorou para responder. Verifique sua conexão e tente novamente.'
        );
        return;
      }

      if (error?.isNetworkError) {
        setAuthError(
          error.detail ||
            'Não foi possível conectar ao servidor. Verifique sua conexão com a internet e tente novamente.'
        );
        return;
      }

      const status = error?.status;
      const code = error?.code;

      if (status === 401 || code === 'INVALID_CREDENTIALS') {
        setAuthError('E-mail ou senha inválidos.');
        return;
      }

      if (status === 400 || code === 'VALIDATION_ERROR') {
        if (error?.fieldErrors && Object.keys(error.fieldErrors).length > 0) {
          setErrors(error.fieldErrors);
        }
        setAuthError(error?.detail || 'Confira as informações enviadas.');
        return;
      }

      if (status === 429 || code === 'TOO_MANY_LOGIN_ATTEMPTS') {
        const waitHint =
          typeof error?.retryAfterSeconds === 'number' && error.retryAfterSeconds > 0
            ? ` Aguarde cerca de ${error.retryAfterSeconds}s antes de tentar novamente.`
            : '';
        setAuthError(
          `${error?.detail || 'Muitas tentativas de login seguidas.'}${waitHint}`
        );
        return;
      }

      setAuthError(
        error?.detail || 'Ocorreu um erro inesperado ao tentar entrar na sua conta.'
      );
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
      testID="login-toggle-password"
    >
      <Text style={styles.visibilityButtonText}>
        {showPassword ? 'Ocultar' : 'Mostrar'}
      </Text>
    </Pressable>
  );

  return (
    <AuthBackground variant="login" testID="login-background">
      <StatusBar style="light" />

      <ScreenHeader
        title="ArenaGO"
        onBack={() => navigation.goBack()}
        backDisabled={isSubmitting}
        testID="login-header"
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
          {/* Cabeçalho textual limpo */}
          <View style={styles.heroHeader}>
            <Text style={styles.title}>De volta ao jogo.</Text>
            <Text style={styles.subtitle}>
              Informe suas credenciais para entrar na sua conta.
            </Text>
          </View>

          {/* Superfície de formulário discreta e legível */}
          <View style={styles.formSurface}>
            {sessionNotice && !authError && !twoFactorNotice ? (
              <Card
                variant="default"
                padding={spacing.md}
                style={styles.sessionNoticeCard}
                testID="login-session-notice"
              >
                <Text style={styles.sessionNoticeText}>{sessionNotice}</Text>
              </Card>
            ) : null}

            {twoFactorNotice ? (
              <Card
                variant="default"
                padding={spacing.md}
                style={styles.twoFactorCard}
                testID="login-2fa-notice"
              >
                <Text style={styles.twoFactorTitle}>Verificação em duas etapas exigida</Text>
                <Text style={styles.twoFactorText}>{twoFactorNotice}</Text>
              </Card>
            ) : null}

            {authError ? (
              <Card
                variant="default"
                padding={spacing.md}
                style={styles.authErrorCard}
                testID="login-auth-error"
              >
                <Text style={styles.authErrorText} accessibilityRole="alert">
                  {authError}
                </Text>
              </Card>
            ) : null}

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
                if (authError) {
                  setAuthError('');
                }
                if (twoFactorNotice) {
                  setTwoFactorNotice('');
                }
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              containerStyle={styles.fieldContainer}
              testID="login-email-input"
            />

            <InputField
              label="Senha"
              required
              placeholder="Digite sua senha"
              value={password}
              editable={!isSubmitting}
              error={errors.password}
              onChangeText={(text) => {
                setPassword(text);
                if (errors.password) {
                  setErrors((prev) => ({ ...prev, password: null }));
                }
                if (authError) {
                  setAuthError('');
                }
                if (twoFactorNotice) {
                  setTwoFactorNotice('');
                }
              }}
              secureTextEntry={!showPassword}
              rightIcon={passwordToggle}
              containerStyle={styles.fieldContainer}
              testID="login-password-input"
            />

            <Pressable
              style={({ pressed }) => [
                styles.forgotPasswordContainer,
                isSubmitting && styles.disabledControl,
                pressed && !isSubmitting && styles.pressedControl,
              ]}
              onPress={() => navigation.navigate('ForgotPassword')}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityLabel="Esqueceu sua senha?"
              accessibilityState={{ disabled: isSubmitting }}
              testID="login-forgot-password-button"
            >
              <Text style={styles.forgotPasswordText}>Esqueceu sua senha?</Text>
            </Pressable>

            <Button
              title={isSubmitting ? 'Entrando...' : 'Entrar na conta'}
              variant="primary"
              size="lg"
              fullWidth
              loading={isSubmitting}
              disabled={isSubmitting}
              onPress={handleLogin}
              accessibilityLabel="Entrar na conta"
              style={styles.submitButton}
              testID="login-submit-button"
            />
          </View>

          {/* Navegação cruzada para Cadastro */}
          <Pressable
            style={({ pressed }) => [
              styles.switchAuthContainer,
              isSubmitting && styles.disabledControl,
              pressed && !isSubmitting && styles.pressedControl,
            ]}
            onPress={() => navigation.navigate('Register')}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel="Ainda não tem cadastro? Crie sua conta"
            accessibilityState={{ disabled: isSubmitting }}
            testID="login-switch-register-button"
          >
            <Text style={styles.switchAuthText}>
              Ainda não tem cadastro? Crie sua conta
            </Text>
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
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  heroHeader: {
    marginBottom: spacing.xl,
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
    backgroundColor: 'rgba(22, 22, 38, 0.86)',
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
  sessionNoticeCard: {
    backgroundColor: colors.semantic.infoBg,
    borderColor: colors.semantic.info,
  },
  sessionNoticeText: {
    ...typography.bodySmall,
    color: colors.text.primary,
    fontWeight: typography.weights.semiBold,
    textAlign: 'center',
  },
  twoFactorCard: {
    backgroundColor: colors.semantic.warningBg,
    borderColor: colors.semantic.warning,
    gap: spacing.xs,
  },
  twoFactorTitle: {
    ...typography.body,
    color: colors.semantic.warning,
    fontWeight: typography.weights.bold,
  },
  twoFactorText: {
    ...typography.bodySmall,
    color: colors.text.primary,
  },
  authErrorCard: {
    backgroundColor: colors.semantic.dangerBg,
    borderColor: colors.semantic.danger,
  },
  authErrorText: {
    ...typography.body,
    color: colors.semantic.danger,
    fontWeight: typography.weights.semiBold,
    textAlign: 'center',
  },
  forgotPasswordContainer: {
    alignSelf: 'flex-end',
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  forgotPasswordText: {
    ...typography.body,
    color: colors.brand.primaryLight,
    fontWeight: typography.weights.semiBold,
  },
  submitButton: {
    marginTop: spacing.xs,
  },
  switchAuthContainer: {
    marginTop: spacing.xxl,
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
