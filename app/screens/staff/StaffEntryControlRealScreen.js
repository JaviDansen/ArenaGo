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
  getDisableAffectedCount,
} from './components/StaffEntrySections';
import {
  describeEntryNotice,
  resolveStaffPollingIndicator,
  StaffPollingStatusPill,
} from './components/StaffSyncFeedback';
import { useStaffPolling } from './useStaffPolling';

function evaluateEntryDialog(candidate, currentSnapshot, currentStore) {
  if (
    !candidate
    || !currentStore.isCurrent(candidate.context)
    || currentSnapshot.status !== 'ready'
    || currentSnapshot.busy
    || Boolean(currentSnapshot.pending)
    || currentSnapshot.storageError
    || !currentSnapshot.data
  ) {
    return { valid: false, reason: 'state' };
  }
  if (currentSnapshot.error === 'stale') {
    return { valid: false, reason: 'stale' };
  }
  const currentData = currentSnapshot.data;
  const action = candidate.action;
  if (action.kind === 'toggle') {
    if (!currentData.canManage || currentData.externalQueueEnabled === action.enabled) {
      return { valid: false, reason: 'toggle_state' };
    }
    if (action.enabled === false) {
      const currentAffected = getDisableAffectedCount(currentData.waitingCount, currentData.pendingCall);
      const currentHasPending = Boolean(currentData.pendingCall);
      if (
        currentAffected !== candidate.observedAffectedCount
        || currentHasPending !== candidate.observedHasPendingCall
      ) {
        return { valid: false, reason: 'toggle_count' };
      }
    }
    return { valid: true, reason: null };
  }
  if (['confirm_call', 'absent', 'remove'].includes(action.kind)) {
    const permissionKey = {
      confirm_call: 'canConfirm',
      absent: 'canMarkAbsent',
      remove: 'canRemove',
    }[action.kind];
    if (
      !currentData.externalQueueEnabled
      || !currentData.pendingCall
      || currentData.pendingCall.id !== action.callId
      || currentData.pendingCall.participationId !== candidate.observedParticipationId
      || !currentData[permissionKey]
    ) {
      return { valid: false, reason: 'call_changed' };
    }
    return { valid: true, reason: null };
  }
  return { valid: false, reason: 'state' };
}

