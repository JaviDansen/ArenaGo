import { StatusBar } from 'expo-status-bar';
import { useContext } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthBackground, Badge, Button, Card } from '../../components/ui';
import { AuthContext } from '../../context/AuthContext';
import { colors, spacing, typography } from '../../theme';

export default function HomeScreen({ navigation, returnState, mode = 'ready', message, onRetry }) {
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
          <View style={styles.brandRow}>
            <Text style={styles.brandArena}>Arena</Text>
            <Text style={styles.brandGo}>GO</Text>
          </View>
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
            <View style={styles.brandRow}>
              <Text style={styles.brandArena}>Arena</Text>
              <Text style={styles.brandGo}>GO</Text>
            </View>
            <Badge label="ONLINE" variant="brand" />
          </View>

          <View style={styles.greetingSection}>
            <Text style={styles.welcome}>
              {firstName ? `Olá, ${firstName}!` : 'Bem-vindo ao ArenaGo!'}
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
          {returnState?.pendingEvaluationParticipationIds?.length > 0 ? (
            <Card variant="elevated" style={styles.noticeCard}>
              <Badge label="AVALIAÇÃO PENDENTE" variant="warning" />
              <Text style={styles.noticeText}>
                Você possui {returnState.pendingEvaluationParticipationIds.length} avaliação(ões) pendente(s).
              </Text>
              <Pressable
                onPress={() => navigation.navigate('Eventos')}
                accessibilityRole="button"
                accessibilityLabel="Abrir avaliações pendentes na aba Eventos"
                style={styles.inlineAction}
              >
                <Text style={styles.inlineActionText}>Ver eventos e avaliações →</Text>
              </Pressable>
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

          <View style={styles.sectionBlock}>
            <Text style={styles.sectionLabel}>STATUS DE PARTICIPAÇÃO</Text>
            <Card variant="default" style={styles.participationCard} testID="home-empty-participation-card">
              <Badge label="SEM PARTICIPAÇÃO ATIVA" variant="default" />
              <Text style={styles.participationTitle}>Nenhuma participação ativa no momento</Text>
              <Text style={styles.participationSubtitle}>
                Você não está aguardando em uma fila nem em atendimento. Use o botão acima quando estiver em um evento.
              </Text>
              <Pressable
                style={styles.inlineAction}
                onPress={() => navigation.navigate('Eventos')}
                accessibilityRole="button"
                accessibilityLabel="Consultar histórico de eventos"
              >
                <Text style={styles.inlineActionText}>Consultar histórico na aba Eventos →</Text>
              </Pressable>
            </Card>
          </View>

          <Button
            title="Área Admin (demonstração)"
            variant="ghost"
            onPress={() => navigation.navigate('AdminDemo')}
            style={styles.staffButton}
          />
        </ScrollView>
      )}
    </AuthBackground>
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
    marginBottom: spacing.xxl,
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
  sectionBlock: {
    marginBottom: spacing.xl,
  },
  sectionLabel: {
    ...typography.tag,
    color: colors.text.muted,
    marginBottom: spacing.md,
  },
  participationCard: {
    alignItems: 'flex-start',
  },
  participationTitle: {
    ...typography.titleSmall,
    color: colors.text.primary,
    marginTop: spacing.md,
  },
  participationSubtitle: {
    ...typography.body,
    color: colors.text.secondary,
    marginTop: spacing.sm,
  },
  inlineAction: {
    minHeight: 48,
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  inlineActionText: {
    ...typography.body,
    color: colors.brand.primaryLight,
    fontWeight: '700',
  },
});
