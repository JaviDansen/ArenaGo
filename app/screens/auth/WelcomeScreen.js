import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { colors, radii, spacing, typography } from '../../theme';

export default function WelcomeScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Cabeçalho institucional ArenaGO */}
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.brandDot} />
            <Text style={styles.headerBrand} accessibilityRole="header">
              ArenaGO
            </Text>
          </View>
          <Badge label="ARENA OFICIAL" variant="brand" size="sm" />
        </View>

        {/* Seção central de destaque da marca */}
        <View style={styles.content}>
          <View style={styles.heroEmblemWrapper}>
            <View style={styles.heroGlowRing}>
              <View style={styles.logoBadge}>
                <Text style={styles.logoBadgeText} allowFontScaling={false}>
                  A
                </Text>
              </View>
            </View>
          </View>

          <Text style={styles.tag}>PRIMEIROS PASSOS</Text>
          <Text style={styles.title}>Viva a experiência ArenaGO.</Text>
          <Text style={styles.subtitle}>
            Conecte-se para participar de eventos, competições e acompanhar toda a arena em tempo real.
          </Text>

          <Card variant="elevated" padding={spacing.lg} style={styles.highlightsCard}>
            <View style={styles.highlightItem}>
              <View style={styles.highlightBullet} />
              <Text style={styles.highlightText}>
                Entre nas filas e receba alertas quando chegar a sua vez de jogar
              </Text>
            </View>
            <View style={styles.highlightDivider} />
            <View style={styles.highlightItem}>
              <View style={styles.highlightBullet} />
              <Text style={styles.highlightText}>
                Acompanhe seu histórico de participações e avalie cada arena
              </Text>
            </View>
          </Card>
        </View>

        {/* Ações principais de autenticação */}
        <View style={styles.actions}>
          <Button
            title="Criar minha conta"
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => navigation.navigate('Register')}
            accessibilityLabel="Criar minha conta"
            testID="welcome-register-button"
          />

          <Button
            title="Já possuo uma conta"
            variant="secondary"
            size="lg"
            fullWidth
            onPress={() => navigation.navigate('Login')}
            accessibilityLabel="Já possuo uma conta"
            testID="welcome-login-button"
          />
        </View>
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.layout.screenPaddingHorizontal,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  brandDot: {
    width: 8,
    height: 8,
    borderRadius: radii.full,
    backgroundColor: colors.brand.primary,
  },
  headerBrand: {
    color: colors.text.primary,
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
    fontWeight: typography.weights.extraBold,
    letterSpacing: 1.2,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  heroEmblemWrapper: {
    alignItems: 'flex-start',
    marginBottom: spacing.xxl,
  },
  heroGlowRing: {
    padding: spacing.xs + 2,
    borderRadius: radii.xxl,
    backgroundColor: colors.brand.primaryDim,
    borderWidth: 1,
    borderColor: colors.border.focus,
  },
  logoBadge: {
    width: 68,
    height: 68,
    borderRadius: radii.xl,
    backgroundColor: colors.brand.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoBadgeText: {
    color: colors.text.onBrand,
    fontSize: typography.sizes.hero,
    lineHeight: typography.lineHeights.hero,
    fontWeight: typography.weights.extraBold,
  },
  tag: {
    ...typography.tag,
    color: colors.brand.primaryLight,
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.hero,
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  subtitle: {
    ...typography.bodyLarge,
    color: colors.text.secondary,
    marginBottom: spacing.xxl,
  },
  highlightsCard: {
    gap: spacing.md,
  },
  highlightItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  highlightBullet: {
    width: 6,
    height: 6,
    borderRadius: radii.full,
    backgroundColor: colors.brand.primaryLight,
    flexShrink: 0,
  },
  highlightText: {
    ...typography.bodySmall,
    color: colors.text.secondary,
    flex: 1,
  },
  highlightDivider: {
    height: 1,
    backgroundColor: colors.border.subtle,
  },
  actions: {
    gap: spacing.md,
    paddingTop: spacing.md,
  },
});
