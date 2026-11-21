import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AdminIcon, liveColors as c, liveStyles as live } from '../../admin/components/AdminLiveUI';

const MAX_RELIABLE_ELAPSED_MS = 24 * 60 * 60 * 1000;
const MAX_NEGATIVE_SKEW_MS = 60 * 1000;
const defaultGetNow = () => Date.now();

export function formatElapsedSinceCall(calledAt, nowMs = Date.now()) {
  if (typeof calledAt !== 'string' || !calledAt.trim()) {
    return { label: 'Chamada pendente', live: false };
  }
  const calledMs = Date.parse(calledAt);
  if (!Number.isFinite(calledMs) || !Number.isFinite(nowMs)) {
    return { label: 'Chamada pendente', live: false };
  }
  const diffMs = nowMs - calledMs;
  if (diffMs < -MAX_NEGATIVE_SKEW_MS || diffMs > MAX_RELIABLE_ELAPSED_MS) {
    return { label: 'Chamada pendente', live: false };
  }
  const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, '0');
  const formatted = hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
  return { label: `Chamado há ${formatted}`, live: true };
}

function StationGamepadIcon() {
  return (
    <View style={styles.gamepadBody} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={styles.gamepadPlus}>+</Text>
      <View style={styles.gamepadDots}>
        <View style={styles.gamepadDot} />
        <View style={styles.gamepadDot} />
      </View>
    </View>
  );
}

function StationUserTile() {
  return (
    <View style={styles.userTile} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.userHead} />
      <View style={styles.userShoulders} />
    </View>
  );
}

