import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AdminIcon, liveColors as c, liveStyles as live } from '../../admin/components/AdminLiveUI';
import { ElapsedCallBadge } from './StaffStationSections';

const pad2 = (value) => String(value).padStart(2, '0');

export function getDisableAffectedCount(waitingCount, pendingCall) {
  const safeWaiting = Number.isSafeInteger(waitingCount) && waitingCount > 0 ? waitingCount : 0;
  return safeWaiting + (pendingCall ? 1 : 0);
}

export function formatEntryCallTimestamp(calledAt, options = {}) {
  if (typeof calledAt !== 'string' || !calledAt.trim()) return null;
  const parsedMs = Date.parse(calledAt);
  if (!Number.isFinite(parsedMs)) return null;
  const date = new Date(parsedMs);
  let formatted = null;
  try {
    const formatter = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(options?.timeZone ? { timeZone: options.timeZone } : {}),
    });
    const candidate = formatter.format(date);
    if (/^\d{2}:\d{2}$/.test(candidate)) formatted = candidate;
  } catch {
    formatted = null;
  }
  if (!formatted) {
    formatted = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }
  return `Chamado às ${formatted}`;
}

function EntryUserTile() {
  return (
    <View style={styles.userTile} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.userHead} />
      <View style={styles.userShoulders} />
    </View>
  );
}

function EntryActionIcon({ kind, color }) {
  if (kind === 'confirm') {
    return (
      <View style={styles.actionIconBox} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.checkMark, { borderColor: color }]} />
      </View>
    );
  }
  if (kind === 'absent') {
    return (
      <View style={styles.actionIconBox} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.calendarBox, { borderColor: color }]}>
          <View style={[styles.calendarBar, { backgroundColor: color }]} />
          <Text style={[styles.calendarCross, { color }]}>×</Text>
        </View>
      </View>
    );
  }
  if (kind === 'remove') {
    return (
      <View style={styles.actionIconBox} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.trashLid, { backgroundColor: color }]} />
        <View style={[styles.trashCan, { borderColor: color }]}>
          <View style={[styles.trashLine, { backgroundColor: color }]} />
          <View style={[styles.trashLine, { backgroundColor: color }]} />
        </View>
      </View>
    );
  }
  return null;
}

export function EntryActionButton({ label, kind = null, variant = 'primary', disabled = false, onPress }) {
  const tone = SEMANTIC_BUTTONS[variant] ?? SEMANTIC_BUTTONS.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.semanticButton,
        tone.box,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {kind ? <EntryActionIcon kind={kind} color={tone.iconColor} /> : null}
      <Text style={[styles.semanticButtonText, tone.text]}>{label}</Text>
    </Pressable>
  );
}

export function EntryStatusBadge({ enabled }) {
  const isActive = Boolean(enabled);
  return (
    <View style={[styles.statusPill, isActive ? styles.pillSuccess : styles.pillDanger]}>
      <Text style={[styles.statusPillText, isActive ? styles.pillSuccessText : styles.pillDangerText]}>
        {isActive ? 'FILA ATIVA' : 'FILA INATIVA'}
      </Text>
    </View>
  );
}

export function EntryHeaderCard({ eventName, externalQueueEnabled = null }) {
  return (
    <View style={styles.headerSection}>
      <View style={styles.headerTopRow}>
        <Text style={styles.screenTitle} accessibilityRole="header">Controle de Entrada</Text>
        {typeof externalQueueEnabled === 'boolean' ? <EntryStatusBadge enabled={externalQueueEnabled} /> : null}
      </View>
      {eventName ? (
        <View style={styles.eventRow}>
          <View style={styles.eventIconTile} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <AdminIcon name="calendar" color={c.accent} size={15} />
          </View>
          <Text style={styles.eventName}>{eventName}</Text>
        </View>
      ) : null}
      <Text style={styles.headerSubtitle}>Fila de acesso ao evento</Text>
    </View>
  );
}

