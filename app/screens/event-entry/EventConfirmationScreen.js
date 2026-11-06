import { StatusBar } from 'expo-status-bar';
import { useContext, useRef, useState } from 'react';
import {
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
  ScreenHeader,
} from '../../components/ui';
import { ParticipationContext } from '../../context/ParticipationContext';
import { colors, radii, spacing, typography } from '../../theme';

export default function EventConfirmationScreen({ navigation, route }) {
  const participationContext =
    typeof useContext === 'function' ? useContext(ParticipationContext) : null;
  const participation = participationContext?.participation ?? null;
  const setParticipation = participationContext?.setParticipation;
  const event = route?.params?.event ?? null;

  const [isSubmitting, setIsSubmitting] =
    typeof useState === 'function' ? useState(false) : [false, () => {}];
  const isSubmittingRef =
    typeof useRef === 'function' ? useRef(false) : { current: false };

  const windowDims =
    typeof useWindowDimensions === 'function'
      ? useWindowDimensions()
      : { width: 390, height: 844 };
  const isSmallScreen = windowDims.width <= 340 || windowDims.height <= 600;

  const hasCurrentParticipation =
    participation?.status === 'waiting' || participation?.status === 'active';

  const experiences = Array.isArray(event?.experiences)
    ? event.experiences.filter(
        (item) => item && typeof item.name === 'string' && item.name.trim() !== ''
      )
    : [];

  function handleCancel() {
    if (isSubmittingRef.current) {
      return;
    }
    if (navigation && typeof navigation.goBack === 'function') {
      navigation.goBack();
    } else if (navigation && typeof navigation.navigate === 'function') {
      navigation.navigate('EventEntry');
    }
  }

  function handleConfirmEntry() {
    if (!event || typeof setParticipation !== 'function') {
      return;
    }

    if (isSubmittingRef.current || hasCurrentParticipation) {
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);

    // Eventos com fila externa começam em espera; os demais entram direto na Arena.
    if (event.hasArenaQueue) {
      setParticipation({
        event,
        status: 'waiting',
        // Posição temporariamente simulada enquanto não há integração com backend.
        queuePosition: 5,
        experienceQueue: null,
        // Será preenchida quando o participante for chamado para uma experiência.
        activeExperience: null,
        experienceParticipations: {},
      });
    } else {
      setParticipation({
        event,
        status: 'active',
        queuePosition: null,
        experienceQueue: null,
        activeExperience: null,
        experienceParticipations: {},
      });
    }

    // Remove as telas de entrada para não retornar a elas com participação ativa.
    if (navigation && typeof navigation.reset === 'function') {
      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
    }
  }

  return (
    <AuthBackground
      variant="login"
      overlayOpacity={0.65}
      useSafeArea
      testID="event-confirmation-background"
    >
      <StatusBar style="light" />

      <ScreenHeader
        title="Confirmar entrada"
        onBack={handleCancel}
        backDisabled={isSubmitting}
        testID="event-confirmation-header"
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          isSmallScreen && styles.scrollContentSmall,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroSection}>
          <Text style={styles.kicker}>CONFIRMAÇÃO DE CHECK-IN</Text>
          <Text style={[styles.title, isSmallScreen && styles.titleSmall]}>
            Evento encontrado
          </Text>
          <Text style={styles.subtitle}>
            Revise os detalhes do evento abaixo antes de confirmar sua entrada.
          </Text>
        </View>

        {!event ? (
          <Card variant="default" style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              Nenhum evento selecionado para confirmação.
            </Text>
            <Button
              title="Voltar"
              variant="secondary"
              size="lg"
              onPress={handleCancel}
              testID="event-confirmation-empty-back-button"
            />
          </Card>
        ) : (
          <>
            {hasCurrentParticipation && !isSubmitting ? (
              <View
                style={styles.activeWarningBanner}
                accessible
                accessibilityRole="alert"
                testID="event-confirmation-active-warning"
              >
                <View style={styles.badgeRow}>
                  <Badge label="PARTICIPAÇÃO EM ANDAMENTO" variant="warning" />
                </View>
                <Text style={styles.warningTitle}>
                  Participação já registrada nesta sessão
                </Text>
                <Text style={styles.warningText}>
                  Você já possui uma participação corrente em andamento (regra D03). Não é permitido iniciar outra participação simultânea.
                </Text>
              </View>
            ) : null}

            <Card
              variant="highlighted"
              style={styles.eventCard}
              testID="event-confirmation-card"
            >
              <View style={styles.badgeRow}>
                <Badge
                  label={
                    event.hasArenaQueue ? 'FILA EXTERNA ATIVA' : 'ENTRADA DIRETA'
                  }
                  variant={event.hasArenaQueue ? 'brand' : 'success'}
                />
                <Badge label="CENÁRIO DEMONSTRATIVO" variant="info" />
              </View>

              <Text style={styles.eventName}>{event.name}</Text>

              <View style={styles.infoBlock}>
                <Text style={styles.infoLabel}>LOCAL / IDENTIFICAÇÃO</Text>
                <Text style={styles.location}>{event.location}</Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.infoBlock}>
                <Text style={styles.infoLabel}>MODO DE ACESSO</Text>
                <Text style={styles.modeDescription}>
                  {event.hasArenaQueue
                    ? 'A entrada neste evento ocorre por fila externa. Ao confirmar, você aguardará sua chamada e o tempo de permanência só começará após a liberação para a Arena.'
                    : 'Este evento está com entrada livre. Ao confirmar, seu acesso à Arena ativa será liberado imediatamente.'}
                </Text>
              </View>

              {experiences.length > 0 ? (
                <>
                  <View style={styles.divider} />
                  <View style={styles.infoBlock}>
                    <Text style={styles.infoLabel}>
                      EXPERIÊNCIAS DISPONÍVEIS ({experiences.length})
                    </Text>
                    <View style={styles.experiencesList}>
                      {experiences.map((exp, index) => (
                        <View
                          key={exp.id || `${exp.name}-${index}`}
                          style={styles.experienceChip}
                        >
                          <View style={styles.experienceDot} />
                          <Text style={styles.experienceName}>{exp.name}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </>
              ) : null}
            </Card>

            <View style={styles.actionsSection}>
              <Button
                title="Confirmar entrada"
                variant="primary"
                size="lg"
                onPress={handleConfirmEntry}
                disabled={isSubmitting || hasCurrentParticipation}
                testID="event-confirmation-confirm-button"
              />
              <Button
                title="Voltar"
                accessibilityLabel="Cancelar e voltar"
                variant="secondary"
                size="lg"
                onPress={handleCancel}
                disabled={isSubmitting}
                testID="event-confirmation-cancel-button"
              />
            </View>
          </>
        )}
      </ScrollView>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
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
  subtitle: {
    ...typography.body,
    color: colors.text.secondary,
  },
  emptyCard: {
    gap: spacing.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.text.secondary,
  },
  activeWarningBanner: {
    backgroundColor: colors.semantic.warningBg,
    borderColor: colors.semantic.warning,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
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
  eventCard: {
    gap: spacing.md,
  },
  eventName: {
    ...typography.titleLarge,
    color: colors.text.primary,
    fontWeight: typography.weights.extraBold,
  },
  infoBlock: {
    gap: spacing.xxs,
  },
  infoLabel: {
    ...typography.tag,
    color: colors.brand.primaryLight,
  },
  location: {
    ...typography.bodyLarge,
    color: colors.text.primary,
    fontWeight: typography.weights.semiBold,
  },
  modeDescription: {
    ...typography.body,
    color: colors.text.secondary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border.subtle,
  },
  experiencesList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  experienceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.elevated,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radii.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  experienceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand.primaryLight,
  },
  experienceName: {
    ...typography.caption,
    color: colors.text.primary,
    fontWeight: typography.weights.semiBold,
  },
  actionsSection: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
