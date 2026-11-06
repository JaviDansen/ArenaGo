import { StatusBar } from 'expo-status-bar';
import { useContext, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { AuthBackground, Badge, Button, Card } from '../../components/ui';
import { AuthContext } from '../../context/AuthContext';
import { ParticipationContext } from '../../context/ParticipationContext';
import { colors, radii, spacing, typography } from '../../theme';

export default function HomeScreen({ navigation, route }) {
  const auth = typeof useContext === 'function' ? useContext(AuthContext) : null;
  const participationContext =
    typeof useContext === 'function' ? useContext(ParticipationContext) : null;

  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState(null);

  const windowDims =
    typeof useWindowDimensions === 'function'
      ? useWindowDimensions()
      : { width: 390, height: 844 };
  const isSmallScreen = windowDims.width <= 340 || windowDims.height <= 600;

  const hasPendingQuestionnaire =
    auth?.user != null && auth.user.hasCompletedQuestionnaire === false;

  const rawParticipation =
    route?.params?.participation !== undefined
      ? route.params.participation
      : participationContext?.participation !== undefined
      ? participationContext.participation
      : null;

  const isLoading =
    isRetrying ||
    Boolean(auth?.isInitializing) ||
    route?.params?.isLoading === true;

  const errorMessage =
    retryError ||
    auth?.networkError ||
    auth?.storageError ||
    route?.params?.error ||
    null;

  const rawName = typeof auth?.user?.name === 'string' ? auth.user.name.trim() : '';
  const firstName = rawName ? rawName.split(/\s+/)[0] : '';

  const eventName =
    rawParticipation?.event?.name ||
    rawParticipation?.eventName ||
    'Arena';

  const headerBadgeProps = isLoading
    ? { label: 'SINCRONIZANDO', variant: 'info' }
    : errorMessage
    ? { label: 'ATENÇÃO', variant: 'danger' }
    : rawParticipation?.status === 'finished'
    ? { label: 'CONCLUÍDO', variant: 'success' }
    : rawParticipation?.status === 'active'
    ? { label: 'ARENA ATIVA', variant: 'success' }
    : rawParticipation?.status === 'waiting'
    ? { label: 'NA FILA', variant: 'brand' }
    : { label: 'ONLINE', variant: 'brand' };

  async function handleRetry() {
    if (isRetrying) return;
    setRetryError(null);
    setIsRetrying(true);
    try {
      if (typeof auth?.fetchCurrentUser === 'function') {
        await auth.fetchCurrentUser();
      } else if (typeof auth?.restoreSession === 'function') {
        await auth.restoreSession();
      }
    } catch (err) {
      setRetryError(
        err?.detail ||
        err?.message ||
        'Não foi possível restabelecer a conexão com o servidor. Tente novamente.'
      );
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <AuthBackground
      variant="login"
      overlayOpacity={0.65}
      useSafeArea
      testID="home-background"
    >
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          isSmallScreen && styles.scrollContentSmall,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Cabeçalho da marca e saudação do participante */}
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <Text style={styles.brandArena}>Arena</Text>
            <Text style={styles.brandGo}>GO</Text>
          </View>
          <Badge
            label={headerBadgeProps.label}
            variant={headerBadgeProps.variant}
          />
        </View>

        <View style={styles.greetingSection}>
          <Text style={[styles.welcome, isSmallScreen && styles.welcomeSmall]}>
            {firstName ? `Olá, ${firstName}!` : 'Bem-vindo ao ArenaGo!'}
          </Text>
          <Text style={styles.description}>
            Acompanhe suas experiências, entre em filas virtuais e gerencie sua participação na arena.
          </Text>
        </View>

        {/* Estado de carregamento */}
        {isLoading ? (
          <Card
            variant="elevated"
            style={styles.stateCard}
            testID="home-loading-card"
          >
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.brand.primaryLight} />
              <Text style={styles.loadingText}>
                Sincronizando informações da sua conta...
              </Text>
            </View>
          </Card>
        ) : null}

        {/* Estado de erro */}
        {errorMessage ? (
          <View
            style={styles.errorBanner}
            accessible
            accessibilityRole="alert"
            testID="home-error-banner"
          >
            <View style={styles.errorHeaderRow}>
              <Badge label="ERRO DE COMUNICAÇÃO" variant="danger" />
            </View>
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
            <Pressable
              style={[styles.retryButton, isRetrying && styles.buttonDisabled]}
              onPress={handleRetry}
              disabled={isRetrying}
              accessibilityRole="button"
              accessibilityLabel="Tentar sincronizar dados novamente"
            >
              {isRetrying ? (
                <ActivityIndicator size="small" color={colors.text.primary} />
              ) : (
                <Text style={styles.retryButtonText}>Tentar novamente</Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {/* Alerta de questionário pendente (preservado para compatibilidade) */}
        {hasPendingQuestionnaire ? (
          <View
            style={styles.questionnaireBanner}
            testID="home-pending-questionnaire-banner"
          >
            <View style={styles.bannerBadgeRow}>
              <Badge label="PERFIL INCOMPLETO" variant="warning" />
            </View>
            <Text style={styles.questionnaireBannerTitle}>
              Seu questionário de perfil ainda está pendente.
            </Text>
            <Text style={styles.questionnaireBannerText}>
              Conclua o questionário para personalizar sua experiência na Arena.
            </Text>
            <Button
              title="Completar questionário de perfil"
              variant="secondary"
              onPress={() =>
                navigation.navigate('ProfileQuestionnaire', {
                  user: auth.user,
                })
              }
              style={styles.questionnaireButton}
            />
          </View>
        ) : null}

        {/* Card principal de entrada em evento */}
        <Card
          variant="highlighted"
          style={styles.heroCard}
          testID="home-event-entry-card"
        >
          <View style={styles.heroTopRow}>
            <Badge label="ACESSO À ARENA" variant="brand" />
            <Text style={styles.heroTagMono}>CHECK-IN</Text>
          </View>
          <Text style={styles.heroTitle}>Pronto para jogar?</Text>
          <Text style={styles.heroDescription}>
            Informe o código disponibilizado na estação do evento para entrar na fila virtual e acompanhar sua chamada.
          </Text>
          <Button
            title="Entrar em um evento"
            variant="primary"
            onPress={() => navigation.navigate('EventEntry')}
            style={styles.eventButton}
          />
        </Card>

        {/* Seção de estado atual de participação */}
        <View style={styles.sectionBlock}>
          <Text style={styles.sectionLabel}>STATUS DE PARTICIPAÇÃO</Text>

          {!rawParticipation ? (
            <Card
              variant="default"
              style={styles.participationCard}
              testID="home-empty-participation-card"
            >
              <View style={styles.participationHeaderRow}>
                <Badge label="SEM FILA ATIVA" variant="default" />
              </View>
              <Text style={styles.participationTitle}>
                Nenhuma participação ativa no momento
              </Text>
              <Text style={styles.participationSubtitle}>
                Você não está aguardando em nenhuma fila nem em atendimento em uma arena. Use o botão acima quando estiver em um evento.
              </Text>
              <Pressable
                style={styles.inlineActionButton}
                onPress={() => navigation.navigate('Eventos')}
                accessibilityRole="button"
                accessibilityLabel="Consultar histórico de eventos"
              >
                <Text style={styles.inlineActionText}>
                  Consultar histórico na aba Eventos →
                </Text>
              </Pressable>
            </Card>
          ) : rawParticipation.status === 'finished' ? (
            <Card
              variant="elevated"
              style={styles.participationCard}
              testID="home-finished-participation-card"
            >
              <View style={styles.participationHeaderRow}>
                <Badge label="PARTICIPAÇÃO CONCLUÍDA" variant="success" />
              </View>
              <Text style={styles.participationTitle}>{eventName}</Text>
              <Text style={styles.participationSubtitle}>
                Sua participação anterior na arena foi encerrada. Você pode conferir o histórico completo na aba Eventos ou ingressar em uma nova experiência.
              </Text>
              <Pressable
                style={styles.inlineActionButton}
                onPress={() => navigation.navigate('Eventos')}
                accessibilityRole="button"
                accessibilityLabel="Ver histórico de participações"
              >
                <Text style={styles.inlineActionText}>
                  Ver histórico de participações →
                </Text>
              </Pressable>
            </Card>
          ) : (
            <Card
              variant="highlighted"
              style={styles.participationCard}
              testID="home-active-participation-card"
            >
              <View style={styles.participationHeaderRow}>
                <Badge
                  label={
                    rawParticipation.status === 'active'
                      ? 'EM ATENDIMENTO'
                      : 'AGUARDANDO NA FILA'
                  }
                  variant={
                    rawParticipation.status === 'active' ? 'success' : 'brand'
                  }
                />
              </View>
              <Text style={styles.participationTitle}>{eventName}</Text>
              <Text style={styles.participationSubtitle}>
                {rawParticipation.status === 'active'
                  ? 'Sua sessão na arena está ativa no momento.'
                  : 'Você está posicionado na fila virtual deste evento.'}
              </Text>
            </Card>
          )}
        </View>
      </ScrollView>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  scrollContentSmall: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  brandArena: {
    color: colors.text.primary,
    fontFamily: typography.fontFamily,
    fontSize: typography.sizes.titleLarge,
    fontWeight: typography.weights.extraBold,
    letterSpacing: -0.4,
  },
  brandGo: {
    color: colors.brand.primaryLight,
    fontFamily: typography.fontFamily,
    fontSize: typography.sizes.titleLarge,
    fontWeight: typography.weights.extraBold,
    letterSpacing: -0.4,
    marginLeft: 2,
  },
  greetingSection: {
    gap: spacing.xs,
  },
  welcome: {
    ...typography.hero,
    color: colors.text.primary,
  },
  welcomeSmall: {
    fontSize: typography.sizes.titleLarge,
    lineHeight: typography.lineHeights.titleLarge,
  },
  description: {
    ...typography.body,
    color: colors.text.secondary,
  },
  stateCard: {
    padding: spacing.md,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    ...typography.body,
    color: colors.text.secondary,
    flex: 1,
  },
  errorBanner: {
    backgroundColor: colors.semantic.dangerBg,
    borderColor: colors.semantic.danger,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  errorHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorBannerText: {
    ...typography.body,
    color: colors.text.primary,
  },
  retryButton: {
    alignSelf: 'flex-start',
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: colors.background.elevated,
    borderWidth: 1,
    borderColor: colors.semantic.danger,
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryButtonText: {
    ...typography.caption,
    color: colors.text.primary,
    fontWeight: typography.weights.bold,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  questionnaireBanner: {
    backgroundColor: colors.semantic.warningBg,
    borderColor: colors.semantic.warning,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
  },
  bannerBadgeRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  questionnaireBannerTitle: {
    ...typography.titleSmall,
    color: colors.text.primary,
    fontWeight: typography.weights.bold,
  },
  questionnaireBannerText: {
    ...typography.body,
    color: colors.text.secondary,
  },
  questionnaireButton: {
    marginTop: spacing.sm,
  },
  heroCard: {
    gap: spacing.sm,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  heroTagMono: {
    ...typography.tag,
    color: colors.brand.primaryLight,
  },
  heroTitle: {
    ...typography.titleMedium,
    color: colors.text.primary,
    marginTop: 2,
  },
  heroDescription: {
    ...typography.body,
    color: colors.text.secondary,
  },
  eventButton: {
    marginTop: spacing.xs,
  },
  sectionBlock: {
    gap: spacing.sm,
  },
  sectionLabel: {
    ...typography.tag,
    color: colors.brand.primaryLight,
  },
  participationCard: {
    gap: spacing.xs,
  },
  participationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  participationTitle: {
    ...typography.titleSmall,
    color: colors.text.primary,
    fontWeight: typography.weights.bold,
  },
  participationSubtitle: {
    ...typography.body,
    color: colors.text.secondary,
  },
  inlineActionButton: {
    minHeight: 48,
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
  },
  inlineActionText: {
    ...typography.body,
    color: colors.brand.primaryLight,
    fontWeight: typography.weights.bold,
  }
});