function ActionIcon({ kind, color }) {
  if (kind === 'complete') {
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

export function StationStatusBadge({ availability }) {
  const isAvailable = availability === 'available';
  return (
    <View style={[styles.statusPill, isAvailable ? styles.pillSuccess : styles.pillDanger]}>
      <Text style={[styles.statusPillText, isAvailable ? styles.pillSuccessText : styles.pillDangerText]}>
        {isAvailable ? 'DISPONÍVEL' : 'INDISPONÍVEL'}
      </Text>
    </View>
  );
}

export function StationHeaderCard({ stationLabel, experienceName, eventName, availability }) {
  return (
    <View style={styles.headerSection}>
      <View style={styles.headerTopRow}>
        <Text style={styles.stationTitle} accessibilityRole="header">{stationLabel}</Text>
        <StationStatusBadge availability={availability} />
      </View>
      <View style={styles.experienceRow}>
        <StationGamepadIcon />
        <Text style={styles.experienceName}>{experienceName}</Text>
      </View>
      <Text style={styles.eventName}>{eventName}</Text>
    </View>
  );
}

export function ExperienceQueueCard({ waitingCount, waiting }) {
  return (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionLabel}>FILA DA EXPERIÊNCIA</Text>
        <Text style={styles.sectionCount}>{waitingCount} aguardando</Text>
      </View>

      <View style={styles.card}>
        {waiting.length === 0 ? (
          <View style={styles.emptyQueueBox}>
            <Text style={styles.emptyTitle}>Fila vazia</Text>
            <Text style={styles.emptySubtitle}>Nenhuma pessoa aguardando nesta experiência.</Text>
          </View>
        ) : (
          <View>
            {waiting.map((person, index) => (
              <View key={person.queueEntryId}>
                {index > 0 && <View style={styles.rowDivider} />}
                <View style={styles.queueRow}>
                  <View style={styles.positionBadge}>
                    <Text style={styles.positionNumber}>{person.position}</Text>
                  </View>
                  <View style={live.grow}>
                    <Text style={styles.participantName}>{person.displayName}</Text>
                    <Text style={styles.participantState}>Aguardando</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.sharedInfoBox} accessible accessibilityLabel="Fila compartilhada entre as estações">
          <AdminIcon name="users" color={c.accent} size={20} />
          <Text style={styles.sharedInfoText}>Fila compartilhada entre as estações</Text>
        </View>
      </View>
    </View>
  );
}

export function ElapsedCallBadge({ calledAt, getNow = defaultGetNow }) {
  const getNowRef = useRef(getNow);
  getNowRef.current = getNow;
  const [nowMs, setNowMs] = useState(() => getNowRef.current());
  const elapsed = formatElapsedSinceCall(calledAt, nowMs);

  useEffect(() => {
    const initialNow = getNowRef.current();
    setNowMs(initialNow);
    if (!formatElapsedSinceCall(calledAt, initialNow).live) return undefined;
    const timer = setInterval(() => {
      setNowMs(getNowRef.current());
    }, 1000);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return () => clearInterval(timer);
  }, [calledAt]);

  return (
    <View style={styles.elapsedPill}>
      <AdminIcon name="history" color={c.muted} size={14} />
      <Text style={styles.elapsedText}>{elapsed.label}</Text>
    </View>
  );
}

function SemanticActionButton({ label, kind, variant, disabled, onPress }) {
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
      {kind ? <ActionIcon kind={kind} color={tone.iconColor} /> : null}
      <Text style={[styles.semanticButtonText, tone.text]}>{label}</Text>
    </Pressable>
  );
}

export function CurrentServiceCard({ pending, blocked, onComplete, onAbsent, onRemove, getNow }) {
  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionLabel}>ATENDIMENTO ATUAL</Text>

      {!pending ? (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>Nenhum participante chamado</Text>
          <Text style={styles.emptySubtitle}>
            Após chamar, resolva o atendimento antes da próxima chamada.
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <View style={styles.calledHeaderRow}>
            <View style={styles.calledIdentity}>
              <StationUserTile />
              <View style={live.grow}>
                <Text style={styles.calledName}>{pending.displayName}</Text>
                <Text style={styles.calledStatus}>Em atendimento</Text>
              </View>
            </View>
            <ElapsedCallBadge calledAt={pending.calledAt} getNow={getNow} />
          </View>

          <View style={styles.cardDivider} />

          <Text style={styles.actionPrompt}>Selecione a ação para este participante:</Text>

          <View style={styles.actionsColumn}>
            <SemanticActionButton
              label="Concluir experiência"
              kind="complete"
              variant="success"
              disabled={blocked}
              onPress={() => onComplete(pending.serviceSessionId)}
            />
            <SemanticActionButton
              label="Marcar ausência"
              kind="absent"
              variant="warning"
              disabled={blocked}
              onPress={() => onAbsent(pending.serviceSessionId)}
            />
            <SemanticActionButton
              label="Remover da fila"
              kind="remove"
              variant="danger"
              disabled={blocked}
              onPress={() => onRemove(pending.serviceSessionId)}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function describeDialog(kind) {
  switch (kind) {
    case 'complete':
      return {
        title: 'Concluir experiência?',
        description: 'Confirma a conclusão desta experiência para o participante chamado? A participação no evento continua ativa.',
        variant: 'success',
      };
    case 'absent':
      return {
        title: 'Marcar ausência?',
        description: 'O participante será marcado como ausente e seguirá a regra vigente do servidor (reinserção ao fim da fila ou encerramento após o corte).',
        variant: 'warning',
      };
    case 'remove_called':
      return {
        title: 'Remover da fila?',
        description: 'Remove o participante chamado apenas desta fila de experiência, sem concluir a experiência, sem marcar ausência e sem cancelar o evento.',
        variant: 'danger',
      };
    default:
      return {
        title: 'Chamar o próximo participante?',
        description: 'Confirme a operação presencial para esta estação.',
        variant: 'primary',
      };
  }
}

export function StationConfirmModal({ visible, dialog, onConfirm, onCancel }) {
  const meta = describeDialog(dialog?.action?.kind);
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
              <Text style={styles.modalText}>{meta.description}</Text>
              <Text style={styles.modalNote}>
                Uma resposta incerta bloqueará novas ações até reconciliação.
              </Text>
              <View style={styles.actionsColumn}>
                <SemanticActionButton
                  label="CONFIRMAR OPERAÇÃO"
                  variant={meta.variant}
                  disabled={false}
                  onPress={onConfirm}
                />
                <SemanticActionButton
                  label="CANCELAR OPERAÇÃO"
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
  stationTitle: { color: c.text, fontSize: 28, lineHeight: 34, fontWeight: '700', flexShrink: 1 },
  experienceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  experienceName: { color: c.text, fontSize: 16, lineHeight: 22, fontWeight: '700', flexShrink: 1 },
  eventName: { color: c.muted, fontSize: 14, lineHeight: 20 },
  statusPill: { borderRadius: 24, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start', maxWidth: '100%' },
  statusPillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase' },
  pillSuccess: { backgroundColor: 'rgba(16, 185, 129, 0.14)', borderColor: '#10B981' },
  pillSuccessText: { color: '#34D399' },
  pillDanger: { backgroundColor: 'rgba(239, 68, 68, 0.14)', borderColor: '#EF4444' },
  pillDangerText: { color: '#FCA5A5' },
  gamepadBody: { width: 24, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: c.accent,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, flexShrink: 0 },
  gamepadPlus: { color: c.accent, fontSize: 10, fontWeight: '800', lineHeight: 11 },
  gamepadDots: { flexDirection: 'row', gap: 2 },
  gamepadDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: c.accent },
  sectionBlock: { gap: 8, marginTop: 4 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  sectionLabel: { color: c.accent, fontSize: 13, lineHeight: 18, fontWeight: '700', letterSpacing: 1.3 },
  sectionCount: { color: c.muted, fontSize: 14, lineHeight: 18, fontWeight: '600' },
  card: { ...live.card, marginTop: 0, gap: 10 },
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
  sharedInfoBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.iconFill,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 4 },
  sharedInfoText: { color: '#E9D8FD', fontSize: 13, lineHeight: 18, fontWeight: '500', flex: 1 },
  calledHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  calledIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  userTile: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.iconFill,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, gap: 3 },
  userHead: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.6, borderColor: c.accent },
  userShoulders: { width: 18, height: 8, borderTopLeftRadius: 8, borderTopRightRadius: 8,
    borderWidth: 1.6, borderBottomWidth: 0, borderColor: c.accent },
  calledName: { color: c.text, fontSize: 18, lineHeight: 24, fontWeight: '700' },
  calledStatus: { color: c.muted, fontSize: 14, lineHeight: 20 },
  elapsedPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, borderWidth: 1,
    borderColor: 'rgba(196, 118, 237, 0.45)', backgroundColor: '#1E152E', paddingHorizontal: 10, paddingVertical: 5,
    maxWidth: '100%' },
  elapsedText: { color: c.muted, fontSize: 12, lineHeight: 16, fontWeight: '600', flexShrink: 1 },
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
  modalText: { color: c.muted, fontSize: 15, lineHeight: 22 },
  modalNote: { color: '#FCD34D', fontSize: 13, lineHeight: 19 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});
