import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '../../context/AuthContext';
import {
  createStaffOperationsCoordinator,
  fetchStaffStationState,
  fetchStaffStations,
} from '../../services/staffOperationsService';
import { defaultStaffIntentStorage } from '../../services/staffIntentStorage';
import { liveColors as c, liveStyles as live } from '../admin/components/AdminLiveUI';
import {
  CurrentServiceCard,
  ExperienceQueueCard,
  StationConfirmModal,
  StationHeaderCard,
} from './components/StaffStationSections';
import {
  describeStationFeedback,
  resolveStaffPollingIndicator,
  StaffPollingStatusPill,
} from './components/StaffSyncFeedback';
import { useStaffPolling } from './useStaffPolling';

const same = (a, b) => Boolean(a && b && ['userId', 'sessionId', 'eventId', 'stationId', 'epoch', 'revision']
  .every((key) => a[key] === b[key]));
const isRecoverableError = (kind) => kind === 'network' || kind === 'unavailable';

function ActionButton({ label, onPress, disabled = false, variant = 'primary' }) {
  const isSecondary = variant === 'secondary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        isSecondary && styles.buttonSecondary,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, isSecondary && styles.buttonSecondaryText]}>{label}</Text>
    </Pressable>
  );
}

export default function StaffStationOperationalScreen({
  event,
  experience,
  station,
  isEventCurrent,
  onChanged,
  onRefresh,
  accessDenied = false,
  accessDeniedKind = 'denied',
  onAccessDenied,
  onStationNotFound,
  getNow,
}) {
  const auth = useAuth();
  const focused = useIsFocused();
  const [appState, setAppState] = useState(() => AppState?.currentState ?? 'active');
  const mounted = useRef(true);
  const liveRef = useRef(null);
  liveRef.current = {
    auth,
    event,
    experience,
    station,
    isEventCurrent,
    onRefresh,
    onChanged,
    accessDenied,
    onAccessDenied,
    onStationNotFound,
  };

  useEffect(() => {
    if (typeof AppState?.addEventListener !== 'function') return undefined;
    const subscription = AppState.addEventListener('change', (next) => {
      setAppState(next);
    });
    return () => subscription?.remove?.();
  }, []);

  const getContext = () => {
    const current = liveRef.current;
    const account = current.auth;
    if (
      !mounted.current
      || current.accessDenied
      || !account?.isAuthenticated
      || !account.isIdentityVerified()
      || !account.sessionId
      || !current.isEventCurrent()
      || !account.user?.roles?.includes('staff')
      || account.user.roles.includes('admin')
    ) return null;
    return {
      userId: account.user.id,
      sessionId: account.sessionId,
      eventId: current.event.id,
      stationId: current.station.id,
      epoch: account.getSessionEpoch(),
      revision: account.getIdentityRevision(),
    };
  };

  const coordinatorRef = useRef(null);
  if (!coordinatorRef.current && defaultStaffIntentStorage.isPersistent) {
    coordinatorRef.current = createStaffOperationsCoordinator({
      client: {
        get: (...args) => liveRef.current.auth.httpClient.get(...args),
        post: (...args) => liveRef.current.auth.httpClient.post(...args),
      },
      storage: defaultStaffIntentStorage,
      createKey: randomUUID,
      isCurrent: (context, scope) => !revokedKindRef.current
        && same(context, getContext())
        && (!scope || (scope.stationId === context.stationId && scope.eventId === context.eventId)),
      onStage: (stage, originScope) => {
        if (!mounted.current || revokedKindRef.current || !same(originScope, getContext())) return;
        setView((previous) => (previous.busy ? { ...previous, busyKind: stage } : previous));
      },
      onAuthError: (info) => {
        if (!info?.context || !same(info.context, getContext())) return;
        const feedback = info.phase === 'precondition'
          ? {
              kind: 'rejected',
              phase: 'precondition',
              status: info.status ?? null,
              code: info.code ?? null,
              network: false,
              timeout: false,
              transient: false,
            }
          : null;
        revokeStationAccess(info.kind, info.context, feedback);
      },
    });
  }
  const coordinator = coordinatorRef.current;

  const [view, setView] = useState({
    scope: null,
    status: 'loading',
    data: null,
    error: null,
    autoRecoverable: false,
    pending: null,
    busy: false,
    busyKind: null,
    feedback: null,
  });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [dialog, setDialog] = useState(null);
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const dispatching = useRef(false);
  const autoAttempt = useRef(null);
  const acknowledging = useRef(false);
  const generation = useRef(0);
  const pollingFlight = useRef(0);
  const pollSeq = useRef(0);
  const revokedKindRef = useRef(null);
  const epoch = auth.getSessionEpoch();
  const revision = auth.getIdentityRevision();
  const context = getContext();

  function revokeStationAccess(kind, originScope, nextFeedback = null) {
    if (!mounted.current || !same(originScope, getContext())) return false;
    const alreadyRevoked = Boolean(revokedKindRef.current);
    const denyKind = kind === 'session' ? 'session' : 'denied';
    revokedKindRef.current = denyKind;
    generation.current += 1;
    pollSeq.current += 1;
    pollingFlight.current = 0;
    dialogRef.current = null;
    setDialog(null);
    setView((previous) => ({
      ...previous,
      status: 'error',
      data: null,
      pending: null,
      error: denyKind,
      autoRecoverable: false,
      busy: false,
      busyKind: null,
      feedback: nextFeedback,
    }));
    if (!alreadyRevoked) liveRef.current.onAccessDenied?.(denyKind);
    return true;
  }

  async function handleStationNotFound(originScope, originGeneration) {
    const verifyFn = liveRef.current.onStationNotFound;
    let outcome;
    if (verifyFn) {
      outcome = await verifyFn({
        stationId: originScope.stationId,
        experienceId: experience.id,
      });
    } else {
      try {
        await fetchStaffStations(liveRef.current.auth.httpClient, originScope.eventId);
        outcome = { outcome: 'local_denied', kind: 'denied' };
      } catch (verifyError) {
        if (verifyError?.status === 401) {
          outcome = { outcome: 'session', kind: 'session' };
        } else if (verifyError?.status === 403 || verifyError?.status === 404) {
          outcome = { outcome: 'event_denied', kind: 'denied' };
        } else {
          const verifyKind = (verifyError?.isNetworkError || verifyError?.isTimeout) ? 'network' : 'unavailable';
          outcome = { outcome: 'uncertain', kind: verifyKind };
        }
      }
    }
    if (!mounted.current || originGeneration !== generation.current || !same(originScope, getContext())) return;
    if (outcome?.outcome === 'stale') return;
    if (outcome?.outcome === 'session' || outcome?.outcome === 'event_denied') {
      const denyKind = outcome.outcome === 'session' ? 'session' : 'denied';
      revokedKindRef.current = denyKind;
      setView((previous) => ({ ...previous, status: 'error', data: null, pending: null, error: denyKind, autoRecoverable: false }));
      if (!verifyFn) {
        liveRef.current.onAccessDenied?.(denyKind);
      }
      return;
    }
    if (outcome?.outcome === 'uncertain') {
      const errKind = outcome.kind === 'network' ? 'network' : 'unavailable';
      setView((previous) => ({ ...previous, status: 'error', data: null, pending: null, error: errKind, autoRecoverable: false }));
      return;
    }
    setView((previous) => ({ ...previous, status: 'error', data: null, pending: null, error: 'denied', autoRecoverable: false }));
  }

  async function refresh(preserveFeedback = false) {
    const initial = getContext();
    const request = ++generation.current;
    pollingFlight.current = 0;
    pollSeq.current += 1;
    dialogRef.current = null;
    setDialog(null);
    if (!initial) {
      revokedKindRef.current = null;
      setView({
        scope: null,
        status: 'loading',
        data: null,
        error: null,
        autoRecoverable: false,
        pending: null,
        busy: false,
        busyKind: null,
        feedback: null,
      });
      return false;
    }
    setView((previous) => ({
      ...previous,
      scope: initial,
      status: 'loading',
      data: null,
      error: revokedKindRef.current,
      autoRecoverable: false,
      feedback: preserveFeedback ? previous.feedback : null,
    }));
    const current = () => request === generation.current && same(initial, getContext());
    let stage = 'read';
    try {
      const data = coordinator
        ? await coordinator.readStationState(initial, experience.id, station.id)
        : await fetchStaffStationState(liveRef.current.auth.httpClient, event.id, experience.id, station.id);
      if (!current()) return false;
      let pending = null;
      if (coordinator) {
        stage = 'pending';
        pending = await coordinator.pending(initial);
      }
      if (!current()) return false;
      revokedKindRef.current = null;
      setView((previous) => ({ ...previous, status: 'ready', data, pending, error: null, autoRecoverable: false }));
      return true;
    } catch (error) {
      if (!same(initial, getContext())) return false;
      if (error?.status === 401 || error?.status === 403) {
        revokeStationAccess(error.status === 401 ? 'session' : 'denied', initial, null);
        return false;
      }
      if (request !== generation.current) return false;
      if (error?.status === 404) {
        const nextGen = ++generation.current;
        pollingFlight.current = 0;
        pollSeq.current += 1;
        dialogRef.current = null;
        setDialog(null);
        setView((previous) => ({ ...previous, status: 'error', data: null, pending: null, error: 'verifying', autoRecoverable: false }));
        await handleStationNotFound(initial, nextGen);
        return false;
      }
      const persistedRevocation = revokedKindRef.current;
      const kind = (error?.isNetworkError || error?.isTimeout) ? 'network' : 'unavailable';
      setView((previous) => ({
        ...previous,
        status: 'error',
        data: null,
        pending: stage === 'pending' ? { kind: 'storage_error' } : null,
        error: persistedRevocation ?? kind,
        autoRecoverable: !persistedRevocation && stage === 'read',
      }));
      return false;
    }
  }

  async function poll() {
    const scope = getContext();
    const request = generation.current;
    const currentView = viewRef.current;
    const canRetry = currentView.status === 'error'
      && currentView.autoRecoverable
      && !revokedKindRef.current
      && isRecoverableError(currentView.error);
    if (
      !scope
      || revokedKindRef.current
      || pollingFlight.current === request
      || (currentView.status !== 'ready' && !canRetry)
      || currentView.busy
      || dialogRef.current
      || dispatching.current
      || acknowledging.current
    ) return;
    const wasReady = currentView.status === 'ready';
    const seq = ++pollSeq.current;
    pollingFlight.current = request;
    try {
      const data = coordinator
        ? await coordinator.readStationState(scope, experience.id, station.id)
        : await fetchStaffStationState(liveRef.current.auth.httpClient, event.id, experience.id, station.id);
      if (request !== generation.current || seq !== pollSeq.current || !same(scope, getContext()) || revokedKindRef.current) return;
      if (wasReady) {
        setView((previous) => ({ ...previous, data, error: null, autoRecoverable: false }));
        return;
      }
      let pending = null;
      if (coordinator) {
        try {
          pending = await coordinator.pending(scope);
        } catch {
          pending = { kind: 'storage_error' };
        }
      }
      if (request !== generation.current || seq !== pollSeq.current || !same(scope, getContext()) || revokedKindRef.current) return;
      setView((previous) => ({ ...previous, status: 'ready', data, pending, error: null, autoRecoverable: false }));
    } catch (error) {
      if (!same(scope, getContext())) return;
      if (error?.status === 401 || error?.status === 403) {
        revokeStationAccess(error.status === 401 ? 'session' : 'denied', scope, null);
        return;
      }
      if (request !== generation.current || seq !== pollSeq.current || revokedKindRef.current) return;
      if (error?.status === 404) {
        const nextGen = ++generation.current;
        pollingFlight.current = 0;
        pollSeq.current += 1;
        dialogRef.current = null;
        setDialog(null);
        setView((previous) => ({ ...previous, data: null, status: 'error', pending: null, error: 'verifying', autoRecoverable: false }));
        await handleStationNotFound(scope, nextGen);
        return;
      }
      if (wasReady) {
        setView((previous) => ({ ...previous, error: 'stale', autoRecoverable: false }));
        return;
      }
      const kind = (error?.isNetworkError || error?.isTimeout) ? 'network' : 'unavailable';
      setView((previous) => ({ ...previous, status: 'error', data: null, error: kind, autoRecoverable: true }));
    } finally {
      if (pollingFlight.current === request && pollSeq.current === seq) {
        pollingFlight.current = 0;
      }
    }
  }

  const hasModalOpen = Boolean(dialog && !accessDenied && same(dialog.context, context) && !view.busy);
  const recoverableError = view.status === 'error'
    && view.autoRecoverable
    && !revokedKindRef.current
    && isRecoverableError(view.error);
  const pollingEnabled = Boolean(
    !accessDenied
    && !revokedKindRef.current
    && context
    && same(view.scope, context)
    && (view.status === 'ready' || recoverableError)
    && !view.busy
    && !hasModalOpen
    && !dispatching.current
    && !acknowledging.current,
  );

  useStaffPolling(
    pollingEnabled,
    poll,
    5000,
    `${event.id}:${station.id}:${epoch}:${revision}`,
  );

  useEffect(() => {
    mounted.current = true;
    autoAttempt.current = null;
    revokedKindRef.current = null;
    if (!liveRef.current.accessDenied) void refresh();
    return () => {
      mounted.current = false;
      generation.current += 1;
      pollSeq.current += 1;
      pollingFlight.current = 0;
      dialogRef.current = null;
    };
  }, [event.id, experience.id, station.id, auth.user?.id, auth.sessionId, epoch, revision]);

  useEffect(() => {
    if (!accessDenied) return;
    const denyKind = accessDeniedKind === 'session' ? 'session' : 'denied';
    revokedKindRef.current = denyKind;
    generation.current += 1;
    pollSeq.current += 1;
    pollingFlight.current = 0;
    dialogRef.current = null;
    setDialog(null);
    autoAttempt.current = null;
    setView({
      scope: null,
      status: 'error',
      data: null,
      error: denyKind,
      autoRecoverable: false,
      pending: null,
      busy: false,
      busyKind: null,
      feedback: null,
    });
  }, [accessDenied, accessDeniedKind]);

  useEffect(() => {
    const pending = view.pending;
    const scope = view.scope;
    if (
      accessDenied
      || revokedKindRef.current
      || !coordinator
      || view.status !== 'ready'
      || view.busy
      || pending?.kind !== 'terminal_pending'
      || !pending.receiptId
      || !same(scope, getContext())
      || autoAttempt.current === pending.receiptId
      || acknowledging.current
    ) return;
    autoAttempt.current = pending.receiptId;
    acknowledging.current = true;
    setView((previous) => ({ ...previous, busy: true, busyKind: 'acknowledging' }));
    void (async () => {
      const target = { ...scope, serviceSessionId: pending.serviceSessionId ?? null };
      let verified = false;
      try {
        const cleanup = await coordinator.cleanupTerminal(target, pending.receiptId);
        if (['terminal_pending', 'cleanup_pending'].includes(cleanup.kind) && same(scope, getContext())) {
          await coordinator.acknowledgeTerminal(target, pending.receiptId);
          // O marcador concluído e a ausência do recibo precisam ser confirmados por nova leitura.
          const remaining = await coordinator.pending(scope);
          verified = remaining.kind === 'none';
        }
      } catch { /* A releitura manterá o bloqueio se o armazenamento falhar. */ }
      acknowledging.current = false;
      if (same(scope, getContext())) {
        if (verified) setView((previous) => ({ ...previous, feedback: pending.outcome }));
        setView((previous) => ({ ...previous, busy: false, busyKind: null }));
        await refresh(true);
      } else if (getContext()) void refresh();
    })();
  }, [accessDenied, view.pending, view.scope, coordinator]);

  const blocked = !same(view.scope, context)
    || Boolean(revokedKindRef.current)
    || view.busy
    || view.status !== 'ready'
    || view.error === 'stale'
    || !coordinator
    || dispatching.current
    || acknowledging.current
    || (view.pending && view.pending.kind !== 'none');

  const open = (action) => {
    if (!blocked && context) setDialog({ action, context, observed: view.data, readGen: generation.current });
  };

  async function dispatch(expected, fromDialog = false) {
    if (
      !expected
      || dispatching.current
      || acknowledging.current
      || revokedKindRef.current
      || !coordinator
      || expected.readGen !== generation.current
      || (fromDialog && dialogRef.current !== expected)
      || (!fromDialog && (expected.action.kind !== 'call' || dialogRef.current))
      || !same(expected.context, getContext())
      || !same(viewRef.current.scope, getContext())
      || viewRef.current.busy
      || viewRef.current.status !== 'ready'
      || viewRef.current.error === 'stale'
      || (viewRef.current.pending && viewRef.current.pending.kind !== 'none')
    ) return;
    if (
      expected.action.kind === 'call'
      && (
        !viewRef.current.data?.canCall
        || viewRef.current.data.pending
        || viewRef.current.data.waitingCount === 0
        || viewRef.current.data.availability !== 'available'
      )
    ) return;
    dispatching.current = true;
    generation.current += 1;
    pollSeq.current += 1;
    pollingFlight.current = 0;
    dialogRef.current = null;
    setDialog(null);
    const scope = expected.context;
    setView((previous) => ({ ...previous, busy: true, busyKind: 'precondition', feedback: null }));
    try {
      let result;
      try {
        const action = expected.action;
        result = action.kind === 'call'
          ? await coordinator.callNext(scope, experience.id, station.id)
          : action.kind === 'complete'
            ? await coordinator.complete(scope, action.serviceSessionId, station.id)
            : action.kind === 'absent'
              ? await coordinator.absent(scope, action.serviceSessionId, station.id)
              : await coordinator.removeCalled(scope, experience.id, station.id, action.serviceSessionId);
      } catch {
        result = { kind: 'storage_error' };
      }
      const alreadyRevokedBeforeReturn = Boolean(revokedKindRef.current);
      if (
        (result?.kind === 'rejected' || result?.kind === 'rejected_cleanup_pending')
        && (result.status === 401 || result.status === 403)
      ) {
        const preservedFeedback = (result.phase === 'precondition' || result.kind === 'rejected_cleanup_pending')
          ? result
          : null;
        if (!same(scope, getContext())) {
          if (
            alreadyRevokedBeforeReturn
            && preservedFeedback
            && mounted.current
            && liveRef.current.event?.id === scope.eventId
            && liveRef.current.auth?.user?.id === scope.userId
          ) {
            setView((previous) => ({ ...previous, busy: false, busyKind: null, feedback: preservedFeedback }));
          }
          return;
        }
        revokeStationAccess(result.status === 401 ? 'session' : 'denied', scope, preservedFeedback);
        return;
      }
      if (!same(scope, getContext()) || revokedKindRef.current) return;
      setView((previous) => ({ ...previous, busy: false, busyKind: null, feedback: result }));
      const refreshedOk = await refresh(true);
      if (refreshedOk && !revokedKindRef.current && same(scope, getContext()) && (result?.kind === 'confirmed' || result?.kind === 'confirmed_cleanup_pending')) {
        liveRef.current.onChanged?.();
      }
    } finally {
      dispatching.current = false;
    }
  }

  async function resolvePending(expected, scope) {
    const pending = viewRef.current.pending;
    if (
      !coordinator
      || acknowledging.current
      || !same(scope, getContext())
      || viewRef.current.busy
      || !pending
      || !expected
      || pending.kind !== expected.kind
      || !expected.receiptId
      || pending.receiptId !== expected.receiptId
    ) return;
    setView((previous) => ({ ...previous, busy: true, busyKind: 'cancelling' }));
    try {
      if (pending.kind === 'reserved') await coordinator.cancelReserved(scope, expected.receiptId);
    } catch { /* A intenção permanece bloqueada; nova leitura mostra o estado persistido. */ }
    if (same(scope, getContext())) {
      setView((previous) => ({ ...previous, busy: false, busyKind: null }));
      await refresh();
    }
  }

  const messages = {
    verifying: 'Verificando acesso à estação...',
    session: 'Sessão inválida. Entre novamente.',
    denied: 'Acesso à estação indisponível.',
    network: 'Falha de conexão. Atualize a estação.',
    unavailable: 'Não foi possível consultar a estação.',
    stale: 'Dados da estação possivelmente desatualizados. Atualize antes de operar.',
  };

  if (accessDenied) {
    return (
      <View style={styles.content}>
        <View style={styles.errorCard}>
          <Text accessibilityRole="alert" style={styles.alertMessage}>
            {accessDeniedKind === 'session' ? messages.session : messages.denied}
          </Text>
        </View>
      </View>
    );
  }

  if (!context) return null;
  if (!same(view.scope, context)) {
    return (
      <View style={styles.content}>
        <View accessibilityRole="progressbar" style={styles.stateCard}>
          <ActivityIndicator color={c.accent} />
          <Text style={styles.message}>Verificando atendimento da estação...</Text>
        </View>
      </View>
    );
  }

  const data = view.data;
  const pending = view.pending;
  const effectiveAvailability = data?.availability ?? station.availability;
  const callDisabled = blocked
    || !data?.canCall
    || Boolean(data?.pending)
    || (data?.waitingCount ?? 0) === 0
    || data?.availability !== 'available';
  const showUnavailableHint = Boolean(data && !data.pending && data.availability === 'unavailable');
  const showCallClosedHint = Boolean(data && !data.pending && data.availability === 'available' && !data.canCall && data.waitingCount > 0);
  const feedbackNotice = describeStationFeedback(view.feedback);
  const pollingIndicator = resolveStaffPollingIndicator({
    hidden: accessDenied || (view.status === 'error' && (view.error === 'denied' || view.error === 'session')),
    verifying: view.status === 'error' && view.error === 'verifying',
    loading: view.status === 'loading',
    pollingEnabled,
    visible: focused && appState === 'active',
    stale: view.error === 'stale',
    recoverableError,
    unavailableError: view.status === 'error' && !recoverableError && view.error !== 'verifying',
    intervalSeconds: 5,
  });

  return (
    <View style={styles.content}>
      <StationHeaderCard
        stationLabel={station.label}
        experienceName={experience.name}
        eventName={event.name}
        availability={effectiveAvailability}
      />

      {view.status === 'loading' && (
        <View accessibilityRole="progressbar" style={styles.stateCard}>
          <ActivityIndicator color={c.accent} />
          <Text style={styles.message}>Carregando atendimento...</Text>
        </View>
      )}

      {view.busy && (
        <View accessibilityRole="progressbar" style={styles.stateCard}>
          <ActivityIndicator color={c.accent} />
          <Text style={styles.message}>
            {view.busyKind === 'acknowledging' || acknowledging.current
              ? 'Finalizando reconhecimento seguro local...'
              : view.busyKind === 'cancelling'
                ? 'Descartando solicitação não enviada...'
                : view.busyKind === 'precondition'
                  ? 'Verificando condições antes do envio...'
                  : 'Processando operação no servidor...'}
          </Text>
        </View>
      )}

      {view.status === 'error' && view.error === 'verifying' && (
        <View accessibilityRole="progressbar" style={styles.stateCard}>
          <ActivityIndicator color={c.accent} />
          <Text style={styles.message}>{messages.verifying}</Text>
        </View>
      )}

      {view.status === 'error' && view.error !== 'verifying' && (
        <View style={styles.errorCard}>
          <Text accessibilityRole="alert" style={styles.alertMessage}>{messages[view.error]}</Text>
        </View>
      )}

      {view.error === 'stale' && (
        <View style={styles.warningCard}>
          <Text accessibilityRole="alert" style={styles.warningMessage}>{messages.stale}</Text>
        </View>
      )}

      {feedbackNotice && (
        <View style={feedbackNotice.tone === 'success' ? styles.successCard : styles.warningCard}>
          <Text
            accessibilityRole="alert"
            style={feedbackNotice.tone === 'success' ? styles.successMessage : styles.warningMessage}
          >
            {feedbackNotice.text}
          </Text>
        </View>
      )}

      {data && (
        <>
          <ExperienceQueueCard
            waitingCount={data.waitingCount}
            waiting={data.waiting}
          />

          {!data.pending && (
            <View style={styles.callBlock}>
              <ActionButton
                label="Chamar próximo"
                disabled={callDisabled}
                onPress={() => dispatch({ action: { kind: 'call' }, context, readGen: generation.current })}
              />
              {showUnavailableHint && (
                <Text style={styles.helperNote}>
                  Estação indisponível no momento. A fila da experiência continua visível para consulta.
                </Text>
              )}
              {showCallClosedHint && (
                <Text style={styles.helperNote}>
                  Novas chamadas não estão liberadas pelo servidor neste momento.
                </Text>
              )}
            </View>
          )}

          <CurrentServiceCard
            pending={data.pending}
            blocked={blocked}
            onComplete={(serviceSessionId) => open({ kind: 'complete', serviceSessionId })}
            onAbsent={(serviceSessionId) => open({ kind: 'absent', serviceSessionId })}
            onRemove={(serviceSessionId) => open({ kind: 'remove_called', serviceSessionId })}
            getNow={getNow}
          />
        </>
      )}

      {!coordinator && (
        <View style={styles.warningCard}>
          <Text style={styles.warningMessage}>
            Operações indisponíveis sem armazenamento seguro neste dispositivo.
          </Text>
        </View>
      )}

      {pending?.kind === 'pending_other' && (
        <View style={styles.warningCard}>
          <Text style={styles.warningMessage}>
            Há uma operação pendente em outra sessão, evento ou estação desta conta.
          </Text>
        </View>
      )}

      {pending?.kind === 'pending_reconciliation' && (
        <View style={styles.warningCard}>
          <Text style={styles.warningMessage}>
            Resultado incerto. Não repita a operação; peça reconciliação ao responsável.
          </Text>
        </View>
      )}

      {pending?.kind === 'reserved' && (
        <View style={styles.warningCard}>
          <Text style={styles.warningMessage}>Solicitação registrada, ainda não enviada.</Text>
          <ActionButton
            label="Descartar solicitação não enviada"
            variant="secondary"
            disabled={view.busy}
            onPress={() => resolvePending(pending, context)}
          />
        </View>
      )}

      {pending?.kind === 'terminal_pending' && (
        <View style={styles.warningCard}>
          <Text accessibilityRole="alert" style={styles.warningMessage}>
            Resultado registrado; reconhecimento seguro pendente. As operações permanecem bloqueadas.
          </Text>
        </View>
      )}

      {pending?.kind === 'storage_error' && (
        <View style={styles.warningCard}>
          <Text style={styles.warningMessage}>
            Não foi possível verificar a intenção persistida. Operações bloqueadas.
          </Text>
        </View>
      )}

      <StaffPollingStatusPill indicator={pollingIndicator} />

      <ActionButton
        label="Atualizar atendimento"
        variant="secondary"
        disabled={view.busy || view.status === 'loading' || view.error === 'verifying'}
        onPress={async () => {
          autoAttempt.current = null;
          const refreshedOk = await refresh();
          if (refreshedOk) await liveRef.current.onRefresh?.();
        }}
      />

      <StationConfirmModal
        visible={hasModalOpen}
        dialog={dialog}
        onConfirm={() => dispatch(dialog, true)}
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
  callBlock: { gap: 6, marginTop: 2 },
  stateCard: { ...live.card, ...live.row, marginTop: 0 },
  errorCard: { ...live.card, marginTop: 0, backgroundColor: c.dangerSurface, borderColor: c.danger, gap: 8 },
  warningCard: { ...live.card, marginTop: 0, backgroundColor: c.warningSurface, borderColor: c.warning, gap: 10 },
  successCard: { ...live.card, marginTop: 0, backgroundColor: c.successSurface, borderColor: '#10B981', gap: 8 },
  message: { color: c.muted, fontSize: 15, lineHeight: 22, flexShrink: 1 },
  alertMessage: { color: '#FECACA', fontSize: 14, lineHeight: 20 },
  warningMessage: { color: '#FDE68A', fontSize: 14, lineHeight: 20 },
  successMessage: { color: '#A7F3D0', fontSize: 14, lineHeight: 20 },
  helperNote: { color: c.muted, fontSize: 13, lineHeight: 19 },
  button: { backgroundColor: c.accentStrong, borderRadius: 14, minHeight: 52, paddingVertical: 14,
    paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  buttonSecondary: { backgroundColor: '#251A33', borderWidth: 1, borderColor: c.border, minHeight: 48, paddingVertical: 12 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  buttonText: { color: c.onAccent, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  buttonSecondaryText: { color: c.text, fontSize: 15 },
});
