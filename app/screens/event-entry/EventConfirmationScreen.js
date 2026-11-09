import { StatusBar } from 'expo-status-bar';
import { useContext, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthBackground, Badge, Button, Card, ScreenHeader } from '../../components/ui';
import { ParticipationContext } from '../../context/ParticipationContext';
import { colors, spacing, typography } from '../../theme';

export default function EventConfirmationScreen({ navigation, route }) {
  const { admission, confirmEventEntry, retryEntrySync, isCurrentAdmission } = useContext(ParticipationContext);
  const { event, eligibility } = route.params;
  const inFlight = useRef(false);
  const current = admission?.event?.id === event.id;
  const busy = current && ['joining', 'looking_up'].includes(admission.status);
  const confirmed = current && admission.confirmedParticipationId;
  const blocked = !eligibility?.eligible;

  async function handleConfirmEntry() {
    if (inFlight.current || busy || blocked || !isCurrentAdmission()) return;
    inFlight.current = true;
    try {
      const result = confirmed ? await retryEntrySync() : await confirmEventEntry(event.id);
      if (result?.kind === 'complete' && isCurrentAdmission()) {
        navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
      }
    } finally {
      inFlight.current = false;
    }
  }

  const message = !current ? 'Consulte novamente o evento para confirmar o ingresso.' : admission?.error;
  const disabled = busy || blocked || !current || admission.status === 'complete';

  return (
    <AuthBackground variant="login" overlayOpacity={0.65} testID="event-confirmation-background">
      <StatusBar style="light" />
      <ScreenHeader title="Confirmar entrada" onBack={() => navigation.goBack()} testID="event-confirmation-header" />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroSection}>
          <Badge label="EVENTO ENCONTRADO" variant="success" />
          <Text style={styles.title}>Confira os dados do evento</Text>
        </View>

        <Card variant="highlight" style={styles.eventCard} testID="event-confirmation-card">
          <Text style={styles.eventName}>{event.name}</Text>
          <View style={styles.details}>
            <Detail label="Fuso horário" value={event.timezone} />
            <Detail label="Início" value={event.startsAt} />
            <Detail label="Término oficial" value={event.officialEndsAt} />
            <Detail label="Prazo operacional" value={event.operationalDeadlineAt} />
            <Detail label="Fila externa" value={event.externalQueueEnabled ? 'Habilitada' : 'Não habilitada'} />
          </View>
        </Card>

        {blocked ? (
          <View style={styles.errorCard} accessibilityRole="alert">
            <Badge label="ENTRADA INDISPONÍVEL" variant="danger" />
            <Text style={styles.errorText}>Ingresso indisponível: {eligibility.blockingReasons.join(', ')}</Text>
          </View>
        ) : null}
        {message ? <Text style={styles.errorText} accessibilityRole="alert">{message}</Text> : null}

        <Button
          title={busy ? 'Aguarde...' : confirmed ? 'Atualizar participação' : 'Confirmar entrada'}
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

function Detail({ label, value }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{String(value || 'Não informado')}</Text>
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
  title: {
    ...typography.titleLarge,
    color: colors.text.primary,
    marginTop: spacing.md,
  },
  eventCard: {
    alignItems: 'stretch',
  },
  eventName: {
    ...typography.titleMedium,
    color: colors.text.primary,
  },
  details: {
    marginTop: spacing.lg,
  },
  detailRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    paddingVertical: spacing.md,
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
  errorCard: {
    backgroundColor: colors.semantic.dangerBg,
    borderColor: colors.semantic.danger,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  errorText: {
    ...typography.body,
    color: '#FF9AAE',
    marginTop: spacing.md,
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
