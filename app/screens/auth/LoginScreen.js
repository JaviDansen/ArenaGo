import { useState } from 'react';
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

import { validateLoginForm } from '../../utils/validation';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [authError, setAuthError] = useState('');

  function handleLogin() {
    // Limpa mensagens de erro prévias
    setAuthError('');

    // Validação local dos campos
    const validation = validateLoginForm({ email, password });

    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});

    // =========================================================================
    // ACESSO TEMPORÁRIO PARA DESENVOLVIMENTO (PROVISÓRIO):
    //
    // Os campos passaram pela validação local (e-mail obrigatório com formato válido
    // e senha obrigatória).
    //
    // Enquanto o backend e o serviço de autenticação real não estão definidos,
    // mantemos este redirecionamento provisório para a Home (MainTabs) para
    // permitir testar e desenvolver as demais telas do aplicativo.
    //
    // ESTRUTURA PARA A AUTENTICAÇÃO REAL (FUTURO):
    // 1. Chamar serviço de autenticação: await authService.login(email.trim(), password);
    // 2. Se o backend retornar falha de credenciais:
    //    setAuthError('E-mail ou senha inválidos.');
    // 3. Se autenticado com sucesso:
    //    armazenar token/sessão e navegar para 'MainTabs'.
    // =========================================================================
    navigation.navigate('MainTabs');
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
            {/* Mensagem estruturada para retorno de autenticação futura */}
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
                onChangeText={(text) => {
                  setPassword(text);
                  if (errors.password) {
                    setErrors((prev) => ({ ...prev, password: null }));
                  }
                  if (authError) {
                    setAuthError('');
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
            >
              <Text style={styles.forgotPasswordText}>Esqueceu sua senha?</Text>
            </Pressable>

            <Pressable style={styles.primaryButton} onPress={handleLogin}>
              <Text style={styles.primaryButtonText}>Entrar na conta</Text>
            </Pressable>
          </View>

          {/* Navegação cruzada para Cadastro */}
          <Pressable
            style={styles.switchAuthContainer}
            onPress={() => navigation.navigate('Register')}
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
