import { StatusBar } from 'expo-status-bar';
import { useContext, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import {
  AuthBackground,
  Badge,
  Button,
  Card,
  InputField,
  ScreenHeader,
} from '../../components/ui';
import { ParticipationContext } from '../../context/ParticipationContext';
import { mockEvents } from '../../data/mockData';
import { colors, radii, spacing, typography } from '../../theme';

export default function EventEntryScreen({ navigation }) {
  const participationContext =
    typeof useContext === 'function' ? useContext(ParticipationContext) : null;
  const participation = participationContext?.participation ?? null;
  const hasCurrentParticipation =
    participation?.status === 'waiting' || participation?.status === 'active';

  const [eventCode, setEventCode] = useState('');
  const [errorMessage, setErrorMessage] = useState(null);

  const windowDims =
    typeof useWindowDimensions === 'function'
      ? useWindowDimensions()
      : { width: 390, height: 844 };
  const isSmallScreen = windowDims.width <= 340 || windowDims.height <= 600;

  function handleBack() {
    if (navigation && typeof navigation.goBack === 'function') {
      navigation.goBack();
    } else if (navigation && typeof navigation.navigate === 'function') {
      navigation.navigate('MainTabs');
    }
  }

  function handleChangeCode(value) {
    setEventCode(value);
    if (errorMessage) {
      setErrorMessage(null);
    }
  }

  function handleContinue() {
    if (hasCurrentParticipation) {
      setErrorMessage(
        'Você já possui uma participação em andamento. Conclua ou saia da participação atual antes de entrar em outro evento.'
      );
      return;
    }

    const normalizedCode =
      typeof eventCode === 'string' ? eventCode.trim().toUpperCase() : '';

    if (normalizedCode === '') {
      setErrorMessage('Informe o código do evento para continuar.');
      return;
    }

    const event = Object.prototype.hasOwnProperty.call(mockEvents, normalizedCode)
      ? mockEvents[normalizedCode]
      : null;

    if (!event) {
      setErrorMessage(
        'Código de evento não encontrado. Verifique o código informado na estação.'
      );
      return;
    }

    setErrorMessage(null);
    navigation.navigate('EventConfirmation', { event });
  }

  return (
    <AuthBackground
      variant="login"
      overlayOpacity={0.65}
      useSafeArea
      testID="event-entry-background"
    >
      <StatusBar style="light" />

      <ScreenHeader
        title="Entrar em um evento"
        onBack={handleBack}
        testID="event-entry-header"
      />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform?.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            isSmallScreen && styles.scrollContentSmall,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroSection}>
            <Text style={styles.kicker}>CHECK-IN PRESENCIAL</Text>
            <Text style={[styles.title, isSmallScreen && styles.titleSmall]}>
              Digite o código de acesso
            </Text>
            <Text style={styles.description}>
              Informe o código disponibilizado na recepção ou nas estações da Arena para iniciar sua participação.
            </Text>
          </View>

          {hasCurrentParticipation ? (
            <View
              style={styles.activeWarningBanner}
              accessible
              accessibilityRole="alert"
              testID="event-entry-active-participation-warning"
            >
              <View style={styles.badgeRow}>
                <Badge label="PARTICIPAÇÃO EM ANDAMENTO" variant="warning" />
              </View>
              <Text style={styles.warningTitle}>
                Você já possui uma participação ativa
              </Text>
              <Text style={styles.warningText}>
                Cada conta pode manter no máximo uma participação corrente por vez (incluindo espera na fila externa). Retorne ao evento atual para acompanhar sua sessão.
              </Text>
              <Button
                title="Voltar ao evento atual"
                variant="secondary"
                size="md"
                onPress={() => navigation?.navigate?.('MainTabs')}
                testID="event-entry-return-active-button"
              />
            </View>
          ) : null}

          <Card
            variant="highlighted"
            style={styles.formCard}
            testID="event-entry-form-card"
          >
            <View style={styles.cardHeaderRow}>
              <Badge label="CÓDIGO DO EVENTO" variant="brand" />
              <Text style={styles.manualTag}>MANUAL</Text>
            </View>

            <InputField
              label="Código de acesso"
              placeholder="Código do evento"
              value={eventCode}
              onChangeText={handleChangeCode}
              error={errorMessage}
              hint="Não diferencia maiúsculas de minúsculas (ex.: FILA ou LIVRE)."
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleContinue}
              maxLength={32}
              testID="event-entry-code-input"
            />

            <Button
              title="Continuar"
              variant="primary"
              size="lg"
              onPress={handleContinue}
              testID="event-entry-continue-button"
            />
          </Card>

          <Card
            variant="default"
            style={styles.demoCard}
            testID="event-entry-demo-card"
          >
            <View style={styles.badgeRow}>
              <Badge label="SIMULAÇÃO DE DESENVOLVIMENTO" variant="info" />
            </View>
            <Text style={styles.demoTitle}>
              Códigos demonstrativos disponíveis
            </Text>
            <Text style={styles.demoDescription}>
              Enquanto a integração com o backend de eventos não está ativa, utilize os códigos de desenvolvimento locais:
            </Text>
            <View style={styles.codePillsRow}>
              <View style={styles.codePill}>
                <Text style={styles.codePillKey}>FILA</Text>
                <Text style={styles.codePillDesc}>Com fila externa</Text>
              </View>
              <View style={styles.codePill}>
                <Text style={styles.codePillKey}>LIVRE</Text>
                <Text style={styles.codePillDesc}>Entrada direta</Text>
              </View>
            </View>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  scrollContentSmall: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  heroSection: {
    gap: spacing.xs,
  },
  kicker: {
    ...typography.tag,
    color: colors.brand.primaryLight,
  },
  title: {
    ...typography.hero,
    color: colors.text.primary,
  },
  titleSmall: {
    fontSize: typography.sizes.titleLarge,
    lineHeight: typography.lineHeights.titleLarge,
  },
  description: {
    ...typography.body,
    color: colors.text.secondary,
  },
  activeWarningBanner: {
    backgroundColor: colors.semantic.warningBg,
    borderColor: colors.semantic.warning,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  warningTitle: {
    ...typography.titleSmall,
    color: colors.text.primary,
    fontWeight: typography.weights.bold,
  },
  warningText: {
    ...typography.body,
    color: colors.text.secondary,
  },
  formCard: {
    gap: spacing.sm,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xxs,
  },
  manualTag: {
    ...typography.tag,
    color: colors.brand.primaryLight,
  },
  demoCard: {
    gap: spacing.xs,
  },
  demoTitle: {
    ...typography.titleSmall,
    color: colors.text.primary,
    fontWeight: typography.weights.bold,
    marginTop: 2,
  },
  demoDescription: {
    ...typography.bodySmall,
    color: colors.text.secondary,
  },
  codePillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  codePill: {
    flex: 1,
    minWidth: 120,
    backgroundColor: colors.background.elevated,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: 2,
  },
  codePillKey: {
    ...typography.titleSmall,
    color: colors.brand.primaryLight,
    fontWeight: typography.weights.extraBold,
  },
  codePillDesc: {
    ...typography.caption,
    color: colors.text.secondary,
  },
});
