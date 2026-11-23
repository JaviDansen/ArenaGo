import { StatusBar } from 'expo-status-bar';
import { useContext, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthBackground, Badge, Button, Card, ScreenHeader } from '../../components/ui';
import { ParticipationContext } from '../../context/ParticipationContext';
import { colors, radii, spacing, typography } from '../../theme';
import {
  blockingAction, describeBlockingReasons, describeEventAvailability, describeExternalQueue,
} from '../../utils/eventEntryPresentation';
import { describeEventSchedule } from '../../utils/eventTime';

export default function EventConfirmationScreen({ navigation, route }) {
  const { admission, confirmEventEntry, retryEntrySync, isCurrentAdmission, refreshParticipation } =
    useContext(ParticipationContext);
  const { event, eligibility } = route.params;
  const inFlight = useRef(false);
  const current = admission?.event?.id === event.id;
  const busy = current && ['joining', 'looking_up'].includes(admission.status);
  const confirmed = current && admission.confirmedParticipationId;
  const uncertain = current && admission.status === 'uncertain';
  const blocked = !eligibility?.eligible;
  const schedule = describeEventSchedule(event);
  const availability = describeEventAvailability(eligibility);
  const action = blocked ? blockingAction(eligibility?.blockingReasons) : null;

  async function handleConfirmEntry() {
    if (inFlight.current || busy || blocked || !isCurrentAdmission()) return;
    inFlight.current = true;
    try {
      // Após resultado incerto, confirm reutiliza a mesma intenção e chave salvas.
      const result = confirmed ? await retryEntrySync() : await confirmEventEntry(event.id);
      if (result?.kind === 'complete' && isCurrentAdmission()) {
        navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
      }
    } finally {
      inFlight.current = false;
    }
  }

  function goHome() {
    if (typeof refreshParticipation === 'function') void refreshParticipation();
    navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
  }

  const message = !current ? 'Consulte novamente o evento para confirmar o ingresso.' : admission?.error;
  const disabled = busy || blocked || !current || admission.status === 'complete';
  const buttonTitle = busy ? 'Aguarde...'
    : confirmed ? 'Atualizar participação'
      : uncertain ? 'Verificar ingresso' : 'Confirmar entrada';

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
          <Text style={styles.eventName} numberOfLines={3} accessibilityRole="header">{event.name}</Text>
          <View style={styles.statusRow} accessible accessibilityLabel={`Situação do evento: ${availability.label}`}>
            <Badge label={availability.label} variant={availability.variant} />
          </View>
        </View>

        <Card variant="highlight" style={styles.eventCard} testID="event-confirmation-card">
          <Text style={styles.cardTitle}>Horários do evento</Text>
          <Detail icon="📅" label="Data" value={schedule.date} />
          <Detail icon="🕒" label="Início" value={schedule.start} />
          <Detail icon="🚪" label="Entradas até" value={schedule.entriesUntil} />
          <Detail icon="🏁" label="Encerramento final" value={schedule.finalDeadline} />
          <Detail icon="🌎" label="Fuso horário" value={schedule.zoneLabel} />
        </Card>

        {blocked ? (
          <View style={styles.blockedCard} accessibilityRole="alert" testID="event-confirmation-blocked">
            <Badge label="ENTRADA INDISPONÍVEL" variant="danger" />
            {describeBlockingReasons(eligibility?.blockingReasons).map(text => (
              <Text key={text} style={styles.blockedText}>{text}</Text>
            ))}
            {action === 'questionnaire' ? (
              <Button
                title="Completar questionário"
                variant="secondary"
                onPress={() => navigation.navigate('ProfileQuestionnaire')}
                style={styles.blockedAction}
              />
            ) : null}
            {action === 'home' ? (
              <Button title="Voltar ao início" variant="secondary" onPress={goHome} style={styles.blockedAction} />
            ) : null}
          </View>
        ) : (
          <View style={styles.queueCard} testID="event-confirmation-queue-info">
            <Text style={styles.queueTitle}>
              {event.externalQueueEnabled ? 'Fila de entrada ativa' : 'Entrada direta na Arena'}
            </Text>
            <Text style={styles.queueText}>{describeExternalQueue(event.externalQueueEnabled)}</Text>
          </View>
        )}

        {message ? (
          <Text style={[styles.messageText, uncertain && styles.warningText]} accessibilityRole="alert">
            {message}
          </Text>
        ) : null}

        <Button
          title={buttonTitle}
          variant="primary"
          onPress={handleConfirmEntry}
          disabled={disabled}
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
      <Text style={styles.detailIcon} importantForAccessibility="no">{icon}</Text>
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
    marginBottom: spacing.xl,
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
  },
  cardTitle: {
    ...typography.titleSmall,
    color: colors.text.primary,
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
    fontSize: 18,
    width: 24,
    textAlign: 'center',
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
  queueCard: {
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
    marginTop: spacing.lg,
  },
  blockedText: {
    ...typography.body,
    color: '#FF9AAE',
    marginTop: spacing.md,
  },
  blockedAction: {
    marginTop: spacing.lg,
  },
  messageText: {
    ...typography.body,
    color: '#FF9AAE',
    marginTop: spacing.lg,
  },
  warningText: {
    color: colors.semantic.warning,
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
