import { useContext, useEffect, useRef, useState } from 'react';
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
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const submissionSequence = useRef(0);
  const snapshot = typeof auth?.getSnapshot === 'function' ? auth.getSnapshot() : auth;
  const challenge = snapshot?.adminChallenge;
  const twoFactorNotice = challenge
    ? `${challenge.message} ${challenge.isTotpConfigured
      ? 'Informe o código do segundo fator (TOTP) para concluir o acesso administrativo.'
      : 'Solicite a configuração do TOTP pelo procedimento administrativo existente. A ativação exige autorização específica e não está disponível nesta tela.'}`
    : '';

  const sessionNotice = snapshot?.authNotice || '';

  useEffect(() => {
    const cancel = () => {
      submissionSequence.current += 1;
      submittingRef.current = false;
      auth?.cancelAdminTwoFactor?.();
    };
    const unsubscribe = navigation.addListener?.('blur', () => {
      cancel();
      setIsSubmitting(false);
      setTwoFactorCode('');
      setPassword('');
      setShowPassword(false);
      setAuthError('');
    });
    return () => { unsubscribe?.(); cancel(); };
  }, [auth?.cancelAdminTwoFactor, navigation]);

  function handleCancelTwoFactor() {
    submissionSequence.current += 1;
    auth?.cancelAdminTwoFactor?.();
    submittingRef.current = false;
    setIsSubmitting(false);
    setTwoFactorCode('');
    setAuthError('');
    setPassword('');
    setShowPassword(false);
  }

  async function handleVerifyTwoFactor() {
    if (submittingRef.current || isSubmitting || !challenge?.isTotpConfigured) return;
    if (!/^[0-9]{6}$/.test(twoFactorCode)) {
      setAuthError('Informe o código TOTP de seis dígitos.');
      return;
    }
    if (typeof auth?.verifyAdminTwoFactor !== 'function') {
      setAuthError('Serviço de segundo fator indisponível. Entre novamente.');
      return;
    }
    const sequence = ++submissionSequence.current;
    submittingRef.current = true;
    setIsSubmitting(true);
    setAuthError('');
    try {
      await auth.verifyAdminTwoFactor(twoFactorCode);
      // A sessão publicada pelo gerenciador aciona o AuthSessionGate existente.
    } catch (error) {
      if (sequence !== submissionSequence.current) return;
      if (error?.isNetworkError || error?.isTimeout) {
        setAuthError('A conexão falhou durante a confirmação. O resultado pode ter sido processado; entre novamente por segurança.');
      } else if (error?.code === 'ADMIN_2FA_CHALLENGE_EXPIRED') {
        setAuthError('A verificação expirou ou foi cancelada. Entre novamente.');
      } else if (error?.status === 401) {
        setAuthError('Código inválido ou desafio expirado. Tente um código atual ou cancele e entre novamente.');
      } else if (error?.status === 429) {
        const wait = error.retryAfterSeconds > 0 ? ` Aguarde cerca de ${error.retryAfterSeconds}s.` : '';
        setAuthError(`Muitas tentativas de segundo fator. Entre novamente após aguardar.${wait}`);
      } else if (error?.code === 'ADMIN_TOTP_NOT_CONFIGURED') {
        setAuthError('Configure o TOTP pelo procedimento administrativo antes de entrar.');
      } else if (error?.status === 503) {
        setAuthError('A verificação de segundo fator está indisponível. Tente mais tarde ou procure a organização.');
      } else {
        setAuthError('Não foi possível concluir a verificação. Tente novamente ou entre novamente.');
      }
    } finally {
      if (sequence === submissionSequence.current) {
        submittingRef.current = false;
        setIsSubmitting(false);
        setTwoFactorCode('');
      }
    }
  }

  async function handleLogin() {
    if (submittingRef.current || isSubmitting) {
      return;
    }

    setAuthError('');
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
    const sequence = ++submissionSequence.current;

    try {
      const result = await auth.login(payload);
      if (sequence !== submissionSequence.current) return;

      if (result?.status === 'requires_2fa' || result?.requires2FA === true) {
        setPassword('');
        setTwoFactorCode('');
        return;
      }

      if (result?.status === 'aborted') return;

      if ((result?.status === 'authenticated' || result?.requires2FA === false) && result?.user) {
        // AuthSessionGate seleciona MainTabs quando a sessão autenticada é publicada.
        return;
      }

      setAuthError('Não foi possível iniciar uma sessão autenticada válida.');
    } catch (error) {
      if (sequence !== submissionSequence.current) return;
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
      if (sequence === submissionSequence.current) {
        submittingRef.current = false;
        setIsSubmitting(false);
      }
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
        onBack={() => { handleCancelTwoFactor(); if (!challenge) navigation.goBack(); }}
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
          {/* Cabeçalho textual com hierarquia clara */}
          <View style={styles.heroHeader}>
            <Text style={styles.kicker}>ACESSO À CONTA</Text>
            <Text style={styles.title}>De volta ao jogo.</Text>
            <Text style={styles.subtitle}>
              {challenge ? 'Confirme o segundo fator para concluir seu acesso.' : 'Informe suas credenciais para entrar na sua conta.'}
            </Text>
          </View>

          {/* Superfície de formulário com contraste refinado sobre os inputs */}
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

              {challenge ? (
                <>
                  {challenge.isTotpConfigured ? (
                    <>
                      <InputField
                        label="Código TOTP"
                        placeholder="Código de seis dígitos"
                        value={twoFactorCode}
                        onChangeText={(text) => { setTwoFactorCode(text.replace(/\D/g, '').slice(0, 6)); setAuthError(''); }}
                        keyboardType="number-pad"
                        maxLength={6}
                        autoCorrect={false}
                        textContentType="oneTimeCode"
                        editable={!isSubmitting}
                        accessibilityLabel="Código TOTP"
                      />
                      <Button
                        title={isSubmitting ? 'Verificando...' : 'Verificar código'}
                        variant="primary"
                        size="lg"
                        onPress={handleVerifyTwoFactor}
                        disabled={isSubmitting}
                        loading={isSubmitting}
                        accessibilityLabel="Verificar código"
                      />
                    </>
                  ) : null}
                  <Button
                    title="Cancelar verificação"
                    variant="secondary"
                    size="lg"
                    onPress={handleCancelTwoFactor}
                    accessibilityLabel="Cancelar verificação"
                  />
                </>
              ) : (
                <>
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
                </>
              )}
            </View>

            {/* Navegação cruzada para Cadastro */}
            {!challenge ? <Pressable
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
            : null}
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
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.layout.screenPaddingHorizontal,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
  },
  heroHeader: {
    marginBottom: spacing.lg,
    gap: spacing.xxs,
  },
  kicker: {
    ...typography.tag,
    color: colors.brand.primaryLight,
    marginBottom: spacing.xxs,
  },
  title: {
    ...typography.hero,
    color: colors.text.primary,
  },
  subtitle: {
    ...typography.body,
    color: colors.text.secondary,
  },
  formSurface: {
    backgroundColor: 'rgba(11, 11, 18, 0.84)',
    borderWidth: 1,
    borderColor: colors.border.glass,
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
    marginTop: spacing.xxs,
  },
  switchAuthContainer: {
    marginTop: spacing.lg,
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
