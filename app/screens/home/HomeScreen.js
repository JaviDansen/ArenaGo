import { StatusBar } from 'expo-status-bar';
import { useContext } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthBackground, Badge, Button, Card } from '../../components/ui';
import { AuthContext } from '../../context/AuthContext';
import { colors, radii, spacing, typography } from '../../theme';
import { describePendingEvaluation, describeRecentParticipation } from '../../utils/homeOverview';

const TUTORIAL_STEPS = [
  { icon: '📷', title: 'Acesse o evento', text: 'Escaneie o QR Code ou digite o código.' },
  { icon: '🎮', title: 'Participe das experiências', text: 'Entre nas filas e aguarde sua vez.' },
  { icon: '⭐', title: 'Avalie a sua experiência', text: 'Ao final, conte como foi participar.' },
];

export default function HomeScreen({ navigation, returnState, overview, mode = 'ready', message, onRetry }) {
  const auth = useContext(AuthContext);
  const hasPendingQuestionnaire =
    auth?.user != null && auth.user.hasCompletedQuestionnaire === false;
  const rawName = typeof auth?.user?.name === 'string' ? auth.user.name.trim() : '';
  const firstName = rawName ? rawName.split(/\s+/)[0] : '';

  return (
    <AuthBackground variant="login" overlayOpacity={0.65} testID="home-background">
      <StatusBar style="light" />
      {mode === 'loading' || mode === 'error' ? (
        <View style={styles.stateScreen}>
          <Brand />
          <Card variant="elevated" style={styles.stateCard}>
            {mode === 'loading' ? (
              <>
                <ActivityIndicator size="small" color={colors.brand.primaryLight} />
                <Text style={styles.stateTitle}>Carregando sua participação</Text>
                <Text style={styles.stateText}>Estamos consultando o servidor do evento.</Text>
              </>
            ) : (
              <>
                <Badge label="ATENÇÃO" variant="danger" />
                <Text style={styles.stateTitle}>Não foi possível atualizar</Text>
                <Text style={styles.stateText}>{message}</Text>
                <Button title="Tentar novamente" variant="secondary" onPress={onRetry} style={styles.stateAction} />
              </>
            )}
          </Card>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <Brand />
          </View>

          <View style={styles.greetingSection}>
            <Text style={styles.welcome} numberOfLines={2} accessibilityRole="header">
              {firstName ? `Olá, ${firstName}!` : 'Olá!'}
            </Text>
            <Text style={styles.description}>
              Acompanhe suas experiências e gerencie sua participação nos eventos presenciais.
            </Text>
          </View>

          {returnState?.recentFinalization ? (
            <Card variant="elevated" style={styles.noticeCard}>
              <Badge label="PARTICIPAÇÃO ENCERRADA" variant="success" />
              <Text style={styles.noticeText}>Sua participação recente foi encerrada.</Text>
            </Card>
          ) : null}

          {hasPendingQuestionnaire ? (
            <Card variant="elevated" style={styles.noticeCard} testID="home-pending-questionnaire-banner">
              <Badge label="PERFIL INCOMPLETO" variant="warning" />
              <Text style={styles.noticeTitle}>Seu questionário de perfil ainda está pendente.</Text>
              <Text style={styles.noticeText}>
                Conclua o questionário para personalizar sua experiência na Arena.
              </Text>
              <Button
                title="Completar questionário de perfil"
                variant="secondary"
                onPress={() => navigation.navigate('ProfileQuestionnaire', { user: auth.user })}
                style={styles.noticeAction}
              />
            </Card>
          ) : null}

          <Card variant="highlight" style={styles.heroCard} testID="home-event-entry-card">
            <Badge label="ACESSO À ARENA" variant="brand" />
            <Text style={styles.heroTitle}>Pronto para jogar?</Text>
            <Text style={styles.heroDescription}>
              Escaneie o QR Code ou digite o código de acesso disponibilizado pela equipe do evento para iniciar sua participação.
            </Text>
            <Button
              title="Entrar em um evento"
              variant="primary"
              onPress={() => navigation.navigate('EventEntry')}
              style={styles.eventButton}
            />
          </Card>

          <PendingEvaluationCard overview={overview} navigation={navigation} />
          <OverviewSection overview={overview} navigation={navigation} />
        </ScrollView>
      )}
    </AuthBackground>
  );
}

