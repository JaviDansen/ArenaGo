import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { colors, spacing, typography } from '../../theme';

// =============================================================================
// ESTRUTURA PROVISÓRIA (TASK 2 / UI-02.4):
// A recuperação de senha real depende de integração futura de backend e serviço
// de mensageria. Esta tela aplica o Design System oficial (UI-01) mantendo
// explícita a indisponibilidade atual do envio de e-mail, sem simular envio
// ou exibir confirmação falsa.
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
    <SafeAreaView style={styles.container}>
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
          <Badge label="RECUPERAÇÃO" variant="brand" size="sm" style={styles.tagBadge} />
          <Text style={styles.title}>Recuperar acesso</Text>
          <Text style={styles.subtitle}>
            Em breve você poderá redefinir sua senha por aqui. O fluxo completo será definido nas próximas etapas do projeto.
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
            Esta página servirá para inserção do e-mail cadastrado e envio de instruções de recuperação de conta assim que o serviço de redefinição estiver integrado ao servidor.
          </Text>
          <View style={styles.cardDivider} />
          <Text style={styles.cardHint}>
            Caso precise de suporte imediato durante o evento, procure a equipe de atendimento presencial na ArenaGO.
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.base,
  },
  scrollView: {
    flex: 1,
    backgroundColor: colors.background.base,
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
  tagBadge: {
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.hero,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.bodyLarge,
    color: colors.text.secondary,
  },
  statusCard: {
    marginBottom: spacing.xxl,
    gap: spacing.md,
  },
  statusBadge: {
    marginBottom: spacing.xs,
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
    marginVertical: spacing.xs,
  },
  cardHint: {
    ...typography.bodySmall,
    color: colors.text.muted,
  },
});