export function EntrySummaryCard({ externalQueueEnabled, waitingCount, hasPendingCall, canManage }) {
  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionLabel}>RESUMO OPERACIONAL</Text>
      <View style={styles.card}>
        <View style={styles.metricsRow}>
          <View style={styles.metricTile}>
            <Text style={styles.metricValue}>{waitingCount}</Text>
            <Text style={styles.metricCaption}>Aguardando na fila</Text>
          </View>
          <View style={styles.metricTile}>
            <Text style={styles.metricValue}>{hasPendingCall ? '1 chamada' : 'Livre'}</Text>
            <Text style={styles.metricCaption}>{externalQueueEnabled ? 'Fila externa ativa' : 'Fila externa inativa'}</Text>
          </View>
        </View>

        <Text style={styles.summaryDescription}>
          {externalQueueEnabled
            ? 'Chame o próximo participante para conferir sua entrada presencial.'
            : 'Novas participações entram diretamente no evento. Reativar não recoloca quem já foi liberado na fila.'}
        </Text>

        {!canManage && (
          <View style={styles.inlineWarningBox}>
            <Text style={styles.inlineWarningText}>
              O ingresso de novos participantes e alterações da fila externa estão indisponíveis. As ações sobre chamadas pendentes dependem das permissões atuais.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

export function EntryCurrentCallCard({
  pendingCall,
  canCall,
  canConfirm,
  canMarkAbsent,
  canRemove,
  disabled,
  hasWaiting,
  externalQueueEnabled,
  onCallNext,
  onConfirmEntry,
  onMarkAbsent,
  onRemoveFromQueue,
  getNow,
}) {
  const timestampLabel = pendingCall ? formatEntryCallTimestamp(pendingCall.calledAt) : null;
  const showConfirmUnavailableNote = Boolean(
    pendingCall && !disabled && !canConfirm && (canMarkAbsent || canRemove),
  );
  const showAllActionsUnavailableNote = Boolean(
    pendingCall && !disabled && !canConfirm && !canMarkAbsent && !canRemove,
  );

  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionLabel}>CHAMADA EXTERNA ATUAL</Text>

      {!pendingCall ? (
        <View style={styles.card}>
          <View style={styles.emptyCallHeader}>
            <EntryUserTile />
            <View style={live.grow}>
              <Text style={styles.emptyTitle}>Nenhum participante chamado</Text>
              <Text style={styles.emptySubtitle}>
                {externalQueueEnabled
                  ? hasWaiting
                    ? 'Chame o próximo da fila externa para iniciar a conferência presencial.'
                    : 'Aguardando participantes na fila externa do evento.'
                  : 'Reative a fila externa abaixo para voltar a chamar participantes na entrada.'}
              </Text>
            </View>
          </View>

          <EntryActionButton
            label="Chamar próximo"
            variant="primary"
            disabled={disabled || !canCall}
            onPress={onCallNext}
          />
        </View>
      ) : (
        <View style={styles.pendingCard}>
          <View style={styles.calledHeaderRow}>
            <View style={styles.calledIdentity}>
              <EntryUserTile />
              <View style={live.grow}>
                <Text style={styles.calledName}>{pendingCall.displayName}</Text>
                <Text style={styles.calledStatus}>Aguardando conferência na entrada</Text>
              </View>
            </View>
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>CHAMADA PENDENTE</Text>
            </View>
          </View>

          <View style={styles.timePillsRow}>
            {timestampLabel ? (
              <View style={styles.timestampPill}>
                <Text style={styles.timestampPillText}>{timestampLabel}</Text>
              </View>
            ) : null}
            <ElapsedCallBadge calledAt={pendingCall.calledAt} getNow={getNow} />
          </View>

          <View style={styles.cardDivider} />

          <Text style={styles.actionPrompt}>Selecione a decisão para o participante chamado:</Text>

          <View style={styles.actionsColumn}>
            <EntryActionButton
              label="Confirmar entrada"
              kind="confirm"
              variant="success"
              disabled={disabled || !canConfirm}
              onPress={onConfirmEntry}
            />
            <EntryActionButton
              label="Marcar ausência"
              kind="absent"
              variant="warning"
              disabled={disabled || !canMarkAbsent}
              onPress={onMarkAbsent}
            />
            <EntryActionButton
              label="Remover da fila"
              kind="remove"
              variant="danger"
              disabled={disabled || !canRemove}
              onPress={onRemoveFromQueue}
            />
          </View>

          {showConfirmUnavailableNote && (
            <View style={styles.sharedInfoBox}>
              <Text style={styles.sharedInfoText}>
                A confirmação de entrada está indisponível. Ainda é possível registrar ausência ou remover o participante chamado.
              </Text>
            </View>
          )}

          {showAllActionsUnavailableNote && (
            <View style={styles.sharedInfoBox}>
              <Text style={styles.sharedInfoText}>
                As ações sobre a chamada externa estão indisponíveis no estado atual do evento.
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export function EntryQueueListCard({ waiting, waitingCount, externalQueueEnabled, hasPendingCall }) {
  return (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionLabel}>FILA EXTERNA</Text>
        <Text style={styles.sectionCount}>{waitingCount} aguardando</Text>
      </View>

      <View style={styles.card}>
        {waiting.length === 0 ? (
          <View style={styles.emptyQueueBox}>
            <Text style={styles.emptyTitle}>Ninguém está aguardando na fila de entrada.</Text>
            <Text style={styles.emptySubtitle}>
              {externalQueueEnabled
                ? 'Novos participantes aparecerão nesta lista em ordem oficial de chegada.'
                : 'A fila externa está desativada no momento.'}
            </Text>
          </View>
        ) : (
          <View>
            {waiting.map((person, index) => {
              const isNext = index === 0 && !hasPendingCall;
              return (
                <View key={person.participationId}>
                  {index > 0 && <View style={styles.rowDivider} />}
                  <View style={styles.queueRow}>
                    <View style={styles.positionBadge}>
                      <Text style={styles.positionNumber}>{person.position}</Text>
                    </View>
                    <View style={live.grow}>
                      <Text style={styles.participantName}>{person.displayName}</Text>
                      <Text style={styles.participantState}>
                        {isNext ? 'Próximo da fila externa' : 'Aguardando chamada'}
                      </Text>
                    </View>
                    {isNext && (
                      <View style={styles.nextPill}>
                        <Text style={styles.nextPillText}>PRÓXIMO</Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.sharedInfoBox} accessible accessibilityLabel="Ordem FIFO controlada pelo servidor">
          <AdminIcon name="users" color={c.accent} size={18} />
          <Text style={styles.sharedInfoText}>
            A ordem da fila externa é mantida exclusivamente pelo servidor.
          </Text>
        </View>
      </View>
    </View>
  );
}

function describeObservedDisableImpact(waitingCount, hasPendingCall) {
  const affectedCount = getDisableAffectedCount(waitingCount, hasPendingCall);
  if (affectedCount === 0) {
    return 'No estado observado, 0 participantes serão liberados. Outros participantes podem entrar ou sair antes da execução, e a quantidade final será confirmada pelo servidor.';
  }
  if (affectedCount === 1) {
    return hasPendingCall
      ? 'No estado observado, 1 participante (incluindo a chamada pendente) será liberado. Outros participantes podem entrar ou sair antes da execução, e a quantidade final será confirmada pelo servidor.'
      : 'No estado observado, 1 participante aguardando será liberado. Outros participantes podem entrar ou sair antes da execução, e a quantidade final será confirmada pelo servidor.';
  }
  return hasPendingCall
    ? `No estado observado, ${affectedCount} participantes (${waitingCount} aguardando e 1 em chamada pendente) serão liberados. Outros participantes podem entrar ou sair antes da execução, e a quantidade final será confirmada pelo servidor.`
    : `No estado observado, ${affectedCount} participantes aguardando serão liberados. Outros participantes podem entrar ou sair antes da execução, e a quantidade final será confirmada pelo servidor.`;
}

export function EntryQueueToggleCard({
  externalQueueEnabled,
  waitingCount,
  hasPendingCall = false,
  canManage,
  disabled,
  onDisableQueue,
  onEnableQueue,
}) {
  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionLabel}>CONTROLE DA FILA</Text>
      <View style={styles.card}>
        <Text style={styles.emptyTitle}>
          {externalQueueEnabled ? 'Desativar fila de entrada' : 'Reativar fila de entrada'}
        </Text>
        <Text style={styles.emptySubtitle}>
          {externalQueueEnabled
            ? `${describeObservedDisableImpact(waitingCount, hasPendingCall)} Isso não encerra o evento.`
            : 'Ao reativar, apenas novas participações passarão a aguardar chamada externa.'}
        </Text>
        <EntryActionButton
          label={externalQueueEnabled ? 'Desativar fila externa' : 'Reativar fila externa'}
          variant={externalQueueEnabled ? 'danger' : 'primary'}
          disabled={disabled || !canManage}
          onPress={externalQueueEnabled ? onDisableQueue : onEnableQueue}
        />
      </View>
    </View>
  );
}

function describeEntryDialog(dialog, waitingCount, hasPendingCall) {
  const action = dialog?.action;
  if (!action) {
    return { title: '', description: '', variant: 'primary', showsTarget: false };
  }
  if (action.kind === 'toggle') {
    const observedWaiting = dialog?.observedWaitingCount ?? waitingCount;
    const observedPending = dialog?.observedHasPendingCall ?? hasPendingCall;
    return action.enabled
      ? {
          title: 'Reativar fila externa?',
          description: 'Somente novas participações aguardarão. Quem já entrou permanece ativo.',
          variant: 'primary',
          showsTarget: false,
        }
      : {
          title: 'Desativar fila externa?',
          description: `${describeObservedDisableImpact(observedWaiting, observedPending)} Isso não encerra o evento nem altera filas de experiências.`,
          variant: 'danger',
          showsTarget: false,
        };
  }
  const metas = {
    call: { title: 'Chamar próximo participante?', variant: 'primary', showsTarget: false },
    confirm_call: { title: 'Confirmar entrada presencial?', variant: 'success', showsTarget: true },
    absent: { title: 'Marcar ausência externa?', variant: 'warning', showsTarget: true },
    remove: { title: 'Remover da fila externa?', variant: 'danger', showsTarget: true },
  };
  const chosen = metas[action.kind] ?? { title: '', variant: 'primary', showsTarget: false };
  return {
    title: chosen.title,
    description: 'Confirme a ação para a chamada externa apresentada. A remoção cancela somente a espera no evento.',
    variant: chosen.variant,
    showsTarget: chosen.showsTarget,
  };
}

export function EntryConfirmModal({ visible, dialog, pendingCall, waitingCount, onConfirm, onCancel }) {
  const meta = describeEntryDialog(dialog, waitingCount, Boolean(pendingCall));
  const participantLabel = meta.showsTarget ? dialog?.targetName || pendingCall?.displayName : null;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onCancel}>
      <SafeAreaView style={styles.modalSafe} edges={['top', 'right', 'bottom', 'left']}>
        <View style={styles.backdrop}>
          <View style={styles.modalCard} accessibilityViewIsModal>
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
              bounces={false}
              showsVerticalScrollIndicator
            >
              <Text style={styles.modalTitle} accessibilityRole="header">{meta.title}</Text>
              {participantLabel ? (
                <View style={styles.modalParticipantBox}>
                  <Text style={styles.modalParticipantCaption}>Participante selecionado</Text>
                  <Text style={styles.modalParticipantName}>{participantLabel}</Text>
                </View>
              ) : null}
              <Text style={styles.modalText}>{meta.description}</Text>
              <Text style={styles.modalNote}>
                Uma resposta incerta bloqueará novas alterações até verificação.
              </Text>
              <View style={styles.actionsColumn}>
                <EntryActionButton
                  label="CONFIRMAR ALTERAÇÃO"
                  variant={meta.variant}
                  disabled={false}
                  onPress={onConfirm}
                />
                <EntryActionButton
                  label="CANCELAR ALTERAÇÃO"
                  variant="secondary"
                  disabled={false}
                  onPress={onCancel}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const SEMANTIC_BUTTONS = {
  primary: {
    box: { backgroundColor: c.accentStrong, borderWidth: 1, borderColor: c.accent },
    text: { color: c.onAccent },
    iconColor: c.onAccent,
  },
  secondary: {
    box: { backgroundColor: '#251A33', borderWidth: 1, borderColor: c.border },
    text: { color: c.text },
    iconColor: c.text,
  },
  success: {
    box: { backgroundColor: 'rgba(16, 185, 129, 0.14)', borderWidth: 1.5, borderColor: '#10B981' },
    text: { color: c.text },
    iconColor: '#34D399',
  },
  warning: {
    box: { backgroundColor: 'rgba(245, 158, 11, 0.12)', borderWidth: 1.5, borderColor: '#F59E0B' },
    text: { color: c.text },
    iconColor: '#FCD34D',
  },
  danger: {
    box: { backgroundColor: 'rgba(239, 68, 68, 0.14)', borderWidth: 1.5, borderColor: '#EF4444' },
    text: { color: c.text },
    iconColor: '#FCA5A5',
  },
};

const styles = StyleSheet.create({
  headerSection: { gap: 4, marginTop: 2 },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  screenTitle: { color: c.text, fontSize: 28, lineHeight: 34, fontWeight: '700', flexShrink: 1 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  eventIconTile: { width: 26, height: 26, borderRadius: 8, backgroundColor: c.iconFill,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  eventName: { color: c.text, fontSize: 16, lineHeight: 22, fontWeight: '700', flexShrink: 1 },
  headerSubtitle: { color: c.muted, fontSize: 14, lineHeight: 20 },
  statusPill: { borderRadius: 24, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start', maxWidth: '100%' },
  statusPillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase' },
  pillSuccess: { backgroundColor: 'rgba(16, 185, 129, 0.14)', borderColor: '#10B981' },
  pillSuccessText: { color: '#34D399' },
  pillDanger: { backgroundColor: 'rgba(239, 68, 68, 0.14)', borderColor: '#EF4444' },
  pillDangerText: { color: '#FCA5A5' },
  sectionBlock: { gap: 8, marginTop: 4 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  sectionLabel: { color: c.accent, fontSize: 13, lineHeight: 18, fontWeight: '700', letterSpacing: 1.3 },
  sectionCount: { color: c.muted, fontSize: 14, lineHeight: 18, fontWeight: '600' },
  card: { ...live.card, marginTop: 0, gap: 10 },
  pendingCard: { ...live.card, marginTop: 0, gap: 12, backgroundColor: '#1B122C', borderWidth: 1.5, borderColor: c.border },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricTile: { flexGrow: 1, flexBasis: 130, backgroundColor: '#1E152E', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: 'rgba(196, 118, 237, 0.28)', gap: 2 },
  metricValue: { color: c.text, fontSize: 20, lineHeight: 26, fontWeight: '700' },
  metricCaption: { color: c.muted, fontSize: 12, lineHeight: 16 },
  summaryDescription: { color: c.muted, fontSize: 14, lineHeight: 20 },
  inlineWarningBox: { backgroundColor: c.warningSurface, borderWidth: 1, borderColor: c.warning, borderRadius: 12, padding: 12 },
  inlineWarningText: { color: '#FDE68A', fontSize: 13, lineHeight: 19 },
  emptyCallHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emptyQueueBox: { gap: 4, paddingVertical: 4 },
  emptyTitle: { color: c.text, fontSize: 17, lineHeight: 23, fontWeight: '700' },
  emptySubtitle: { color: c.muted, fontSize: 14, lineHeight: 20 },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowDivider: { height: 1, backgroundColor: 'rgba(196, 118, 237, 0.25)' },
  positionBadge: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#5B2E91',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  positionNumber: { color: c.onAccent, fontSize: 15, fontWeight: '700' },
  participantName: { color: c.text, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  participantState: { color: c.muted, fontSize: 13, lineHeight: 18 },
  nextPill: { borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.iconFill,
    paddingHorizontal: 10, paddingVertical: 4, flexShrink: 0 },
  nextPillText: { color: c.accent, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  sharedInfoBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.iconFill,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 4 },
  sharedInfoText: { color: '#E9D8FD', fontSize: 13, lineHeight: 18, fontWeight: '500', flex: 1 },
  calledHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  calledIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 160 },
  userTile: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.iconFill,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, gap: 3 },
  userHead: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.6, borderColor: c.accent },
  userShoulders: { width: 18, height: 8, borderTopLeftRadius: 8, borderTopRightRadius: 8,
    borderWidth: 1.6, borderBottomWidth: 0, borderColor: c.accent },
  calledName: { color: c.text, fontSize: 18, lineHeight: 24, fontWeight: '700' },
  calledStatus: { color: c.muted, fontSize: 13, lineHeight: 18 },
  pendingBadge: { borderRadius: 16, borderWidth: 1, borderColor: '#F59E0B', backgroundColor: 'rgba(245, 158, 11, 0.14)',
    paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  pendingBadgeText: { color: '#FCD34D', fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  timePillsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  timestampPill: { borderRadius: 20, borderWidth: 1, borderColor: 'rgba(196, 118, 237, 0.45)',
    backgroundColor: '#251A33', paddingHorizontal: 10, paddingVertical: 5, maxWidth: '100%' },
  timestampPillText: { color: c.text, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  cardDivider: { height: 1, backgroundColor: 'rgba(196, 118, 237, 0.28)' },
  actionPrompt: { color: c.muted, fontSize: 14, lineHeight: 20 },
  actionsColumn: { gap: 10 },
  semanticButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    minHeight: 48, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12 },
  semanticButtonText: { fontSize: 15, lineHeight: 20, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  actionIconBox: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  checkMark: { width: 12, height: 7, borderLeftWidth: 2, borderBottomWidth: 2, transform: [{ rotate: '-45deg' }], marginBottom: 3 },
  calendarBox: { width: 16, height: 15, borderRadius: 3, borderWidth: 1.5, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' },
  calendarBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 4 },
  calendarCross: { fontSize: 10, fontWeight: '800', lineHeight: 11 },
  trashLid: { width: 14, height: 2, borderRadius: 1, marginBottom: 1.5 },
  trashCan: { width: 12, height: 12, borderWidth: 1.5, borderTopWidth: 0, borderBottomLeftRadius: 2, borderBottomRightRadius: 2,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', paddingVertical: 2 },
  trashLine: { width: 1.5, height: 6, borderRadius: 1 },
  modalSafe: { flex: 1, backgroundColor: 'rgba(9, 4, 18, 0.8)' },
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 460, maxHeight: '100%', backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 18, overflow: 'hidden' },
  modalScroll: { flexGrow: 0, flexShrink: 1 },
  modalScrollContent: { padding: 20, gap: 12 },
  modalTitle: { color: c.text, fontSize: 19, lineHeight: 25, fontWeight: '700' },
  modalParticipantBox: { backgroundColor: '#1E152E', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(196, 118, 237, 0.35)', gap: 2 },
  modalParticipantCaption: { color: c.muted, fontSize: 12, lineHeight: 16 },
  modalParticipantName: { color: c.text, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  modalText: { color: c.muted, fontSize: 15, lineHeight: 22 },
  modalNote: { color: '#FCD34D', fontSize: 13, lineHeight: 19 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});
