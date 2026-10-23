import { cloneElement, isValidElement, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { AuthProvider, useAuth } from '../../context/AuthContext';

const PROTECTED_ROUTE_NAMES = new Set([
  'MainTabs',
  'ProfileQuestionnaire',
  'Questionario',
  'EventEntry',
  'EventConfirmation',
  'ParticipationDetails',
  'Evaluation',
]);

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

  if (authState.postAuthRoute === 'ProfileQuestionnaire') {
    return 'ProfileQuestionnaire';
  }

  return 'MainTabs';
}

function adaptNavigationTree(node, authState) {
  if (!isValidElement(node)) {
    return node;
  }

  const initialRouteName = resolveInitialRouteForAuthState(authState);
  const navKey = authState?.isAuthenticated
    ? `auth-${initialRouteName}`
    : `unauth-${initialRouteName}`;

  // Se for o Stack.Navigator (possui initialRouteName nas props), ajusta a rota inicial e filtra rotas protegidas quando desautenticado
  if (node.props && typeof node.props.initialRouteName === 'string') {
    const rawChildren = Array.isArray(node.props.children)
      ? node.props.children
      : node.props.children
      ? [node.props.children]
      : [];

    const filteredChildren = authState?.isAuthenticated
      ? rawChildren
      : rawChildren.filter((child) => {
          const screenName = child?.props?.name;
          return !screenName || !PROTECTED_ROUTE_NAMES.has(screenName);
        });

    return cloneElement(
      node,
      {
        ...node.props,
        initialRouteName,
      },
      ...filteredChildren
    );
  }

  if (!node.props || !node.props.children) {
    return node;
  }

  const adaptedChildren = Array.isArray(node.props.children)
    ? node.props.children.map((child) => adaptNavigationTree(child, authState))
    : adaptNavigationTree(node.props.children, authState);

  // Se o filho adaptado é o Stack.Navigator, este nó é o NavigationContainer; atribuímos key para reconstruir a pilha na troca de estado de sessão
  const isNavContainer =
    isValidElement(adaptedChildren) &&
    adaptedChildren.props &&
    typeof adaptedChildren.props.initialRouteName === 'string';

  return cloneElement(
    node,
    isNavContainer ? { ...node.props, key: navKey } : node.props,
    adaptedChildren
  );
}

export function AuthSessionCoordinator({ children }) {
  const auth = useAuth();
  const [bypassNetworkRecovery, setBypassNetworkRecovery] = useState(false);

  if (!auth) {
    return children;
  }

  if (auth.isInitializing) {
    return (
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
    );
  }

  if (
    !auth.isAuthenticated &&
    auth.sessionStatus === 'network_error' &&
    auth.networkError &&
    !bypassNetworkRecovery
  ) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.centerBox}>
          <Text style={styles.recoveryTag}>CONEXÃO INDISPONÍVEL</Text>
          <Text style={styles.loadingTitle}>Não foi possível verificar sua sessão</Text>
          <Text style={styles.loadingSubtitle}>{auth.networkError}</Text>

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
    );
  }

  return adaptNavigationTree(children, auth);
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
