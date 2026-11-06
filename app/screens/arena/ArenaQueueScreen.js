import { StatusBar } from 'expo-status-bar';
import { useContext, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { AuthBackground, Badge, Button, Card } from '../../components/ui';
import { ParticipationContext } from '../../context/ParticipationContext';
import { colors, radii, spacing, typography } from '../../theme';

export default function ArenaQueueScreen() {
  const participationContext =
    typeof useContext === 'function' ? useContext(ParticipationContext) : null;
  const participation = participationContext?.participation ?? null;
  const setParticipation = participationContext?.setParticipation;

  const [isConfirmingExit, setIsConfirmingExit] =
    typeof useState === 'function' ? useState(false) : [false, () => {}];
  const [isTransitioning, setIsTransitioning] =
    typeof useState === 'function' ? useState(false) : [false, () => {}];
  const isTransitioningRef =
    typeof useRef === 'function' ? useRef(false) : { current: false };

  const windowDims =
    typeof useWindowDimensions === 'function'
      ? useWindowDimensions()
      : { width: 390, height: 844 };
  const isSmallScreen = windowDims.width <= 340 || windowDims.height <= 600;

  const eventName = participation?.event?.name || 'BEAST Arena';
  const hasPosition =
    typeof participation?.queuePosition === 'number' &&
    Number.isFinite(participation.queuePosition);

  function canTransition() {
    if (typeof setParticipation !== 'function') return false;
    if (!participation || participation.status !== 'waiting') return false;
    if (isTransitioningRef.current) return false;
    return true;
  }

  function handleRelease() {
    if (!canTransition()) return;
    isTransitioningRef.current = true;
    setIsTransitioning(true);
    setParticipation({
      ...participation,
      status: 'active',
      queuePosition: null,
    });
  }

  function handleQueueDisabled() {
    if (!canTransition()) return;
    isTransitioningRef.current = true;
    setIsTransitioning(true);
    setParticipation({
      ...participation,
      status: 'active',
      queuePosition: null,
    });
  }

  function handleRequestLeaveQueue() {
    if (!canTransition()) return;
    setIsConfirmingExit(true);
  }

  function handleCancelLeaveQueue() {
    if (isTransitioningRef.current) return;
    setIsConfirmingExit(false);
  }

  function handleConfirmLeaveQueue() {
    if (!canTransition()) return;
    isTransitioningRef.current = true;
    setIsTransitioning(true);
    setParticipation(null);
  }

  return (
    <AuthBackground
      variant="login"
      overlayOpacity={0.65}
      useSafeArea
      testID="arena-queue-background"
    >
      <StatusBar style="light" />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          isSmallScreen && styles.scrollContentSmall,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Barra superior de identificação */}
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <Text style={styles.brandArena}>Arena</Text>
            <Text style={styles.brandGo}>GO</Text>
          </View>
          <Badge label="FILA EXTERNA" variant="brand" />
        </View>

        {/* Cabeçalho do evento e estado da fila */}
        <View style={styles.heroSection}>
          <Text style={styles.eventName}>{eventName}</Text>
          <Text style={[styles.title, isSmallScreen && styles.titleSmall]}>
            Você está na fila
          </Text>
          <Text style={styles.message}>
            Aguarde sua vez. Você será avisado quando sua entrada na Arena for liberada.
          </Text>
        </View>

        {/* Card de posição na fila */}
        <Card
          variant="highlighted"
          style={styles.positionCard}
          testID="arena-queue-position-card"
        >
          <View style={styles.badgeRow}>
            <Badge label="AGUARDANDO CHAMADA" variant="brand" />
            <Badge label="POSIÇÃO DEMONSTRATIVA" variant="info" />
          </View>

          <View style={styles.positionHighlightBox}>
            <Text style={styles.positionLabel}>Sua posição:</Text>
            {hasPosition ? (
              <Text
                style={[styles.position, isSmallScreen && styles.positionSmall]}
                testID="arena-queue-position-value"
              >
                {participation.queuePosition}º
              </Text>
            ) : (
              <Text
                style={styles.positionUnavailable}
                testID="arena-queue-position-unavailable"
              >
                Posição em atualização
              </Text>
            )}
          </View>

          <View style={styles.divider} />

          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>APÓS A LIBERAÇÃO</Text>
            <Text style={styles.note}>
              O tempo de permanência só começa quando sua entrada for liberada.
            </Text>
            <Text style={styles.nextStepDescription}>
              Assim que sua entrada for autorizada, você será direcionado automaticamente para a Arena ativa e poderá entrar nas filas das experiências disponíveis.
            </Text>
          </View>
        </Card>

        {/* Ação de saída da fila com confirmação (Regra D02) */}
        {!isConfirmingExit ? (
          <Button
            title="Sair da fila"
            variant="dangerOutline"
            size="lg"
            onPress={handleRequestLeaveQueue}
            disabled={isTransitioning}
            testID="arena-queue-leave-button"
          />
        ) : (
          <View
            style={styles.confirmExitCard}
            accessible
            accessibilityRole="alert"
            testID="arena-queue-exit-confirmation-card"
          >
            <View style={styles.badgeRow}>
              <Badge label="CONFIRMAR CANCELAMENTO" variant="danger" />
            </View>
            <Text style={styles.confirmExitTitle}>
              Deseja sair da fila externa?
            </Text>
            <Text style={styles.confirmExitText}>
              Ao sair da fila externa, sua participação será cancelada e você perderá sua posição atual na fila.
            </Text>
            <View style={styles.confirmActions}>
              <Button
                title="Confirmar saída"
                variant="danger"
                size="md"
                onPress={handleConfirmLeaveQueue}
                disabled={isTransitioning}
                testID="arena-queue-confirm-leave-button"
              />
              <Button
                title="Manter na fila"
                accessibilityLabel="Cancelar saída e permanecer na fila"
                variant="secondary"
                size="md"
                onPress={handleCancelLeaveQueue}
                disabled={isTransitioning}
                testID="arena-queue-cancel-leave-button"
              />
            </View>
          </View>
        )}

        {/* Controles demonstrativos de desenvolvimento (Regra D06) */}
        <Card
          variant="default"
          style={styles.simulationCard}
          testID="arena-queue-simulation-card"
        >
          <View style={styles.badgeRow}>
            <Badge label="SIMULAÇÃO DE DESENVOLVIMENTO" variant="warning" />
          </View>
          <Text style={styles.simulationTitle}>
            Simulações locais de transição
          </Text>
          <Text style={styles.simulationDescription}>
            Controles exclusivos de desenvolvimento (sem integração com backend de filas nesta versão):
          </Text>

          <View style={styles.simulationButtons}>
            <Button
              title="Simular entrada liberada"
              variant="secondary"
              size="md"
              onPress={handleRelease}
              disabled={isTransitioning}
              testID="arena-queue-release-button"
            />
            <Button
              title="Simular staff desativando fila"
              variant="secondary"
              size="md"
              onPress={handleQueueDisabled}
              disabled={isTransitioning}
              testID="arena-queue-disable-button"
            />
          </View>
        </Card>
      </ScrollView>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  scrollContentSmall: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
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
  heroSection: {
    gap: spacing.xs,
  },
  eventName: {
    ...typography.tag,
    color: colors.brand.primaryLight,
    fontSize: typography.sizes.bodySmall,
  },
  title: {
    ...typography.hero,
    color: colors.text.primary,
  },
  titleSmall: {
    fontSize: typography.sizes.titleLarge,
    lineHeight: typography.lineHeights.titleLarge,
  },
  message: {
    ...typography.body,
    color: colors.text.secondary,
  },
  positionCard: {
    gap: spacing.md,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  positionHighlightBox: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.elevated,
    borderWidth: 1,
    borderColor: colors.brand.primary,
    borderRadius: radii.xl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    gap: spacing.xxs,
  },
  positionLabel: {
    ...typography.caption,
    color: colors.text.secondary,
    fontWeight: typography.weights.semiBold,
  },
  position: {
    fontFamily: typography.fontFamily,
    fontSize: 44,
    lineHeight: 52,
    fontWeight: typography.weights.extraBold,
    color: colors.brand.primaryLight,
  },
  positionSmall: {
    fontSize: 36,
    lineHeight: 44,
  },
  positionUnavailable: {
    ...typography.titleMedium,
    color: colors.text.secondary,
    fontWeight: typography.weights.bold,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border.subtle,
  },
  infoBlock: {
    gap: spacing.xs,
  },
  infoLabel: {
    ...typography.tag,
    color: colors.brand.primaryLight,
  },
  note: {
    ...typography.body,
    color: colors.text.primary,
    fontWeight: typography.weights.semiBold,
  },
  nextStepDescription: {
    ...typography.bodySmall,
    color: colors.text.secondary,
  },
  confirmExitCard: {
    backgroundColor: colors.semantic.dangerBg,
    borderColor: colors.semantic.danger,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  confirmExitTitle: {
    ...typography.titleSmall,
    color: colors.text.primary,
    fontWeight: typography.weights.bold,
  },
  confirmExitText: {
    ...typography.body,
    color: colors.text.secondary,
  },
  confirmActions: {
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
  simulationCard: {
    gap: spacing.sm,
  },
  simulationTitle: {
    ...typography.titleSmall,
    color: colors.text.primary,
    fontWeight: typography.weights.bold,
  },
  simulationDescription: {
    ...typography.bodySmall,
    color: colors.text.secondary,
  },
  simulationButtons: {
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
});
