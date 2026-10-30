import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthBackground } from '../../components/ui/AuthBackground';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { colors, spacing, typography } from '../../theme';

// =============================================================================
// ESTRUTURA PROVISÓRIA (TASK 2 / UI-02.4 / UI-02A):
// A recuperação de senha real depende de integração futura de backend e serviço
// de mensageria. Esta tela aplica o Design System oficial mantendo explícita
// a indisponibilidade atual do envio de e-mail, sem simular envio ou exibir
// confirmação falsa.
// =============================================================================
export default function ForgotPasswordScreen({ navigation }) {
  function handleReturnToLogin() {
    if (navigation && typeof navigation.goBack === 'function') {
      navigation.goBack();
    } else if (navigation && typeof navigation.navigate === 'function') {
      navigation.navigate('Login');
    }
  }

  return (
    <AuthBackground variant="forgotPassword" testID="forgot-password-background">
      <StatusBar style="light" />

      <ScreenHeader
        title="ArenaGO"
        onBack={handleReturnToLogin}
        testID="forgot-password-header"
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroHeader}>
          <Text style={styles.title}>Recuperar acesso</Text>
          <Text style={styles.subtitle}>
            A redefinição automática de senha estará disponível em uma próxima etapa do projeto.
          </Text>
        </View>

        <Card
          variant="elevated"
          padding={spacing.xl}
          style={styles.statusCard}
          testID="forgot-password-status-card"
        >
          <Badge
            label="EM CONSTRUÇÃO"
            variant="warning"
            size="md"
            style={styles.statusBadge}
          />
          <Text style={styles.cardTitle}>
            Recuperação por e-mail indisponível nesta versão
          </Text>
          <Text style={styles.cardText}>
            O envio de instruções de recuperação será habilitado assim que o serviço de redefinição estiver integrado ao servidor.
          </Text>
          <View style={styles.cardDivider} />
          <Text style={styles.cardHint}>
            Caso precise de auxílio imediato durante o evento, procure a equipe de atendimento presencial na ArenaGO.
          </Text>
        </Card>

        <Button
          title="Voltar para o Login"
          variant="primary"
          size="lg"
          fullWidth
          onPress={handleReturnToLogin}
          accessibilityLabel="Voltar para o Login"
          testID="forgot-password-return-button"
        />
      </ScrollView>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.layout.screenPaddingHorizontal,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  heroHeader: {
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.hero,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.bodyLarge,
    color: colors.text.secondary,
  },
  statusCard: {
    backgroundColor: 'rgba(22, 22, 38, 0.90)',
    marginBottom: spacing.xxl,
    gap: spacing.md,
  },
  statusBadge: {
    marginBottom: spacing.xxs,
  },
  cardTitle: {
    ...typography.titleMedium,
    color: colors.text.primary,
  },
  cardText: {
    ...typography.body,
    color: colors.text.secondary,
  },
  cardDivider: {
    height: 1,
    backgroundColor: colors.border.subtle,
    marginVertical: spacing.xxs,
  },
  cardHint: {
    ...typography.bodySmall,
    color: colors.text.muted,
  },
});
