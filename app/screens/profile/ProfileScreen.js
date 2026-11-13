import { useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { AuthContext } from '../../context/AuthContext';
import { getProfileViewData } from '../../utils/profile';
import { AuthBackground, Badge, Button, Card, TagChip } from '../../components/ui';
import { colors, radii, spacing, typography } from '../../theme';

export default function ProfileScreen({ navigation, route }) {
  const auth = useContext(AuthContext);
  const client = auth?.httpClient;
  const userId = auth?.user?.id;
  const isAuthenticated = Boolean(auth?.isAuthenticated);
  const sessionEpoch = auth?.getSessionEpoch?.();
  const authRef = useRef(auth);
  authRef.current = auth;
  const reloadRef = useRef(null);
  const reloadStatisticsRef = useRef(null);
  const [statisticsState, setStatisticsState] = useState(null);
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
    statistics: isAuthenticated && statisticsState?.userId === userId
      && statisticsState?.sessionEpoch === sessionEpoch && statisticsState?.client === client
      ? statisticsState.value : null, user: account, questionnaire,
  });
  const canLogout = typeof auth?.logout === 'function';
  const canEdit = !isLoading && account?.hasCompletedQuestionnaire === true
    && questionnaire?.hasCompleted === true && auth?.user?.hasCompletedQuestionnaire === true;

  useEffect(() => {
    let active = true;
    let pending = false;
    let requestVersion = 0;
    let statisticsVersion = 0;
    let statisticsPending = false;
    const isCurrent = (version) => active && requestVersion === version
      && authRef.current?.isAuthenticated && authRef.current?.user?.id === userId
      && authRef.current?.httpClient === client
      && authRef.current?.getSessionEpoch?.() === sessionEpoch;

    async function loadStatistics() {
      if (statisticsPending || !isAuthenticated || !userId || !client) return;
      statisticsPending = true;
      const version = ++statisticsVersion;
      setStatisticsState({ userId, sessionEpoch, client, value: null, error: false });
      try {
        const value = await client.get('/profile/statistics', { auth: true });
        if (!active || version !== statisticsVersion || !authRef.current?.isAuthenticated
          || authRef.current?.user?.id !== userId || authRef.current?.httpClient !== client
          || authRef.current?.getSessionEpoch?.() !== sessionEpoch) return;
        if (!Number.isSafeInteger(value?.participationCount) || value.participationCount < 0
          || !Number.isSafeInteger(value?.totalMinutes) || value.totalMinutes < 0) throw new Error('Resposta inválida');
        setStatisticsState({ userId, sessionEpoch, client, value, error: false });
      } catch {
        if (active && version === statisticsVersion && authRef.current?.isAuthenticated
          && authRef.current?.user?.id === userId && authRef.current?.httpClient === client
          && authRef.current?.getSessionEpoch?.() === sessionEpoch) {
          setStatisticsState({ userId, sessionEpoch, client, value: null, error: true });
        }
      } finally {
        if (version === statisticsVersion) statisticsPending = false;
      }
    }

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
    reloadStatisticsRef.current = loadStatistics;
    const refresh = () => { void loadProfile(); void loadStatistics(); };
    if (navigation?.isFocused?.() !== false) refresh();
    const unsubscribeFocus = navigation?.addListener?.('focus', refresh);
    const unsubscribeBlur = navigation?.addListener?.('blur', () => {
      requestVersion += 1;
      pending = false;
      statisticsVersion += 1;
      statisticsPending = false;
    });
    return () => {
      active = false;
      reloadRef.current = null;
      reloadStatisticsRef.current = null;
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
    <AuthBackground
      variant="login"
      overlayOpacity={0.65}
      useSafeArea
      testID="profile-background"
    >
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Badge label="PARTICIPANTE" variant="brand" />
          <Text style={styles.title} accessibilityRole="header">
            Meu Perfil
          </Text>
        </View>

        <Card style={styles.identityCard} variant="elevated">
          <View
            style={styles.avatar}
            accessible
            accessibilityLabel="Avatar genérico de usuário"
          >
            <View style={styles.avatarHead} />
            <View style={styles.avatarBody} />
          </View>
          {account ? (
            <View style={styles.identityInfo}>
              <Text style={styles.name}>{profile.name}</Text>
              <Text style={styles.email}>{profile.email}</Text>
            </View>
          ) : null}
        </Card>

        <View style={styles.statistics}>
          <Card style={styles.statCard} variant="surface">
            <Text style={styles.statValue}>{profile.participationCount}</Text>
            <Text style={styles.statLabel}>Participações</Text>
          </Card>
          <Card style={styles.statCard} variant="surface">
            <Text style={styles.statValue}>{profile.totalTime}</Text>
            <Text style={styles.statLabel}>Tempo total</Text>
          </Card>
        </View>

        {isAuthenticated && statisticsState?.userId === userId && statisticsState?.client === client
          && statisticsState?.sessionEpoch === sessionEpoch && statisticsState?.error ? (
          <Card style={styles.errorCard} variant="surface">
            <Text style={styles.error} accessibilityRole="alert">Estatísticas indisponíveis.</Text>
            <Button variant="outline" size="md" onPress={() => reloadStatisticsRef.current?.()}
              accessibilityLabel="Tentar carregar estatísticas novamente">Tentar novamente</Button>
          </Card>
        ) : null}

        <View style={styles.questionnaireHeader}>
          <Text style={styles.sectionTitle}>Dados do questionário</Text>
        </View>

        {route?.params?.questionnaireSaved ? (
          <Card style={styles.successBanner} variant="surface">
            <Text style={styles.successText} accessibilityLiveRegion="polite">
              Questionário atualizado com sucesso.
            </Text>
          </Card>
        ) : null}

        {isLoading ? (
          <Card style={styles.loadingCard} variant="surface">
            <ActivityIndicator color={colors.brand.primaryLight} size="small" />
            <Text style={styles.loadingText} accessibilityLiveRegion="polite">
              Carregando perfil...
            </Text>
          </Card>
        ) : null}

        {loadError ? (
          <Card style={styles.errorCard} variant="surface">
            <Text style={styles.error} accessibilityRole="alert">
              {loadError}
            </Text>
            <Button
              variant="outline"
              size="md"
              onPress={() => reloadRef.current?.()}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel="Tentar carregar perfil novamente"
              style={styles.retryButton}
            >
              Tentar novamente
            </Button>
          </Card>
        ) : null}

        {questionnaire?.hasCompleted === false ? (
          <Card style={styles.pendingCard} variant="surface">
            <Text style={styles.demoNotice}>Questionário ainda não concluído.</Text>
          </Card>
        ) : null}

        {questionnaire?.hasCompleted ? (
          <View style={styles.questionnaireSections}>
            {/* 1. Informações Pessoais */}
            <Card style={styles.sectionCard} variant="surface">
              <Text style={styles.cardHeaderTitle}>Informações Pessoais</Text>
              {profile.questionnaireRows.slice(0, 3).map((row, index) => (
                <View
                  key={row.label}
                  style={[styles.dataRow, index > 0 && styles.dataRowBorder]}
                >
                  <Text style={styles.dataLabel}>{row.label}</Text>
                  <Text style={styles.dataValue}>{row.value}</Text>
                </View>
              ))}
            </Card>

            {/* 2. Jogos de Interesse */}
            <Card style={styles.sectionCard} variant="surface">
              <Text style={styles.cardHeaderTitle}>Jogos de Interesse</Text>
              <View style={styles.dataRow}>
                <Text style={styles.dataLabel}>
                  {profile.questionnaireRows[3].label}
                </Text>
                <Text style={styles.dataValue}>
                  {profile.questionnaireRows[3].value}
                </Text>
              </View>
              {Array.isArray(questionnaire?.yourGames) && questionnaire.yourGames.length > 0 ? (
                <View style={styles.gameChipsContainer}>
                  {questionnaire.yourGames.map((game, i) => {
                    const gameName = typeof game === 'string' ? game : game?.name;
                    if (!gameName) return null;
                    return (
                      <TagChip
                        key={`game-${i}-${gameName}`}
                        label={gameName}
                        style={styles.gameChip}
                      />
                    );
                  })}
                </View>
              ) : null}
            </Card>

            {/* 3. Mercado de Games */}
            <Card style={styles.sectionCard} variant="surface">
              <Text style={styles.cardHeaderTitle}>Mercado de Games</Text>
              {profile.questionnaireRows.slice(4, 6).map((row, index) => (
                <View
                  key={row.label}
                  style={[styles.dataRow, index > 0 && styles.dataRowBorder]}
                >
                  <Text style={styles.dataLabel}>{row.label}</Text>
                  <Text style={styles.dataValue}>{row.value}</Text>
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        <Button
          variant="secondary"
          size="lg"
          onPress={openQuestionnaire}
          disabled={!canEdit}
          accessibilityRole="button"
          accessibilityLabel="Editar dados do questionário"
          style={styles.editButton}
        >
          EDITAR DADOS DO QUESTIONÁRIO
        </Button>

        {logoutError ? (
          <Text style={styles.error} accessibilityRole="alert">
            {logoutError}
          </Text>
        ) : null}

        <Button
          variant="dangerOutline"
          size="lg"
          onPress={handleLogout}
          disabled={isLoggingOut || !canLogout}
          loading={isLoggingOut}
          accessibilityRole="button"
          accessibilityLabel="Sair da conta"
          style={styles.logoutButton}
        >
          {isLoggingOut ? 'Saindo...' : 'SAIR DA CONTA'}
        </Button>
      </ScrollView>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  header: {
    marginBottom: spacing.lg,
    gap: spacing.xs,
  },
  title: {
    ...typography.hero,
    color: colors.text.primary,
    marginTop: spacing.xs,
  },
  identityCard: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.background.elevated,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.background.surface,
    borderColor: colors.brand.primary,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    shadowColor: colors.brand.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarHead: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.brand.primaryLight,
  },
  avatarBody: {
    width: 42,
    height: 22,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    backgroundColor: colors.brand.primaryLight,
  },
  identityInfo: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  name: {
    ...typography.titleMedium,
    color: colors.text.primary,
    textAlign: 'center',
  },
  email: {
    ...typography.bodySmall,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.xxs,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  sectionSubtitle: {
    ...typography.caption,
    color: colors.text.muted,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  demoNotice: {
    ...typography.bodySmall,
    color: colors.text.secondary,
  },
  statistics: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  statCard: {
    flex: 1,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.background.surface,
    borderColor: colors.border.subtle,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  statValue: {
    ...typography.hero,
    color: colors.brand.primaryLight,
    fontWeight: '800',
  },
  statLabel: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.xxs,
  },
  questionnaireHeader: {
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.titleSmall,
    color: colors.text.primary,
  },
  successBanner: {
    backgroundColor: colors.semantic.successBg,
    borderColor: colors.semantic.success,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  successText: {
    ...typography.bodySmall,
    color: colors.semantic.success,
    fontWeight: '600',
  },
  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.background.surface,
    borderColor: colors.border.subtle,
  },
  loadingText: {
    ...typography.body,
    color: colors.text.secondary,
  },
  errorCard: {
    backgroundColor: colors.semantic.dangerBg,
    borderColor: colors.semantic.danger,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  error: {
    ...typography.bodySmall,
    color: colors.semantic.danger,
    lineHeight: 20,
  },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  pendingCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.background.surface,
    borderColor: colors.border.subtle,
  },
  questionnaireSections: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  sectionCard: {
    backgroundColor: colors.background.surface,
    borderColor: colors.border.subtle,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  cardHeaderTitle: {
    ...typography.labelSmall,
    color: colors.brand.primaryLight,
    fontWeight: '700',
    marginBottom: spacing.sm,
    letterSpacing: 0.5,
  },
  dataRow: {
    paddingVertical: spacing.xs,
    gap: 2,
  },
  dataRowBorder: {
    borderTopColor: colors.border.subtle,
    borderTopWidth: 1,
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
  },
  dataLabel: {
    ...typography.caption,
    color: colors.text.secondary,
  },
  dataValue: {
    ...typography.body,
    color: colors.text.primary,
    fontWeight: '600',
  },
  gameChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  gameChip: {
    marginRight: 0,
  },
  editButton: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  logoutButton: {
    marginTop: spacing.sm,
  },
});
