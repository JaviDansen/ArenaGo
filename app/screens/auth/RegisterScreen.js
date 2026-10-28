import { useContext, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthContext } from '../../context/AuthContext';
import { validateRegisterForm } from '../../utils/validation';

export default function RegisterScreen({ navigation, auth: propAuth }) {
  const contextAuth = typeof useContext === 'function' ? useContext(AuthContext) : null;
  const auth = propAuth ?? contextAuth;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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
          <Text style={styles.tag}>NOVO REGISTRO</Text>
          <Text style={styles.title}>Comece sua jornada.</Text>
          <Text style={styles.subtitle}>
            Preencha suas informações básicas. Seu perfil de jogador será configurado na próxima etapa.
          </Text>

          {/* Formulário - Somente Nome, E-mail, Senha e Confirmar senha */}
          <View style={styles.form}>
            {timeoutNotice ? (
              <View style={styles.timeoutCard}>
                <Text style={styles.timeoutTitle}>Resultado do cadastro não confirmado</Text>
                <Text style={styles.timeoutText}>{timeoutNotice}</Text>
                <Pressable
                  style={styles.timeoutButton}
                  onPress={() => navigation.navigate('Login', { email: email.trim() })}
                  accessibilityLabel="Verificar conta no Login"
                >
                  <Text style={styles.timeoutButtonText}>Verificar fazendo Login</Text>
                </Pressable>
              </View>
            ) : null}

            {formError ? (
              <View style={styles.formErrorCard}>
                <Text style={styles.formErrorText}>{formError}</Text>
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Nome completo</Text>
              <TextInput
                style={[styles.input, errors.name ? styles.inputError : null]}
                placeholder="Como quer ser chamado?"
                placeholderTextColor="#64748b"
                value={name}
                editable={!isSubmitting}
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
              />
              {errors.name ? (
                <Text style={styles.errorText}>{errors.name}</Text>
              ) : null}
            </View>

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
                  if (formError) setFormError('');
                  if (timeoutNotice) setTimeoutNotice('');
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
                placeholder="Crie uma senha de acesso"
                placeholderTextColor="#64748b"
                value={password}
                editable={!isSubmitting}
                onChangeText={(text) => {
                  setPassword(text);
                  if (errors.password) {
                    setErrors((prev) => ({ ...prev, password: null }));
                  }
                  if (formError) setFormError('');
                  if (timeoutNotice) setTimeoutNotice('');
                }}
                secureTextEntry
              />
              {errors.password ? (
                <Text style={styles.errorText}>{errors.password}</Text>
              ) : null}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Confirmar senha</Text>
              <TextInput
                style={[styles.input, errors.confirmPassword ? styles.inputError : null]}
                placeholder="Digite a mesma senha novamente"
                placeholderTextColor="#64748b"
                value={confirmPassword}
                editable={!isSubmitting}
                onChangeText={(text) => {
                  setConfirmPassword(text);
                  if (errors.confirmPassword) {
                    setErrors((prev) => ({ ...prev, confirmPassword: null }));
                  }
                  if (formError) setFormError('');
                  if (timeoutNotice) setTimeoutNotice('');
                }}
                secureTextEntry
              />
              {errors.confirmPassword ? (
                <Text style={styles.errorText}>{errors.confirmPassword}</Text>
              ) : null}
            </View>

            <Pressable
              style={[styles.primaryButton, isSubmitting ? styles.primaryButtonDisabled : null]}
              onPress={handleRegister}
              disabled={isSubmitting}
              accessibilityLabel="Criar minha conta"
            >
              <Text style={styles.primaryButtonText}>
                {isSubmitting ? 'Criando sua conta...' : 'Criar minha conta'}
              </Text>
            </Pressable>

            {/* Card informativo de fluxo posterior */}
            <View style={styles.infoCard}>
              <Text style={styles.infoCardText}>
                Etapas seguintes: <Text style={styles.infoCardBold}>Cadastro → Questionário de Perfil → Próxima etapa</Text>. Ao criar sua conta, você será direcionado para o questionário.
              </Text>
            </View>
          </View>

          {/* Navegação cruzada para Login */}
          <Pressable
            style={styles.switchAuthContainer}
            onPress={() => navigation.navigate('Login')}
            disabled={isSubmitting}
          >
            <Text style={styles.switchAuthText}>Já possui uma conta? Acesse aqui</Text>
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
  formErrorCard: {
    backgroundColor: '#2a121d',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  formErrorText: {
    color: '#fca5a5',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  timeoutCard: {
    backgroundColor: '#2c1f0f',
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 12,
    padding: 14,
    gap: 10,
    marginBottom: 4,
  },
  timeoutTitle: {
    color: '#fcd34d',
    fontSize: 14,
    fontWeight: '700',
  },
  timeoutText: {
    color: '#fde68a',
    fontSize: 13,
    lineHeight: 18,
  },
  timeoutButton: {
    backgroundColor: '#d97706',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  timeoutButtonText: {
    color: '#ffffff',
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
  infoCard: {
    backgroundColor: '#141026',
    borderWidth: 1,
    borderColor: '#2a2046',
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
  },
  infoCardText: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
  },
  infoCardBold: {
    color: '#cbd5e1',
    fontWeight: '700',
  },
  switchAuthContainer: {
    marginTop: 32,
    alignItems: 'center',
    paddingVertical: 8,
  },
  switchAuthText: {
    color: '#c084fc',
    fontSize: 15,
    fontWeight: '800',
  },
});
