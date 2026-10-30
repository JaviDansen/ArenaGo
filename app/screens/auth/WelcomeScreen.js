import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthBackground } from '../../components/ui/AuthBackground';
import { Button } from '../../components/ui/Button';
import { colors, radii, spacing, typography } from '../../theme';

export default function WelcomeScreen({ navigation }) {
  return (
    <AuthBackground variant="welcome" testID="welcome-background">
      <StatusBar style="light" />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Marca oficial ArenaGO no topo */}
        <View style={styles.header}>
          <View style={styles.brandLockup}>
            <View style={styles.brandMark}>
              <View style={styles.brandMarkInner} />
            </View>
            <Text style={styles.brandWordmark} accessibilityRole="header">
              Arena<Text style={styles.brandWordmarkAccent}>GO</Text>
            </Text>
          </View>
        </View>

        {/* Área central livre para valorizar a composição artística de fundo */}
        <View style={styles.artworkStage} pointerEvents="none" />

        {/* Bloco editorial e ações principais na metade inferior */}
        <View style={styles.bottomSection}>
          <View style={styles.editorialBlock}>
            <Text style={styles.kicker}>EXPERIÊNCIA OFICIAL</Text>
            <Text style={styles.title}>Viva a experiência ArenaGO.</Text>
            <Text style={styles.subtitle}>
              Entre nos eventos, acompanhe suas filas em tempo real e registre todo o seu histórico na arena.
            </Text>
          </View>

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
              style={styles.secondaryButton}
              testID="welcome-login-button"
            />
          </View>
        </View>
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  brandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  brandMark: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    backgroundColor: colors.brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkInner: {
    width: 8,
    height: 8,
    borderRadius: radii.xs,
    backgroundColor: colors.text.primary,
  },
  brandWordmark: {
    fontFamily: typography.fontFamily,
    fontSize: typography.sizes.titleMedium,
    lineHeight: typography.lineHeights.titleMedium,
    fontWeight: typography.weights.extraBold,
    color: colors.text.primary,
    letterSpacing: 0.4,
  },
  brandWordmarkAccent: {
    fontFamily: typography.fontFamily,
    color: colors.brand.primaryLight,
    fontWeight: typography.weights.extraBold,
  },
  artworkStage: {
    flex: 1,
    minHeight: 180,
  },
  bottomSection: {
    gap: spacing.xxl,
    paddingTop: spacing.xl,
  },
  editorialBlock: {
    gap: spacing.sm,
  },
  kicker: {
    ...typography.tag,
    color: colors.brand.primaryLight,
  },
  title: {
    ...typography.hero,
    fontSize: 30,
    lineHeight: 38,
    color: colors.text.primary,
  },
  subtitle: {
    ...typography.bodyLarge,
    lineHeight: 24,
    color: colors.text.secondary,
  },
  actions: {
    gap: spacing.md,
  },
  secondaryButton: {
    backgroundColor: 'rgba(22, 22, 38, 0.88)',
    borderColor: colors.border.input,
  },
});
