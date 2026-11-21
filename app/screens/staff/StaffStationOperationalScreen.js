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
import { useStaffPolling } from './useStaffPolling';

const same = (a, b) => Boolean(a && b && ['userId', 'sessionId', 'eventId', 'stationId', 'epoch', 'revision']
  .every((key) => a[key] === b[key]));

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
      isCurrent: (context, scope) => same(context, getContext())
        && (!scope || (scope.stationId === context.stationId && scope.eventId === context.eventId)),
    });
  }
  const coordinator = coordinatorRef.current;

  const [view, setView] = useState({
    scope: null,
    status: 'loading',
    data: null,
    error: null,
    pending: null,
    busy: false,
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
  const epoch = auth.getSessionEpoch();
  const revision = auth.getIdentityRevision();
  const context = getContext();

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
          const verifyKind = verifyError?.isNetworkError ? 'network' : 'unavailable';
          outcome = { outcome: 'uncertain', kind: verifyKind };
        }
      }
    }
    if (!mounted.current || originGeneration !== generation.current || !same(originScope, getContext())) return;
    if (outcome?.outcome === 'stale') return;
    if (outcome?.outcome === 'session' || outcome?.outcome === 'event_denied') {
      const denyKind = outcome.outcome === 'session' ? 'session' : 'denied';
      setView((previous) => ({ ...previous, status: 'error', data: null, pending: null, error: denyKind }));
      if (!verifyFn) {
        liveRef.current.onAccessDenied?.(denyKind);
      }
      return;
    }
    if (outcome?.outcome === 'uncertain') {
      const errKind = outcome.kind === 'network' ? 'network' : 'unavailable';
      setView((previous) => ({ ...previous, status: 'error', data: null, pending: null, error: errKind }));
      return;
    }
    setView((previous) => ({ ...previous, status: 'error', data: null, pending: null, error: 'denied' }));
  }

  async function refresh(preserveFeedback = false) {
    const initial = getContext();
    const request = ++generation.current;
    dialogRef.current = null;
    setDialog(null);
    if (!initial) {
      setView({ scope: null, status: 'loading', data: null, error: null, pending: null, busy: false, feedback: null });
      return false;
    }
    setView((previous) => ({
      ...previous,
      scope: initial,
      status: 'loading',
      data: null,
      error: null,
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
      setView((previous) => ({ ...previous, status: 'ready', data, pending, error: null }));
      return true;
    } catch (error) {
      if (!same(initial, getContext())) return false;
      if (error?.status === 401 || error?.status === 403) {
        generation.current += 1;
        dialogRef.current = null;
        setDialog(null);
        const kind = error.status === 401 ? 'session' : 'denied';
        setView((previous) => ({ ...previous, status: 'error', data: null, pending: null, error: kind }));
        liveRef.current.onAccessDenied?.(kind);
        return false;
      }
      if (request !== generation.current) return false;
      if (error?.status === 404) {
        const nextGen = ++generation.current;
        dialogRef.current = null;
        setDialog(null);
        setView((previous) => ({ ...previous, status: 'error', data: null, pending: null, error: 'verifying' }));
        await handleStationNotFound(initial, nextGen);
        return false;
      }
      const kind = error?.isNetworkError ? 'network' : 'unavailable';
      setView((previous) => ({
        ...previous,
        status: 'error',
        data: null,
        pending: stage === 'pending' ? { kind: 'storage_error' } : null,
        error: kind,
      }));
      return false;
    }
  }

  async function poll() {
    const scope = getContext();
    const request = generation.current;
    if (
      !scope
      || viewRef.current.status !== 'ready'
      || viewRef.current.busy
      || dialogRef.current
      || dispatching.current
      || acknowledging.current
    ) return;
    try {
      const data = coordinator
        ? await coordinator.readStationState(scope, experience.id, station.id)
        : await fetchStaffStationState(liveRef.current.auth.httpClient, event.id, experience.id, station.id);
      if (request === generation.current && same(scope, getContext())) {
        setView((previous) => ({ ...previous, data, error: null }));
      }
    } catch (error) {
      if (!same(scope, getContext())) return;
      if (error?.status === 401 || error?.status === 403) {
        generation.current += 1;
        dialogRef.current = null;
        setDialog(null);
        const kind = error.status === 401 ? 'session' : 'denied';
        setView((previous) => ({ ...previous, data: null, status: 'error', pending: null, error: kind }));
        liveRef.current.onAccessDenied?.(kind);
        return;
      }
      if (request !== generation.current) return;
      if (error?.status === 404) {
        const nextGen = ++generation.current;
        dialogRef.current = null;
        setDialog(null);
        setView((previous) => ({ ...previous, data: null, status: 'error', pending: null, error: 'verifying' }));
        await handleStationNotFound(scope, nextGen);
        return;
      }
      setView((previous) => ({ ...previous, error: 'stale' }));
    }
  }

  const hasModalOpen = Boolean(dialog && !accessDenied && same(dialog.context, context) && !view.busy);
  const pollingEnabled = Boolean(
    !accessDenied
    && context
    && same(view.scope, context)
    && view.status === 'ready'
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
    if (!liveRef.current.accessDenied) void refresh();
    return () => {
      mounted.current = false;
      generation.current += 1;
      dialogRef.current = null;
    };
  }, [event.id, experience.id, station.id, auth.user?.id, auth.sessionId, epoch, revision]);

  useEffect(() => {
    if (!accessDenied) return;
    generation.current += 1;
    dialogRef.current = null;
    setDialog(null);
    autoAttempt.current = null;
    setView({
      scope: null,
      status: 'error',
      data: null,
      error: accessDeniedKind === 'session' ? 'session' : 'denied',
      pending: null,
      busy: false,
      feedback: null,
    });
  }, [accessDenied, accessDeniedKind]);

  useEffect(() => {
    const pending = view.pending;
    const scope = view.scope;
    if (
      accessDenied
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
    setView((previous) => ({ ...previous, busy: true }));
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
        setView((previous) => ({ ...previous, busy: false }));
        await refresh(true);
      } else if (getContext()) void refresh();
    })();
  }, [accessDenied, view.pending, view.scope, coordinator]);

  const blocked = !same(view.scope, context)
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
    dialogRef.current = null;
    setDialog(null);
    const scope = expected.context;
    setView((previous) => ({ ...previous, busy: true, feedback: null }));
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
      if (!same(scope, getContext())) return;
      setView((previous) => ({ ...previous, busy: false, feedback: result }));
      const refreshedOk = await refresh(true);
      if (refreshedOk && same(scope, getContext())) liveRef.current.onChanged?.();
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
    setView((previous) => ({ ...previous, busy: true }));
    try {
      if (pending.kind === 'reserved') await coordinator.cancelReserved(scope, expected.receiptId);
    } catch { /* A intenção permanece bloqueada; nova leitura mostra o estado persistido. */ }
    if (same(scope, getContext())) {
      setView((previous) => ({ ...previous, busy: false }));
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
  const pollingIndicator = (() => {
    if (accessDenied || (view.status === 'error' && (view.error === 'denied' || view.error === 'session'))) {
      return null;
    }
    if (view.error === 'stale') {
      return { dotStyle: styles.pollingDotStale, text: 'Dados desatualizados · tentando atualizar a cada 5s' };
    }
    if (view.status === 'error') {
      return {
        dotStyle: styles.pollingDotMuted,
        text: view.error === 'verifying'
          ? 'Atualização indisponível · verificando autorização'
          : 'Atualização indisponível · aguardando recuperação',
      };
    }
    if (!pollingEnabled || !focused || appState !== 'active') {
      return { dotStyle: styles.pollingDotStale, text: 'Atualização temporariamente pausada' };
    }
    return { dotStyle: styles.pollingDotActive, text: 'Atualização automática ativa · a cada 5s' };
  })();

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

      {view.feedback?.kind === 'confirmed' && (
        <View style={styles.successCard}>
          <Text accessibilityRole="alert" style={styles.successMessage}>
            {view.feedback.result?.status === 'absent'
              ? view.feedback.result.requeued
                ? 'Ausência registrada; participante retornou ao fim da fila.'
                : 'Ausência registrada; participante não retornou à fila após o corte.'
              : 'Operação confirmada pelo servidor.'}
          </Text>
        </View>
      )}

      {view.feedback?.kind === 'rejected' && (
        <View style={styles.warningCard}>
          <Text accessibilityRole="alert" style={styles.warningMessage}>
            Operação recusada pelo servidor. Atualize o atendimento antes de decidir a próxima ação.
          </Text>
        </View>
      )}

      {['uncertain', 'pending_reconciliation', 'confirmed_cleanup_pending', 'rejected_cleanup_pending', 'storage_error']
        .includes(view.feedback?.kind) && (
        <View style={styles.warningCard}>
          <Text accessibilityRole="alert" style={styles.warningMessage}>
            O resultado exige verificação ou reconciliação. Não repita a operação.
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

      {pollingIndicator && (
        <View style={styles.pollingRow}>
          <View style={[styles.pollingDot, pollingIndicator.dotStyle]} />
          <Text style={styles.pollingText}>{pollingIndicator.text}</Text>
        </View>
      )}

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
  pollingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  pollingDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  pollingDotActive: { backgroundColor: '#10B981' },
  pollingDotStale: { backgroundColor: '#F59E0B' },
  pollingDotMuted: { backgroundColor: '#64748B' },
  pollingText: { color: c.muted, fontSize: 13, lineHeight: 18, flex: 1 },
  button: { backgroundColor: c.accentStrong, borderRadius: 14, minHeight: 52, paddingVertical: 14,
    paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  buttonSecondary: { backgroundColor: '#251A33', borderWidth: 1, borderColor: c.border, minHeight: 48, paddingVertical: 12 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  buttonText: { color: c.onAccent, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  buttonSecondaryText: { color: c.text, fontSize: 15 },
});
