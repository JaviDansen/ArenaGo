import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthBackground } from '../../components/ui/AuthBackground';
import { Button } from '../../components/ui/Button';
import { colors, spacing, typography } from '../../theme';

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
        <View style={styles.header} />

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
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  artworkStage: {
    flex: 1,
    minHeight: 120,
  },
  bottomSection: {
    gap: spacing.xl,
    paddingTop: spacing.lg,
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
    backgroundColor: 'rgba(13, 13, 24, 0.84)',
    borderColor: colors.border.input,
  },
});
