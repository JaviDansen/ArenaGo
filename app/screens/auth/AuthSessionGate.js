import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../../context/AuthContext';

export function resolveInitialRouteForAuthState(authState) {
  if (!authState || !authState.isAuthenticated) {
    if (
      authState?.sessionStatus === 'revoked' ||
      authState?.sessionStatus === 'expired' ||
      authState?.sessionStatus === 'uncertain_refresh' ||
      Boolean(authState?.authNotice)
    ) {
      return 'Login';
    }
    return 'Welcome';
  }

  const roles = authState.user?.roles;
  if (!Array.isArray(roles) || roles.length === 0 ||
      !roles.every((role) => ['admin', 'staff', 'participante'].includes(role))) {
    return 'IdentityRecovery';
  }
  if (roles.includes('admin')) return 'AdminPending';
  if (roles.includes('staff')) return 'StaffPending';

  if (authState.user && authState.user.hasCompletedQuestionnaire === false) {
    return 'ProfileQuestionnaire';
  }

  if (authState.postAuthRoute === 'ProfileQuestionnaire') {
    return 'ProfileQuestionnaire';
  }

  return 'MainTabs';
}

export function AuthSessionCoordinator({ children }) {
  const auth = useAuth();
  const [bypassNetworkRecovery, setBypassNetworkRecovery] = useState(false);

  if (!auth) {
    return children;
  }

  // Mantém a pilha montada durante uma verificação da mesma sessão, mas sem
  // exibir ou permitir interação com dados cuja identidade ainda não foi confirmada.
  const wrap = (content, blocked) => (
    <View style={styles.fill}>
      {(!blocked || auth.isAuthenticated) && (
        <View style={blocked ? styles.hidden : styles.fill}
          pointerEvents={blocked ? 'none' : 'auto'}
          accessibilityElementsHidden={blocked}
          importantForAccessibility={blocked ? 'no-hide-descendants' : 'auto'}>
          {children}
        </View>
      )}
      {content}
    </View>
  );

  if (auth.isInitializing || auth.identityStatus === 'checking') {
    return wrap((
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.centerBox}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoBadgeText}>B</Text>
          </View>
          <ActivityIndicator size="large" color="#a78bfa" />
          <Text style={styles.loadingTitle}>Restaurando sua sessão...</Text>
          <Text style={styles.loadingSubtitle}>
            Confirmando suas credenciais com segurança no ArenaGo.
          </Text>
        </View>
      </SafeAreaView>
    ), true);
  }

  if (auth.identityStatus === 'error' ||
      (auth.isAuthenticated && resolveInitialRouteForAuthState(auth) === 'IdentityRecovery')) {
    return wrap((
      <SafeAreaView style={styles.container}>
        <View style={styles.centerBox}>
          <Text style={styles.loadingTitle}>Não foi possível verificar sua sessão</Text>
          <Text style={styles.loadingSubtitle}>Confirme sua conexão e tente novamente.</Text>
          <Pressable style={styles.primaryButton} accessibilityLabel="Tentar verificar sessão"
            onPress={() => { void auth.restoreSession(); }}>
            <Text style={styles.primaryButtonText}>Tentar novamente</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} accessibilityLabel="Sair da conta"
            onPress={() => { void auth.logout(); }}>
            <Text style={styles.secondaryButtonText}>Sair da conta</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    ), true);
  }

  const isStorageFailure = auth.sessionStatus === 'storage_error';
  const isNetworkFailure = auth.sessionStatus === 'network_error';
  const recoveryMessage = auth.storageError || auth.networkError;

  if (
    !auth.isAuthenticated &&
    (isNetworkFailure || isStorageFailure) &&
    recoveryMessage &&
    !bypassNetworkRecovery
  ) {
    return wrap((
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.centerBox}>
          <Text style={styles.recoveryTag}>
            {isStorageFailure ? 'FALHA NA RESTAURAÇÃO' : 'CONEXÃO INDISPONÍVEL'}
          </Text>
          <Text style={styles.loadingTitle}>Não foi possível verificar sua sessão</Text>
          <Text style={styles.loadingSubtitle}>{recoveryMessage}</Text>

          <View style={styles.recoveryActions}>
            <Pressable
              style={styles.primaryButton}
              onPress={() => {
                void auth.restoreSession();
              }}
              accessibilityLabel="Tentar reconectar"
            >
              <Text style={styles.primaryButtonText}>Tentar novamente</Text>
            </Pressable>

            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                setBypassNetworkRecovery(true);
              }}
              accessibilityLabel="Ir para o Login"
            >
              <Text style={styles.secondaryButtonText}>Ir para o Login</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    ), true);
  }

  return wrap(null, false);
}

export default function AuthSessionGate({
  children,
  client,
  tokenStorage,
  sessionManager,
  autoRestore = true,
}) {
  return (
    <AuthProvider
      client={client}
      tokenStorage={tokenStorage}
      sessionManager={sessionManager}
      autoRestore={autoRestore}
    >
      <AuthSessionCoordinator>{children}</AuthSessionCoordinator>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hidden: { display: 'none' },
  container: {
    flex: 1,
    backgroundColor: '#0c0a17',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  centerBox: {
    alignItems: 'center',
    gap: 14,
  },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: '#7c3aed',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  logoBadgeText: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '900',
  },
  recoveryTag: {
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  loadingTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  loadingSubtitle: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  recoveryActions: {
    width: '100%',
    gap: 12,
    marginTop: 12,
  },
  primaryButton: {
    backgroundColor: '#7c3aed',
    height: 50,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#191330',
    borderWidth: 1,
    borderColor: '#34265a',
    height: 50,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#e2d9f3',
    fontSize: 15,
    fontWeight: '700',
  },
});