function Brand() {
  return (
    <View style={styles.brandRow} accessibilityLabel="ArenaGo">
      <Text style={styles.brandArena}>Arena</Text>
      <Text style={styles.brandGo}>GO</Text>
    </View>
  );
}

function PendingEvaluationCard({ overview, navigation }) {
  if (overview?.status !== 'history') return null;
  const pending = describePendingEvaluation(overview.pending, overview.recent);
  if (!pending) return null;
  const open = pending.kind === 'single'
    ? () => navigation.navigate('RealEvaluation', {
      participationId: pending.item.participationId, historyItem: pending.item,
    })
    : () => navigation.navigate('Eventos');
  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => [styles.pendingCard, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Avaliação pendente. ${pending.text}`}
      accessibilityHint={pending.kind === 'single' ? 'Abre a avaliação desta participação' : 'Abre a aba Eventos'}
      testID="home-pending-evaluation-card"
    >
      <View style={styles.pendingIcon}><Text style={styles.iconText}>⭐</Text></View>
      <View style={styles.flexText}>
        <Text style={styles.pendingTitle}>Avaliação pendente</Text>
        <Text style={styles.pendingText}>{pending.text}</Text>
      </View>
      <Text style={styles.chevron} importantForAccessibility="no">›</Text>
    </Pressable>
  );
}

function OverviewSection({ overview, navigation }) {
  if (!overview) return null;

  if (overview.status === 'loading') {
    return (
      <Card variant="default" style={styles.overviewStateCard} testID="home-overview-loading">
        <ActivityIndicator size="small" color={colors.brand.primaryLight} />
        <Text style={styles.stateText}>Carregando suas participações...</Text>
      </Card>
    );
  }

  if (overview.status === 'error') {
    return (
      <Card variant="default" style={styles.overviewStateCard} testID="home-overview-error">
        <Badge label="HISTÓRICO INDISPONÍVEL" variant="danger" />
        <Text style={styles.stateText}>
          {overview.error === 'network'
            ? 'Não foi possível conectar ao servidor para consultar suas participações.'
            : overview.error === 'authorization'
              ? 'Não foi possível autorizar a consulta das suas participações.'
              : 'Não foi possível consultar suas participações agora.'}
        </Text>
        <Button title="Tentar novamente" variant="secondary" onPress={overview.retry} style={styles.stateAction} />
      </Card>
    );
  }

  if (overview.status === 'empty') {
    return (
      <View testID="home-first-access">
        <Text style={styles.sectionTitle} accessibilityRole="header">Como funciona?</Text>
        <Text style={styles.sectionSubtitle}>Veja o passo a passo para participar de um evento:</Text>
        <Card variant="default" style={styles.tutorialCard}>
          {TUTORIAL_STEPS.map((step, index) => (
            <View
              key={step.title}
              style={[styles.stepRow, index > 0 && styles.stepDivider]}
              accessible
              accessibilityLabel={`Passo ${index + 1}: ${step.title}. ${step.text}`}
            >
              <View style={styles.stepIcon}><Text style={styles.iconText}>{step.icon}</Text></View>
              <View style={styles.flexText}>
                <Text style={styles.stepTitle}>{index + 1}. {step.title}</Text>
                <Text style={styles.stepText}>{step.text}</Text>
              </View>
            </View>
          ))}
        </Card>
        <View style={styles.emptyState} testID="home-empty-history">
          <Text style={styles.emptyIcon} importantForAccessibility="no">🎮</Text>
          <Text style={styles.emptyTitle}>Você ainda não participou de nenhum evento.</Text>
          <Text style={styles.emptyText}>Quando participar, suas experiências aparecerão aqui.</Text>
        </View>
      </View>
    );
  }

  if (overview.status !== 'history') return null;
  const recent = describeRecentParticipation(overview.recent);
  return (
    <View testID="home-recent-section">
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Evento recente</Text>
        <Pressable
          onPress={() => navigation.navigate('Eventos')}
          style={styles.seeAll}
          accessibilityRole="button"
          accessibilityLabel="Ver todos os eventos"
          testID="home-see-all-events"
        >
          <Text style={styles.seeAllText}>Ver todos</Text>
        </Pressable>
      </View>
      <Pressable
        onPress={() => navigation.navigate('ParticipationDetails', {
          participationId: overview.recent.participationId, historyItem: overview.recent,
        })}
        style={({ pressed }) => [styles.recentCard, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={[recent.eventName, recent.date, recent.time, recent.statusLabel].filter(Boolean).join(', ')}
        accessibilityHint="Abre os detalhes desta participação"
        testID="home-recent-event-card"
      >
        <View style={styles.recentIcon}><Text style={styles.iconText}>🎮</Text></View>
        <View style={styles.flexText}>
          <Text style={styles.recentName} numberOfLines={2}>{recent.eventName}</Text>
          {recent.date ? (
            <Text style={styles.recentMeta}>
              📅 {recent.date}{recent.time ? `   🕒 ${recent.time}` : ''}
            </Text>
          ) : null}
          <View style={styles.recentBadge}>
            <Badge label={recent.statusLabel.toUpperCase()} variant={recent.statusVariant} />
          </View>
        </View>
        <Text style={styles.chevron} importantForAccessibility="no">›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  stateScreen: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.layout.screenPaddingHorizontal,
  },
  stateCard: {
    marginTop: spacing.xxl,
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  stateTitle: {
    ...typography.titleMedium,
    color: colors.text.primary,
    marginTop: spacing.sm,
  },
  stateText: {
    ...typography.body,
    color: colors.text.secondary,
  },
  stateAction: {
    alignSelf: 'stretch',
    marginTop: spacing.md,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.layout.screenPaddingHorizontal,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  brandArena: {
    color: colors.text.primary,
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  brandGo: {
    color: colors.brand.primaryLight,
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  greetingSection: {
    marginTop: spacing.xxxl,
    marginBottom: spacing.xxl,
  },
  welcome: {
    ...typography.hero,
    color: colors.text.primary,
  },
  description: {
    ...typography.bodyLarge,
    color: colors.text.secondary,
    marginTop: spacing.sm,
  },
  noticeCard: {
    marginBottom: spacing.lg,
  },
  noticeTitle: {
    ...typography.titleSmall,
    color: colors.text.primary,
    marginTop: spacing.md,
  },
  noticeText: {
    ...typography.body,
    color: colors.text.secondary,
    marginTop: spacing.sm,
  },
  noticeAction: {
    marginTop: spacing.md,
  },
  heroCard: {
    marginBottom: spacing.xl,
  },
  heroTitle: {
    ...typography.titleLarge,
    color: colors.text.primary,
    marginTop: spacing.lg,
  },
  heroDescription: {
    ...typography.body,
    color: colors.text.secondary,
    marginTop: spacing.sm,
  },
  eventButton: {
    marginTop: spacing.xl,
  },
  pressed: {
    opacity: 0.8,
  },
  pendingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    gap: spacing.md,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.semantic.warning,
    backgroundColor: colors.semantic.warningBg,
  },
  pendingIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.elevated,
  },
  pendingTitle: {
    ...typography.titleSmall,
    color: colors.text.primary,
  },
  pendingText: {
    ...typography.body,
    color: colors.text.secondary,
    marginTop: spacing.xxs,
  },
  iconText: {
    fontSize: 20,
  },
  flexText: {
    flex: 1,
    minWidth: 0,
  },
  chevron: {
    color: colors.brand.primaryLight,
    fontSize: 28,
    fontWeight: '600',
  },
  overviewStateCard: {
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.titleMedium,
    color: colors.text.primary,
  },
  sectionSubtitle: {
    ...typography.body,
    color: colors.text.secondary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  seeAll: {
    minHeight: 48,
    minWidth: 48,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  seeAllText: {
    ...typography.body,
    color: colors.brand.primaryLight,
    fontWeight: '700',
  },
  tutorialCard: {
    paddingVertical: spacing.sm,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  stepDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  stepIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.primaryDim,
    borderWidth: 1,
    borderColor: colors.brand.primary,
  },
  stepTitle: {
    ...typography.titleSmall,
    color: colors.text.primary,
  },
  stepText: {
    ...typography.body,
    color: colors.text.secondary,
    marginTop: spacing.xxs,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.titleSmall,
    color: colors.text.primary,
    textAlign: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  recentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.background.surface,
  },
  recentIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.primaryDim,
    borderWidth: 1,
    borderColor: colors.brand.primary,
  },
  recentName: {
    ...typography.titleSmall,
    color: colors.text.primary,
  },
  recentMeta: {
    ...typography.bodySmall,
    color: colors.text.secondary,
    marginTop: spacing.xs,
  },
  recentBadge: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
});
