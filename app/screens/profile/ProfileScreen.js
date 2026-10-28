import { useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthContext } from '../../context/AuthContext';
import { mockProfileStatistics } from '../../data/mockData';
import { getProfileViewData } from '../../utils/profile';

export default function ProfileScreen({ navigation, route }) {
  const auth = useContext(AuthContext);
  const client = auth?.httpClient;
  const userId = auth?.user?.id;
  const isAuthenticated = Boolean(auth?.isAuthenticated);
  const sessionEpoch = auth?.getSessionEpoch?.();
  const authRef = useRef(auth);
  authRef.current = auth;
  const reloadRef = useRef(null);
  const [loaded, setLoaded] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const logoutPending = useRef(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const ownsData = isAuthenticated && loaded?.userId === userId
    && loaded?.sessionEpoch === sessionEpoch && loaded?.client === client;
  const account = ownsData ? loaded.account : null;
  const questionnaire = ownsData ? loaded.questionnaire : null;
  const profile = getProfileViewData({
    statistics: mockProfileStatistics, user: account, questionnaire,
  });
  const canLogout = typeof auth?.logout === 'function';
  const canEdit = !isLoading && account?.hasCompletedQuestionnaire === true
    && questionnaire?.hasCompleted === true && auth?.user?.hasCompletedQuestionnaire === true;

  useEffect(() => {
    let active = true;
    let pending = false;
    let requestVersion = 0;
    const isCurrent = (version) => active && requestVersion === version
      && authRef.current?.isAuthenticated && authRef.current?.user?.id === userId
      && authRef.current?.httpClient === client
      && authRef.current?.getSessionEpoch?.() === sessionEpoch;

    async function loadProfile() {
      if (pending || !isAuthenticated || !userId || !client) return;
      pending = true;
      const version = ++requestVersion;
      setIsLoading(true);
      setLoadError('');
      setLoaded(null);
      const [identityResult, questionnaireResult] = await Promise.allSettled([
        Promise.resolve().then(() => client.get('/profile', { auth: true })),
        Promise.resolve().then(() => client.get('/profile/questionnaire', { auth: true })),
      ]);
      if (!isCurrent(version)) return;
      pending = false;
      const account = identityResult.status === 'fulfilled' && identityResult.value?.id === userId
        ? identityResult.value : null;
      const questionnaire = questionnaireResult.status === 'fulfilled'
        && typeof questionnaireResult.value?.hasCompleted === 'boolean'
        ? questionnaireResult.value : null;
      setLoaded({ userId, sessionEpoch, client, account, questionnaire });
      setIsLoading(false);
      if (!account || !questionnaire) {
        setLoadError('Não foi possível carregar todos os dados do perfil. Verifique sua conexão e tente novamente.');
      }
    }

    setLoaded(null);
    setLoadError('');
    setIsLoading(isAuthenticated);
    reloadRef.current = loadProfile;
    if (navigation?.isFocused?.() !== false) void loadProfile();
    const unsubscribeFocus = navigation?.addListener?.('focus', loadProfile);
    const unsubscribeBlur = navigation?.addListener?.('blur', () => {
      requestVersion += 1;
      pending = false;
    });
    return () => {
      active = false;
      reloadRef.current = null;
      unsubscribeFocus?.();
      unsubscribeBlur?.();
    };
  }, [client, userId, isAuthenticated, sessionEpoch, navigation]);

  function openQuestionnaire() {
    if (!canEdit) return;
    navigation?.setParams?.({ questionnaireSaved: undefined });
    navigation?.navigate('ProfileQuestionnaire', { mode: 'edit' });
  }

  async function handleLogout() {
    if (logoutPending.current || !canLogout) return;
    logoutPending.current = true;
    setIsLoggingOut(true);
    setLogoutError('');
    try {
      await auth.logout();
      // AuthSessionGate acompanha a sessão e retorna ao fluxo público.
    } catch {
      setLogoutError('Não foi possível sair da conta. Tente novamente.');
    } finally {
      logoutPending.current = false;
      setIsLoggingOut(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Meu Perfil</Text>

        <View style={styles.identity}>
          <View style={styles.avatar} accessible accessibilityLabel="Avatar genérico de usuário">
            <View style={styles.avatarHead} />
            <View style={styles.avatarBody} />
          </View>
          {account ? <>
            <Text style={styles.name}>{profile.name}</Text>
            <Text style={styles.email}>{profile.email}</Text>
          </> : null}
        </View>

        <Text style={styles.demoNotice}>Indicadores demonstrativos</Text>
        <View style={styles.statistics}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{profile.participationCount}</Text>
            <Text style={styles.statLabel}>Participações</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{profile.totalTime}</Text>
            <Text style={styles.statLabel}>Tempo total</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Dados do questionário</Text>
        {route?.params?.questionnaireSaved ? (
          <Text style={styles.demoNotice} accessibilityLiveRegion="polite">Questionário atualizado com sucesso.</Text>
        ) : null}
        {isLoading ? (
          <View accessibilityLiveRegion="polite">
            <ActivityIndicator color="#111827" />
            <Text style={styles.demoNotice}>Carregando perfil...</Text>
          </View>
        ) : null}
        {loadError ? <>
          <Text style={styles.error} accessibilityRole="alert">{loadError}</Text>
          <Pressable style={styles.editButton} onPress={() => reloadRef.current?.()}
            disabled={isLoading} accessibilityRole="button" accessibilityLabel="Tentar carregar perfil novamente">
            <Text style={styles.editButtonText}>Tentar novamente</Text>
          </Pressable>
        </> : null}
        {questionnaire?.hasCompleted === false ? (
          <Text style={styles.demoNotice}>Questionário ainda não concluído.</Text>
        ) : null}
        {questionnaire?.hasCompleted ? <View style={styles.questionnaireCard}>
          {profile.questionnaireRows.map((row, index) => (
            <View key={row.label} style={[
              styles.dataRow, index > 0 && styles.dataRowBorder,
            ]}>
              <Text style={styles.dataLabel}>{row.label}</Text>
              <Text style={styles.dataValue}>{row.value}</Text>
            </View>
          ))}
        </View> : null}

        <Pressable
          style={styles.editButton}
          onPress={openQuestionnaire}
          disabled={!canEdit}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canEdit }}
          accessibilityLabel="Editar dados do questionário"
        >
          <Text style={styles.editButtonText}>EDITAR DADOS DO QUESTIONÁRIO</Text>
        </Pressable>

        {logoutError ? <Text style={styles.error} accessibilityRole="alert">{logoutError}</Text> : null}
        <Pressable
          style={[styles.logoutButton, (isLoggingOut || !canLogout) && styles.disabledButton]}
          onPress={handleLogout}
          disabled={isLoggingOut || !canLogout}
          accessibilityRole="button"
          accessibilityLabel="Sair da conta"
          accessibilityState={{ disabled: isLoggingOut || !canLogout, busy: isLoggingOut }}
        >
          <Text style={styles.logoutButtonText}>{isLoggingOut ? 'Saindo...' : 'SAIR DA CONTA'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // O cabeçalho e a barra de abas existentes já cuidam dos insets superior e inferior.
  safeArea: { flex: 1, backgroundColor: '#fff' },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24 },
  title: { color: '#000', fontSize: 24, fontWeight: 'bold' },
  identity: { alignItems: 'center', marginVertical: 24 },
  avatar: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: '#f3f4f6',
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  avatarHead: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#6b7280' },
  avatarBody: {
    width: 42, height: 23, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderBottomLeftRadius: 6, borderBottomRightRadius: 6, backgroundColor: '#6b7280',
  },
  name: { color: '#111827', fontSize: 20, fontWeight: '600', textAlign: 'center', marginTop: 12 },
  email: { color: '#6b7280', fontSize: 14, textAlign: 'center', marginTop: 6 },
  demoNotice: { color: '#6b7280', fontSize: 12, lineHeight: 18, marginBottom: 8 },
  statistics: { flexDirection: 'row', gap: 12 },
  statCard: {
    flex: 1, paddingVertical: 18, paddingHorizontal: 8, alignItems: 'center',
    backgroundColor: '#f9fafb', borderColor: '#e5e7eb', borderWidth: 1, borderRadius: 8,
  },
  statValue: { color: '#111827', fontSize: 26, fontWeight: 'bold' },
  statLabel: { color: '#6b7280', fontSize: 14, textAlign: 'center', marginTop: 4 },
  sectionTitle: { color: '#111827', fontSize: 18, fontWeight: 'bold', marginTop: 28, marginBottom: 8 },
  questionnaireCard: { borderColor: '#e5e7eb', borderWidth: 1, borderRadius: 8, paddingHorizontal: 16 },
  dataRow: { paddingVertical: 14, gap: 5 },
  dataRowBorder: { borderTopColor: '#e5e7eb', borderTopWidth: 1 },
  dataLabel: { color: '#6b7280', fontSize: 13 },
  dataValue: { color: '#111827', fontSize: 15, lineHeight: 22 },
  editButton: {
    alignItems: 'center', backgroundColor: '#f3f4f6', borderRadius: 4,
    marginTop: 20, padding: 14, gap: 4,
  },
  editButtonText: { color: '#6b7280', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  logoutButton: { alignItems: 'center', backgroundColor: '#000', borderRadius: 4, marginTop: 24, padding: 14 },
  logoutButtonText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  disabledButton: { opacity: 0.6 },
  error: { color: '#b91c1c', fontSize: 14, marginTop: 16 },
});
