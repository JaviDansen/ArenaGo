import { useIsFocused } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useContext, useEffect, useRef } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthBackground, Badge, Button, Card, LineIcon, ScreenHeader } from '../../components/ui';
import { ParticipationContext } from '../../context/ParticipationContext';
import { colors, radii, spacing, typography } from '../../theme';
import {
  blockingAction, describeBlockingReasons, describeEventAvailability, describeQueueConfiguration,
  describeScheduleNotice,
} from '../../utils/eventEntryPresentation';
import { describeEventSchedule } from '../../utils/eventTime';

const MAIN_TABS = { index: 0, routes: [{ name: 'MainTabs' }] };

/**
 * Confirmação de ingresso. `route.params` é só o contexto inicial (qual evento foi consultado);
 * a situação exibida e a liberação do botão vêm do store de ingresso, revalidado no servidor
 * ao voltar o foco, ao voltar ao primeiro plano, manualmente e após recusas definitivas.
 */
export default function EventConfirmationScreen({ navigation, route }) {
  const {
    admission, confirmEventEntry, retryEntrySync, revalidateEventEntry, reconcileEntryIntent,
    isCurrentAdmission, refreshParticipation,
  } = useContext(ParticipationContext);
  const initial = route?.params ?? {};
  const eventId = initial.event?.id;
  const inFlight = useRef(false);
  const focused = useIsFocused();
  const wasFocused = useRef(focused);
  const live = useRef(null);

  const current = Boolean(eventId) && admission?.event?.id === eventId;
  const event = current ? admission.event : initial.event;
  const eligibilityStatus = current ? admission.eligibilityStatus ?? 'none' : 'none';
  const officialEligibility = current && eligibilityStatus === 'fresh' ? admission.eligibility ?? null : null;
  const revalidating = eligibilityStatus === 'revalidating';
  const busy = current && ['joining', 'looking_up'].includes(admission.status);
  const confirmed = current && Boolean(admission.confirmedParticipationId);
  const uncertain = current && admission.status === 'uncertain';
  const pendingIntent = current ? admission.pendingIntent ?? null : null;
  const recovery = current ? admission.recovery ?? { status: 'idle', message: null } : null;
  const recovering = recovery?.status === 'checking';
  // Intenção incerta do mesmo evento: o próprio "Verificar ingresso" repete a chave original.
  const sameEventRetry = Boolean(pendingIntent?.sameEvent && !pendingIntent.confirmed && officialEligibility?.eligible);
  const showRecovery = Boolean(pendingIntent) && !sameEventRetry;
  const blocked = Boolean(officialEligibility && !officialEligibility.eligible);
  const canConfirm = Boolean(officialEligibility?.eligible) && !busy && !recovering && !showRecovery
    && admission?.status !== 'complete';

  const schedule = describeEventSchedule(event);
  const availability = officialEligibility ? describeEventAvailability(officialEligibility)
    : revalidating ? { label: 'ATUALIZANDO SITUAÇÃO', variant: 'default' }
      : { label: 'SITUAÇÃO NÃO CONFIRMADA', variant: 'warning' };
  const queue = describeQueueConfiguration(event, officialEligibility);
  const scheduleNotice = describeScheduleNotice(officialEligibility);
  const action = blocked ? blockingAction(officialEligibility.blockingReasons) : null;

  function revalidate() {
    if (!current || typeof revalidateEventEntry !== 'function') return Promise.resolve(null);
    return revalidateEventEntry();
  }
  live.current = { revalidate, focused };

  // Volta de foco (ex.: retorno do questionário): revalidar no servidor, nunca pelos parâmetros.
  useEffect(() => {
    const previous = wasFocused.current;
    wasFocused.current = focused;
    if (focused && previous === false) void live.current.revalidate();
  }, [focused]);

  // Retorno ao primeiro plano com a tela visível.
  useEffect(() => {
    if (typeof AppState?.addEventListener !== 'function') return undefined;
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && previous !== 'active' && live.current.focused) void live.current.revalidate();
      previous = next;
    });
    return () => subscription?.remove?.();
  }, []);

  async function handleConfirmEntry() {
    if (inFlight.current || !canConfirm || !isCurrentAdmission()) return;
    inFlight.current = true;
    try {
      // Após resultado incerto, confirm reutiliza a mesma intenção e chave salvas.
      const result = confirmed ? await retryEntrySync() : await confirmEventEntry(event.id);
      if (!isCurrentAdmission()) return;
      if (result?.kind === 'complete') navigation.reset(MAIN_TABS);
      else if (result?.kind === 'historical' || result?.revalidate) await revalidate();
    } finally {
      inFlight.current = false;
    }
  }

  async function handleReconcile() {
    if (inFlight.current || recovering || typeof reconcileEntryIntent !== 'function') return;
    inFlight.current = true;
    try {
      const result = await reconcileEntryIntent();
      if (!isCurrentAdmission()) return;
      if (result?.kind === 'resolved' && result.outcome === 'current') {
        if (typeof refreshParticipation === 'function') void refreshParticipation();
        navigation.reset(MAIN_TABS);
      } else if (result?.kind === 'resolved') {
        await revalidate();
      }
    } finally {
      inFlight.current = false;
    }
  }

  function goHome() {
    if (typeof refreshParticipation === 'function') void refreshParticipation();
    navigation.reset(MAIN_TABS);
  }

  const message = !current ? 'Consulte novamente o evento para confirmar o ingresso.' : admission?.error;
  const historical = current && admission.outcome === 'historical';
  const buttonTitle = busy ? 'Aguarde...'
    : confirmed ? 'Atualizar participação'
      : uncertain || sameEventRetry ? 'Verificar ingresso' : 'Confirmar entrada';
  const showRefresh = current && !busy && (eligibilityStatus === 'error' || blocked || revalidating);

  return (
    <AuthBackground variant="login" overlayOpacity={0.65} testID="event-confirmation-background">
      <StatusBar style="light" />
      <ScreenHeader title="Confirmar entrada" onBack={() => navigation.goBack()} testID="event-confirmation-header" />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroSection}>
          <Badge label="EVENTO ENCONTRADO" variant="brand" />
          <Text style={styles.eventName} numberOfLines={3} accessibilityRole="header">{event?.name}</Text>
          <View style={styles.statusRow} accessible accessibilityLabel={`Situação do evento: ${availability.label}`}
            testID="event-confirmation-status">
            <Badge label={availability.label} variant={availability.variant} />
          </View>
        </View>

        {blocked ? (
          <View style={styles.blockedCard} accessibilityRole="alert" testID="event-confirmation-blocked">
            <Badge label="ENTRADA INDISPONÍVEL" variant="danger" />
            {describeBlockingReasons(officialEligibility.blockingReasons).map(text => (
              <Text key={text} style={styles.blockedText}>{text}</Text>
            ))}
            {action === 'questionnaire' ? (
              <Button
                title="Completar questionário"
                variant="secondary"
                onPress={() => navigation.navigate('ProfileQuestionnaire', { mode: 'edit', returnTo: 'EventConfirmation' })}
                style={styles.blockedAction}
              />
            ) : null}
            {action === 'home' ? (
              <Button title="Voltar ao início" variant="secondary" onPress={goHome} style={styles.blockedAction} />
            ) : null}
          </View>
        ) : null}

        {showRecovery ? (
          <View style={styles.recoveryCard} accessibilityRole="alert" testID="event-confirmation-recovery">
            <Badge label="TENTATIVA ANTERIOR" variant="warning" />
            <Text style={styles.recoveryText}>
              {pendingIntent.unreadable
                ? 'Não foi possível ler uma tentativa de ingresso guardada neste aparelho.'
                : pendingIntent.sameEvent
                  ? 'Existe uma tentativa de ingresso anterior neste evento cujo resultado ainda não foi confirmado.'
                  : 'Existe uma tentativa de ingresso anterior, em outro evento, cujo resultado ainda não foi confirmado. Verifique-a antes de entrar neste evento.'}
            </Text>
            <Text style={styles.recoveryHint}>A verificação consulta o servidor e não cria um novo ingresso.</Text>
            {recovery?.message ? (
              <Text style={styles.recoveryMessage} testID="event-confirmation-recovery-message">{recovery.message}</Text>
            ) : null}
            <Button
              title={recovering ? 'Verificando...' : 'Verificar tentativa anterior'}
              variant="secondary"
              onPress={handleReconcile}
              disabled={recovering || busy}
              style={styles.blockedAction}
              testID="event-confirmation-reconcile-button"
            />
          </View>
        ) : null}

        {queue ? (
          <View style={styles.queueCard} testID="event-confirmation-queue-info">
            <LineIcon name={event.externalQueueEnabled ? 'queue' : 'door'} color={colors.brand.primaryLight} size={22} />
            <View style={styles.flexText}>
              <Text style={styles.queueTitle}>{queue.title}</Text>
              <Text style={styles.queueText}>{queue.text}</Text>
            </View>
          </View>
        ) : null}

        <Card variant="highlight" style={styles.eventCard} testID="event-confirmation-card">
          <Text style={styles.cardTitle}>Programação do evento</Text>
          {scheduleNotice ? (
            <Text style={styles.scheduleNotice} testID="event-confirmation-schedule-notice">{scheduleNotice}</Text>
          ) : null}
          <Detail icon="calendar" label="Data programada" value={schedule.date} />
          <Detail icon="clock" label="Início programado" value={schedule.start} />
          <Detail icon="door" label="Encerramento programado das entradas" value={schedule.entriesUntil} />
          <Detail icon="flag" label="Limite operacional programado" value={schedule.finalDeadline} />
          <Detail icon="globe" label="Fuso horário do evento" value={schedule.zoneLabel} />
        </Card>

        {message ? (
          <Text style={[styles.messageText, (uncertain || historical) && styles.warningText]} accessibilityRole="alert"
            testID="event-confirmation-message">
            {message}
          </Text>
        ) : null}

        {showRefresh ? (
          <Button
            title={revalidating ? 'Atualizando situação...' : 'Atualizar situação do evento'}
            variant="secondary"
            onPress={() => { void revalidate(); }}
            disabled={revalidating}
            style={styles.refreshButton}
            testID="event-confirmation-refresh-button"
          />
        ) : null}

        <Button
          title={buttonTitle}
          variant="primary"
          onPress={handleConfirmEntry}
          disabled={!canConfirm}
          style={styles.confirmButton}
          testID="event-confirmation-confirm-button"
        />
        <Text style={styles.note}>A confirmação será registrada no servidor do ArenaGo.</Text>
      </ScrollView>
    </AuthBackground>
  );
}