function staleMessageForReason(reason) {
  if (reason === 'stale') {
    return 'Não foi possível confirmar se o estado da fila permanece atual. Atualize antes de confirmar.';
  }
  if (reason === 'toggle_count') {
    return 'A quantidade de participantes na fila externa mudou. Confira o estado atualizado antes de desativar.';
  }
  if (reason === 'toggle_state') {
    return 'O estado ou as permissões da fila externa mudaram. Confira a tela atualizada antes de confirmar.';
  }
  return 'A chamada externa ou as permissões mudaram. Confira o estado atualizado antes de confirmar.';
}

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
  const [staleDialogMessage, setStaleDialogMessage] = useState(null);
  const [busyStage, setBusyStage] = useState(null);
  const busyTokenRef = useRef(0);
  const autoAttempt = useRef(null);
  const [dialog, setDialog] = useState(null);
  const dialogRef = useRef(null);
  dialogRef.current = dialog;
  const epoch = auth.getSessionEpoch();
  const revision = auth.getIdentityRevision();

  useEffect(() => store.subscribe(setSnapshot), [store]);

  useEffect(() => {
    autoAttempt.current = null;
    busyTokenRef.current += 1;
    setNotice(null);
    setStaleDialogMessage(null);
    setBusyStage(null);
    store.setContext(getContext());
    setDialog(null);
    if (!liveRef.current.accessDenied) void store.refresh();
    return () => {
      busyTokenRef.current += 1;
      dialogRef.current = null;
      store.setContext(null);
    };
  }, [store, event.id, auth.user?.id, auth.sessionId, epoch, revision]);

  useEffect(() => {
    if (!accessDenied) return;
    busyTokenRef.current += 1;
    dialogRef.current = null;
    setDialog(null);
    setNotice(null);
    setStaleDialogMessage(null);
    setBusyStage(null);
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
      setStaleDialogMessage(null);
      liveRef.current.onAccessDenied?.(snapshot.error);
    }
  }, [snapshot.status, snapshot.error, snapshot.context, store]);

  useEffect(() => {
    if (!dialog) return;
    if (accessDenied) {
      dialogRef.current = null;
      setDialog(null);
      return;
    }
    const check = evaluateEntryDialog(dialog, snapshot, store);
    if (check.valid) return;
    dialogRef.current = null;
    setDialog(null);
    if (snapshot.status === 'error' && (snapshot.error === 'denied' || snapshot.error === 'session')) {
      return;
    }
    setNotice(null);
    setStaleDialogMessage(staleMessageForReason(check.reason));
  }, [accessDenied, dialog, snapshot, store]);

  // Mantém polling de 5s ativo também durante modais porque StaffEventsNavigator não consulta
  // /entry-control nesta subtela; qualquer mudança de chamada, permissão, contagem ou 401/403 invalida o modal.
  const recoverableError = snapshot.status === 'error'
    && (snapshot.error === 'network' || snapshot.error === 'unavailable');
  const pollingEnabled = !accessDenied
    && store.isCurrent(snapshot.context)
    && (snapshot.status === 'ready' || recoverableError)
    && !snapshot.busy;
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
    const busyToken = ++busyTokenRef.current;
    setBusyStage('acknowledging');
    void (async () => {
      try {
        const result = await store.acknowledge(intent.key);
        if (result.kind === 'done' && store.isCurrent(scope)) {
          setNotice({ key: intent.key, outcome: intent.outcome, operation: intent.kind });
        }
        if (result.kind === 'blocked' && store.isCurrent(scope)) autoAttempt.current = null;
      } finally {
        if (busyTokenRef.current === busyToken && store.isCurrent(scope)) {
          setBusyStage(null);
        }
      }
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
    const latest = store.getSnapshot();
    if (
      liveRef.current.accessDenied
      || disabled
      || dialogRef.current
      || latest.busy
      || latest.status !== 'ready'
      || latest.error === 'stale'
      || !latest.data
      || Boolean(latest.pending)
      || latest.storageError
      || !store.isCurrent(latest.context)
      || (action.kind === 'call'
        ? !latest.data.canCall || Boolean(latest.data.pendingCall)
        : action.kind !== 'toggle' || action.enabled !== true || !latest.data.canManage || latest.data.externalQueueEnabled)
    ) return;
    setNotice(null);
    setStaleDialogMessage(null);
    const busyToken = ++busyTokenRef.current;
    const originScope = latest.context;
    setBusyStage('preparing');
    return Promise.resolve(store.mutate(action)).finally(() => {
      if (busyTokenRef.current === busyToken && store.isCurrent(originScope)) {
        setBusyStage(null);
      }
    });
  };

  const open = (action, targetName = null) => {
    const latest = store.getSnapshot();
    if (disabled || !store.isCurrent(latest.context) || !latest.data) return;
    const candidate = {
      action,
      targetName,
      context: latest.context,
      observedParticipationId: latest.data.pendingCall?.participationId ?? null,
      observedWaitingCount: latest.data.waitingCount,
      observedHasPendingCall: Boolean(latest.data.pendingCall),
      observedAffectedCount: getDisableAffectedCount(latest.data.waitingCount, latest.data.pendingCall),
    };
    const check = evaluateEntryDialog(candidate, latest, store);
    if (!check.valid) {
      setNotice(null);
      setStaleDialogMessage(staleMessageForReason(check.reason));
      return;
    }
    setStaleDialogMessage(null);
    setDialog(candidate);
  };

  const confirm = (expected) => {
    if (!expected || liveRef.current.accessDenied || dialogRef.current !== expected) return;
    const latest = store.getSnapshot();
    const check = evaluateEntryDialog(expected, latest, store);
    dialogRef.current = null;
    setDialog(null);
    if (!check.valid) {
      if (!(latest.status === 'error' && (latest.error === 'denied' || latest.error === 'session'))) {
        setNotice(null);
        setStaleDialogMessage(staleMessageForReason(check.reason));
      }
      return;
    }
    setNotice(null);
    setStaleDialogMessage(null);
    const busyToken = ++busyTokenRef.current;
    const originScope = expected.context;
    setBusyStage('preparing');
    return Promise.resolve(store.mutate(expected.action)).finally(() => {
      if (busyTokenRef.current === busyToken && store.isCurrent(originScope)) {
        setBusyStage(null);
      }
    });
  };

  const refresh = () => {
    if (liveRef.current.accessDenied) return;
    dialogRef.current = null;
    setDialog(null);
    setStaleDialogMessage(null);
    autoAttempt.current = null;
    void store.refresh();
  };

  const noticeText = (!notice || snapshot.pending || snapshot.storageError)
    ? null
    : describeEntryNotice(notice);

  const pollingIndicator = resolveStaffPollingIndicator({
    hidden: accessDenied || (snapshot.status === 'error' && (snapshot.error === 'denied' || snapshot.error === 'session')),
    loading: snapshot.status === 'loading',
    pollingEnabled,
    visible: focused && appState === 'active',
    stale: snapshot.error === 'stale',
    recoverableError,
    intervalSeconds: 5,
  });

  const data = snapshot.data;
  const dialogVisible = Boolean(!accessDenied && dialog && evaluateEntryDialog(dialog, snapshot, store).valid);

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

      {snapshot.busy && (
        <View accessibilityRole="progressbar" style={styles.stateCard}>
          <ActivityIndicator color={c.accent} />
          <Text style={styles.message}>
            {(() => {
              const stage = snapshot.busyKind ?? busyStage;
              if (stage === 'preparing') return 'Preparando solicitação com segurança...';
              if (stage === 'dispatching') return 'Registrando envio seguro...';
              if (stage === 'persisting') return 'Registrando resultado com segurança...';
              if (stage === 'cancelling') return 'Descartando solicitação não enviada...';
              if (stage === 'acknowledging') return 'Finalizando reconhecimento seguro local...';
              return 'Processando operação no servidor...';
            })()}
          </Text>
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

      {staleDialogMessage && (
        <View style={styles.warningCard}>
          <Text accessibilityRole="alert" style={styles.warningMessage}>
            {staleDialogMessage}
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

      {snapshot.knownOutcome?.kind === 'rejected' && pending?.phase !== 'terminal' && (
        <View style={styles.warningCard}>
          <Text accessibilityRole="alert" style={styles.warningMessage}>
            O servidor recusou a alteração, mas o registro local não foi confirmado. Não repita a operação; atualize ou procure o responsável.
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
            onPress={() => {
              const busyToken = ++busyTokenRef.current;
              const originScope = snapshot.context;
              setBusyStage('cancelling');
              void Promise.resolve(store.cancelReserved(pending.key)).finally(() => {
                if (busyTokenRef.current === busyToken && store.isCurrent(originScope)) {
                  setBusyStage(null);
                }
              });
            }}
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
            hasPendingCall={Boolean(data.pendingCall)}
            canManage={data.canManage}
            disabled={disabled}
            onDisableQueue={() => open({ kind: 'toggle', enabled: false })}
            onEnableQueue={() => runDirect({ kind: 'toggle', enabled: true })}
          />
        </>
      )}

      <StaffPollingStatusPill indicator={pollingIndicator} />

      <EntryActionButton
        label="Atualizar fila de entrada"
        variant="secondary"
        disabled={snapshot.busy || snapshot.status === 'loading'}
        onPress={refresh}
      />

      <EntryConfirmModal
        visible={dialogVisible}
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
});
