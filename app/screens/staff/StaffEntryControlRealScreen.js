import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '../../context/AuthContext';
import { createStaffEntryStore } from '../../services/staffEntryService';
import { defaultStaffEntryIntentStorage } from '../../services/staffEntryIntentStorage';
import { liveColors as c, liveStyles as live } from '../admin/components/AdminLiveUI';
import {
  EntryActionButton,
  EntryConfirmModal,
  EntryCurrentCallCard,
  EntryHeaderCard,
  EntryQueueListCard,
  EntryQueueToggleCard,
  EntrySummaryCard,
} from './components/StaffEntrySections';
import { useStaffPolling } from './useStaffPolling';

export default function StaffEntryControlRealScreen({
  event,
  isEventCurrent,
  accessDenied = false,
  accessDeniedKind = 'denied',
  onAccessDenied,
  getNow,
}) {
  const auth = useAuth();
  const focused = useIsFocused();
  const [appState, setAppState] = useState(() => AppState?.currentState ?? 'active');
  const liveRef = useRef(null);
  liveRef.current = { auth, event, isEventCurrent, accessDenied, onAccessDenied };

  useEffect(() => {
    if (typeof AppState?.addEventListener !== 'function') return undefined;
    const subscription = AppState.addEventListener('change', (next) => {
      setAppState(next);
    });
    return () => subscription?.remove?.();
  }, []);

  const getContext = () => {
    const { auth: current, event: selected, isEventCurrent: selectedIsCurrent, accessDenied: revoked } = liveRef.current;
    if (
      revoked
      || !current?.isAuthenticated
      || !current.isIdentityVerified()
      || !current.sessionId
      || !selectedIsCurrent()
      || !current.user?.roles?.includes('staff')
      || current.user.roles.includes('admin')
    ) return null;
    return {
      userId: current.user.id,
      sessionId: current.sessionId,
      eventId: selected.id,
      epoch: current.getSessionEpoch(),
      revision: current.getIdentityRevision(),
    };
  };

  const storeRef = useRef(null);
  if (!storeRef.current) {
    storeRef.current = createStaffEntryStore({
      client: {
        get: (...args) => liveRef.current.auth.httpClient.get(...args),
        post: (...args) => liveRef.current.auth.httpClient.post(...args),
        patch: (...args) => liveRef.current.auth.httpClient.patch(...args),
      },
      storage: defaultStaffEntryIntentStorage,
      createKey: randomUUID,
      getContext,
    });
  }
  const store = storeRef.current;
  const [snapshot, setSnapshot] = useState(store.getSnapshot());
  const [notice, setNotice] = useState(null);
  const autoAttempt = useRef(null);
  const [dialog, setDialog] = useState(null);
  const dialogRef = useRef(null);
  dialogRef.current = dialog;
  const epoch = auth.getSessionEpoch();
  const revision = auth.getIdentityRevision();

  useEffect(() => store.subscribe(setSnapshot), [store]);

  useEffect(() => {
    autoAttempt.current = null;
    setNotice(null);
    store.setContext(getContext());
    setDialog(null);
    if (!liveRef.current.accessDenied) void store.refresh();
    return () => {
      dialogRef.current = null;
      store.setContext(null);
    };
  }, [store, event.id, auth.user?.id, auth.sessionId, epoch, revision]);

  useEffect(() => {
    if (!accessDenied) return;
    dialogRef.current = null;
    setDialog(null);
    setNotice(null);
    autoAttempt.current = null;
    store.setContext(null);
  }, [accessDenied, store]);

  useEffect(() => {
    if (
      snapshot.status === 'error'
      && (snapshot.error === 'denied' || snapshot.error === 'session')
      && store.isCurrent(snapshot.context)
    ) {
      dialogRef.current = null;
      setDialog(null);
      liveRef.current.onAccessDenied?.(snapshot.error);
    }
  }, [snapshot.status, snapshot.error, snapshot.context, store]);

  const pollingEnabled = !accessDenied && store.isCurrent(snapshot.context) && snapshot.status === 'ready' && !snapshot.busy;
  useStaffPolling(pollingEnabled, () => store.poll(), 5000, `${event.id}:${epoch}:${revision}`);

  useEffect(() => {
    const intent = snapshot.pending;
    const scope = snapshot.context;
    if (
      accessDenied
      || intent?.phase !== 'terminal'
      || snapshot.status !== 'ready'
      || snapshot.busy
      || !store.isCurrent(scope)
      || !['userId', 'sessionId', 'eventId'].every((key) => intent[key] === scope[key])
      || autoAttempt.current === intent.key
    ) return;
    autoAttempt.current = intent.key;
    void (async () => {
      const result = await store.acknowledge(intent.key);
      if (result.kind === 'done' && store.isCurrent(scope)) {
        setNotice({ key: intent.key, outcome: intent.outcome, operation: intent.kind });
      }
      if (result.kind === 'blocked') autoAttempt.current = null;
    })();
  }, [accessDenied, snapshot, store]);

  const errors = {
    session: 'Sessão inválida. Verifique sua sessão ou entre novamente.',
    denied: 'Acesso ao evento indisponível. Atualize seus eventos autorizados.',
    network: 'Não foi possível conectar. Verifique sua conexão e atualize.',
    unavailable: 'Não foi possível consultar a fila de entrada. Tente atualizar.',
  };

  if (accessDenied) {
    return (
      <View style={styles.content}>
        <EntryHeaderCard eventName={event?.name} externalQueueEnabled={null} />
        <View style={styles.errorCard}>
          <Text accessibilityRole="alert" style={styles.alertMessage}>
            {accessDeniedKind === 'session' ? errors.session : errors.denied}
          </Text>
        </View>
      </View>
    );
  }

  if (!store.isCurrent(snapshot.context)) return null;

  const ownPending = snapshot.pending
    && ['userId', 'sessionId', 'eventId'].every((key) => snapshot.pending[key] === snapshot.context[key]);
  const pending = ownPending ? snapshot.pending : null;
  const disabled = snapshot.busy
    || snapshot.status !== 'ready'
    || snapshot.error === 'stale'
    || !snapshot.data
    || Boolean(snapshot.pending)
    || snapshot.storageError
    || !defaultStaffEntryIntentStorage.isPersistent;

  const runDirect = (action) => {
    if (
      disabled
      || dialogRef.current
      || !store.isCurrent(snapshot.context)
      || (action.kind === 'call'
        ? !snapshot.data.canCall
        : action.kind !== 'toggle' || action.enabled !== true || !snapshot.data.canManage || snapshot.data.externalQueueEnabled)
    ) return;
    setNotice(null);
    return store.mutate(action);
  };

  const open = (action, targetName = null) => {
    if (!disabled && store.isCurrent()) setDialog({ action, targetName, context: snapshot.context });
  };

  const confirm = (expected) => {
    if (!expected || dialogRef.current !== expected || !store.isCurrent(expected.context)) return;
    dialogRef.current = null;
    setDialog(null);
    setNotice(null);
    return store.mutate(expected.action);
  };

  const refresh = () => {
    if (liveRef.current.accessDenied) return;
    dialogRef.current = null;
    setDialog(null);
    autoAttempt.current = null;
    void store.refresh();
  };

  const noticeText = (() => {
    if (!notice || snapshot.pending || snapshot.storageError) return null;
    if (notice.outcome.kind === 'confirmed') {
      if (notice.operation !== 'toggle') {
        return {
          call: 'Participante chamado pelo servidor.',
          confirm_call: 'Entrada confirmada pelo servidor.',
          absent: 'Ausência registrada pelo servidor.',
          remove: 'Participante removido da espera externa.',
        }[notice.operation] ?? 'Entrada confirmada pelo servidor.';
      }
      return `Fila ${notice.outcome.result.externalQueueEnabled ? 'reativada' : 'desativada'}. Participantes liberados: ${notice.outcome.result.releasedCount}.`;
    }
    return notice.outcome.code === 'ENTRY_NOT_FIRST'
      ? 'A fila mudou. Confira o primeiro participante na lista atualizada.'
      : 'A solicitação foi recusada pelo servidor. Confira o estado atualizado.';
  })();

  const pollingIndicator = (() => {
    if (accessDenied || (snapshot.status === 'error' && (snapshot.error === 'denied' || snapshot.error === 'session'))) {
      return null;
    }
    if (snapshot.error === 'stale') {
      return { dotStyle: styles.pollingDotStale, text: 'Dados desatualizados · tentando atualizar a cada 5s' };
    }
    if (snapshot.status === 'error') {
      return { dotStyle: styles.pollingDotMuted, text: 'Atualização indisponível · aguardando recuperação' };
    }
    if (!pollingEnabled || !focused || appState !== 'active') {
      return { dotStyle: styles.pollingDotStale, text: 'Atualização temporariamente pausada' };
    }
    return { dotStyle: styles.pollingDotActive, text: 'Atualização automática ativa · a cada 5s' };
  })();

  const data = snapshot.data;

  return (
    <View style={styles.content}>
      <EntryHeaderCard
        eventName={event?.name}
        externalQueueEnabled={data ? data.externalQueueEnabled : null}
      />

      {snapshot.status === 'loading' && (
        <View accessibilityRole="progressbar" style={styles.stateCard}>
          <ActivityIndicator color={c.accent} />
          <Text style={styles.message}>Carregando fila de entrada...</Text>
        </View>
      )}

      {snapshot.status === 'error' && (
        <View style={styles.errorCard}>
          <Text accessibilityRole="alert" style={styles.alertMessage}>
            {errors[snapshot.error] ?? errors.unavailable}
          </Text>
        </View>
      )}

      {snapshot.error === 'stale' && (
        <View style={styles.warningCard}>
          <Text accessibilityRole="alert" style={styles.warningMessage}>
            Dados de entrada possivelmente desatualizados. Atualize antes de operar.
          </Text>
        </View>
      )}

      {snapshot.storageError && (
        <View style={styles.warningCard}>
          <Text accessibilityRole="alert" style={styles.warningMessage}>
            Não foi possível verificar o registro seguro da solicitação. Atualize antes de continuar.
          </Text>
        </View>
      )}

      {snapshot.knownOutcome?.kind === 'confirmed' && pending?.phase !== 'terminal' && (
        <View style={styles.successCard}>
          <Text style={styles.successMessage}>
            O servidor confirmou a alteração, mas o registro local não foi confirmado. Não repita a operação; procure o responsável.
          </Text>
        </View>
      )}

      {!defaultStaffEntryIntentStorage.isPersistent && (
        <View style={styles.warningCard}>
          <Text style={styles.warningMessage}>
            As alterações de entrada estão disponíveis somente no aplicativo com armazenamento seguro.
          </Text>
        </View>
      )}

      {snapshot.pending && !ownPending && (
        <View style={styles.warningCard}>
          <Text style={styles.warningMessage}>
            Há uma solicitação de entrada pendente em outro evento ou sessão desta conta. Procure o responsável antes de continuar.
          </Text>
        </View>
      )}

      {pending?.phase === 'dispatching' && (
        <View style={styles.warningCard}>
          <Text accessibilityRole="alert" style={styles.warningMessage}>
            O resultado de uma solicitação ainda não foi confirmado. Não repita a operação. As alterações estão bloqueadas até verificação pelo responsável.
          </Text>
        </View>
      )}

      {pending?.phase === 'reserved' && (
        <View style={styles.warningCard}>
          <Text style={styles.warningMessage}>Há uma solicitação registrada que ainda não foi enviada.</Text>
          <EntryActionButton
            label="Descartar solicitação não enviada"
            variant="secondary"
            disabled={snapshot.busy}
            onPress={() => { void store.cancelReserved(pending.key); }}
          />
        </View>
      )}

      {pending?.phase === 'terminal' && (
        <View style={styles.warningCard}>
          <Text accessibilityRole="alert" style={styles.warningMessage}>
            Resultado registrado; verificando o reconhecimento seguro. As alterações permanecem bloqueadas até a confirmação local.
          </Text>
        </View>
      )}

      {noticeText && (
        <View style={notice.outcome.kind === 'confirmed' ? styles.successCard : styles.warningCard}>
          <Text accessibilityRole="alert" style={notice.outcome.kind === 'confirmed' ? styles.successMessage : styles.warningMessage}>
            {noticeText}
          </Text>
        </View>
      )}

      {data && (
        <>
          <EntrySummaryCard
            externalQueueEnabled={data.externalQueueEnabled}
            waitingCount={data.waitingCount}
            hasPendingCall={Boolean(data.pendingCall)}
            canManage={data.canManage}
          />

          <EntryCurrentCallCard
            pendingCall={data.pendingCall}
            canCall={data.canCall}
            canConfirm={data.canConfirm}
            canMarkAbsent={data.canMarkAbsent}
            canRemove={data.canRemove}
            disabled={disabled}
            hasWaiting={data.waiting.length > 0}
            externalQueueEnabled={data.externalQueueEnabled}
            onCallNext={() => runDirect({ kind: 'call' })}
            onConfirmEntry={() => open({ kind: 'confirm_call', callId: data.pendingCall.id }, data.pendingCall.displayName)}
            onMarkAbsent={() => open({ kind: 'absent', callId: data.pendingCall.id }, data.pendingCall.displayName)}
            onRemoveFromQueue={() => open({ kind: 'remove', callId: data.pendingCall.id }, data.pendingCall.displayName)}
            getNow={getNow}
          />

          <EntryQueueListCard
            waiting={data.waiting}
            waitingCount={data.waitingCount}
            externalQueueEnabled={data.externalQueueEnabled}
            hasPendingCall={Boolean(data.pendingCall)}
          />

          <EntryQueueToggleCard
            externalQueueEnabled={data.externalQueueEnabled}
            waitingCount={data.waitingCount}
            canManage={data.canManage}
            disabled={disabled}
            onDisableQueue={() => open({ kind: 'toggle', enabled: false })}
            onEnableQueue={() => runDirect({ kind: 'toggle', enabled: true })}
          />
        </>
      )}

      {pollingIndicator && (
        <View style={styles.pollingRow}>
          <View style={[styles.pollingDot, pollingIndicator.dotStyle]} />
          <Text style={styles.pollingText}>{pollingIndicator.text}</Text>
        </View>
      )}

      <EntryActionButton
        label="Atualizar fila de entrada"
        variant="secondary"
        disabled={snapshot.busy || snapshot.status === 'loading'}
        onPress={refresh}
      />

      <EntryConfirmModal
        visible={Boolean(!accessDenied && dialog && store.isCurrent(dialog.context) && !snapshot.busy)}
        dialog={dialog}
        pendingCall={data?.pendingCall ?? null}
        waitingCount={data?.waitingCount ?? 0}
        onConfirm={() => confirm(dialog)}
        onCancel={() => {
          dialogRef.current = null;
          setDialog(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12 },
  stateCard: { ...live.card, ...live.row, marginTop: 0 },
  errorCard: { ...live.card, marginTop: 0, backgroundColor: c.dangerSurface, borderColor: c.danger, gap: 8 },
  warningCard: { ...live.card, marginTop: 0, backgroundColor: c.warningSurface, borderColor: c.warning, gap: 10 },
  successCard: { ...live.card, marginTop: 0, backgroundColor: c.successSurface, borderColor: '#10B981', gap: 8 },
  message: { color: c.muted, fontSize: 15, lineHeight: 22, flexShrink: 1 },
  alertMessage: { color: '#FECACA', fontSize: 14, lineHeight: 20 },
  warningMessage: { color: '#FDE68A', fontSize: 14, lineHeight: 20 },
  successMessage: { color: '#A7F3D0', fontSize: 14, lineHeight: 20 },
  pollingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  pollingDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  pollingDotActive: { backgroundColor: '#10B981' },
  pollingDotStale: { backgroundColor: '#F59E0B' },
  pollingDotMuted: { backgroundColor: '#64748B' },
  pollingText: { color: c.muted, fontSize: 13, lineHeight: 18, flex: 1 },
});