function Detail({ icon, label, value }) {
  if (!value) return null;
  return (
    <View style={styles.detailRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <LineIcon name={icon} color={colors.brand.primaryLight} size={20} style={styles.detailIcon} />
      <View style={styles.detailTextBlock}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.layout.screenPaddingHorizontal,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  heroSection: {
    marginBottom: spacing.lg,
  },
  eventName: {
    ...typography.titleLarge,
    color: colors.text.primary,
    marginTop: spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
  eventCard: {
    alignItems: 'stretch',
    marginTop: spacing.lg,
  },
  cardTitle: {
    ...typography.titleSmall,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  scheduleNotice: {
    ...typography.bodySmall,
    color: colors.semantic.warning,
    marginBottom: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    paddingVertical: spacing.md,
  },
  detailIcon: {
    marginHorizontal: 2,
  },
  detailTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  detailLabel: {
    ...typography.caption,
    color: colors.text.muted,
  },
  detailValue: {
    ...typography.body,
    color: colors.text.primary,
    marginTop: spacing.xxs,
  },
  flexText: {
    flex: 1,
    minWidth: 0,
  },
  queueCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.brand.primary,
    backgroundColor: colors.brand.primaryDim,
  },
  queueTitle: {
    ...typography.titleSmall,
    color: colors.text.primary,
  },
  queueText: {
    ...typography.body,
    color: colors.text.secondary,
    marginTop: spacing.xs,
  },
  blockedCard: {
    backgroundColor: colors.semantic.dangerBg,
    borderColor: colors.semantic.danger,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  blockedText: {
    ...typography.body,
    color: '#FF9AAE',
    marginTop: spacing.md,
  },
  blockedAction: {
    marginTop: spacing.lg,
  },
  recoveryCard: {
    backgroundColor: colors.semantic.warningBg,
    borderColor: colors.semantic.warning,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  recoveryText: {
    ...typography.body,
    color: colors.text.primary,
    marginTop: spacing.md,
  },
  recoveryHint: {
    ...typography.bodySmall,
    color: colors.text.secondary,
    marginTop: spacing.xs,
  },
  recoveryMessage: {
    ...typography.body,
    color: colors.semantic.warning,
    marginTop: spacing.md,
  },
  messageText: {
    ...typography.body,
    color: '#FF9AAE',
    marginTop: spacing.lg,
  },
  warningText: {
    color: colors.semantic.warning,
  },
  refreshButton: {
    marginTop: spacing.lg,
  },
  confirmButton: {
    marginTop: spacing.xxl,
  },
  note: {
    ...typography.bodySmall,
    color: colors.text.secondary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
