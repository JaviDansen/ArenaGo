import { useContext, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AuthContext } from '../../context/AuthContext';
import { validateLoginForm } from '../../utils/validation';

export default function LoginScreen({ navigation, route, auth: propAuth }) {
  const contextAuth = typeof useContext === 'function' ? useContext(AuthContext) : null;
  const auth = propAuth ?? contextAuth;

  const initialEmail =
    typeof route?.params?.email === 'string' ? route.params.email : '';

  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
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
        // AuthSessionGate selects MainTabs when the authenticated session is published.
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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {/* Header com botão de voltar e marca centralizada */}
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityLabel="Voltar"
        >
          <Text style={styles.backButtonText}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>BEAST</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Cabeçalho textual */}
          <Text style={styles.tag}>ACESSO</Text>
          <Text style={styles.title}>De volta ao jogo.</Text>
          <Text style={styles.subtitle}>
            Informe suas credenciais para entrar na sua conta.
          </Text>

          {/* Formulário */}
          <View style={styles.form}>
            {sessionNotice && !authError && !twoFactorNotice ? (
              <View style={styles.sessionNoticeContainer}>
                <Text style={styles.sessionNoticeText}>{sessionNotice}</Text>
              </View>
            ) : null}

            {twoFactorNotice ? (
              <View style={styles.twoFactorContainer}>
                <Text style={styles.twoFactorTitle}>Verificação em duas etapas exigida</Text>
                <Text style={styles.twoFactorText}>{twoFactorNotice}</Text>
              </View>
            ) : null}

            {/* Mensagem estruturada para retorno de autenticação */}
            {authError ? (
              <View style={styles.authErrorContainer}>
                <Text style={styles.authErrorText}>{authError}</Text>
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>E-mail</Text>
              <TextInput
                style={[styles.input, errors.email ? styles.inputError : null]}
                placeholder="seu.email@exemplo.com"
                placeholderTextColor="#64748b"
                value={email}
                editable={!isSubmitting}
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
              />
              {errors.email ? (
                <Text style={styles.errorText}>{errors.email}</Text>
              ) : null}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Senha</Text>
              <TextInput
                style={[styles.input, errors.password ? styles.inputError : null]}
                placeholder="Digite sua senha"
                placeholderTextColor="#64748b"
                value={password}
                editable={!isSubmitting}
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
                secureTextEntry
              />
              {errors.password ? (
                <Text style={styles.errorText}>{errors.password}</Text>
              ) : null}
            </View>

            <Pressable
              style={styles.forgotPasswordContainer}
              onPress={() => navigation.navigate('ForgotPassword')}
              disabled={isSubmitting}
            >
              <Text style={styles.forgotPasswordText}>Esqueceu sua senha?</Text>
            </Pressable>

            <Pressable
              style={[styles.primaryButton, isSubmitting ? styles.primaryButtonDisabled : null]}
              onPress={handleLogin}
              disabled={isSubmitting}
              accessibilityLabel="Entrar na conta"
            >
              <Text style={styles.primaryButtonText}>
                {isSubmitting ? 'Entrando...' : 'Entrar na conta'}
              </Text>
            </Pressable>
          </View>

          {/* Navegação cruzada para Cadastro */}
          <Pressable
            style={styles.switchAuthContainer}
            onPress={() => navigation.navigate('Register')}
            disabled={isSubmitting}
          >
            <Text style={styles.switchAuthText}>
              Ainda não tem cadastro? Crie sua conta
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0a17',
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#191330',
    borderWidth: 1,
    borderColor: '#34265a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  headerPlaceholder: {
    width: 40,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  tag: {
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  title: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 15,
    marginBottom: 28,
  },
  form: {
    gap: 16,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '500',
  },
  input: {
    backgroundColor: '#141026',
    borderWidth: 1,
    borderColor: '#2a2046',
    borderRadius: 12,
    height: 52,
    paddingHorizontal: 16,
    color: '#ffffff',
    fontSize: 15,
  },
  inputError: {
    borderColor: '#ef4444',
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  sessionNoticeContainer: {
    backgroundColor: '#1e1b4b',
    borderWidth: 1,
    borderColor: '#6366f1',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  sessionNoticeText: {
    color: '#c7d2fe',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 18,
  },
  twoFactorContainer: {
    backgroundColor: '#2c1f0f',
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 12,
    padding: 14,
    gap: 6,
    marginBottom: 4,
  },
  twoFactorTitle: {
    color: '#fcd34d',
    fontSize: 14,
    fontWeight: '700',
  },
  twoFactorText: {
    color: '#fde68a',
    fontSize: 13,
    lineHeight: 18,
  },
  authErrorContainer: {
    backgroundColor: '#2a121d',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  authErrorText: {
    color: '#fca5a5',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  forgotPasswordContainer: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
  },
  forgotPasswordText: {
    color: '#a78bfa',
    fontSize: 14,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: '#7c3aed',
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonDisabled: {
    opacity: 0.65,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  switchAuthContainer: {
    marginTop: 36,
    alignItems: 'center',
    paddingVertical: 8,
  },
  switchAuthText: {
    color: '#c084fc',
    fontSize: 15,
    fontWeight: '800',
  },
});
