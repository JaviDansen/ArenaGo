import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '../../context/AuthContext';
import { createStaffOperationsCoordinator, fetchStaffStationState } from '../../services/staffOperationsService';
import { defaultStaffIntentStorage } from '../../services/staffIntentStorage';
import { useStaffPolling } from './useStaffPolling';

const same = (a, b) => Boolean(a && b && ['userId', 'sessionId', 'eventId', 'stationId', 'epoch', 'revision']
  .every(key => a[key] === b[key]));
function Button({ label, onPress, disabled = false }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    onPress={disabled ? undefined : onPress} style={[styles.button, disabled && styles.disabled]}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
}

export default function StaffStationOperationalScreen({ event, experience, station, isEventCurrent, onChanged }) {
  const auth = useAuth();
  const mounted = useRef(true);
  const live = useRef(null);
  live.current = { auth, event, experience, station, isEventCurrent };
  const getContext = () => {
    const current = live.current;
    const account = current.auth;
    if (!mounted.current || !account?.isAuthenticated || !account.isIdentityVerified() || !account.sessionId ||
        !current.isEventCurrent() || !account.user?.roles?.includes('staff') || account.user.roles.includes('admin')) return null;
    return { userId: account.user.id, sessionId: account.sessionId, eventId: current.event.id,
      stationId: current.station.id, epoch: account.getSessionEpoch(), revision: account.getIdentityRevision() };
  };
  const coordinatorRef = useRef(null);
  if (!coordinatorRef.current && defaultStaffIntentStorage.isPersistent) {
    coordinatorRef.current = createStaffOperationsCoordinator({
      client: { get: (...args) => live.current.auth.httpClient.get(...args),
        post: (...args) => live.current.auth.httpClient.post(...args) },
      storage: defaultStaffIntentStorage, createKey: randomUUID,
      isCurrent: (context, scope) => same(context, getContext()) &&
        (!scope || scope.stationId === context.stationId && scope.eventId === context.eventId),
    });
  }
  const coordinator = coordinatorRef.current;
  const [view, setView] = useState({ scope: null, status: 'loading', data: null, error: null,
    pending: null, busy: false, feedback: null });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [dialog, setDialog] = useState(null);
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const dispatching = useRef(false);
  const autoAttempt = useRef(null);
  const acknowledging = useRef(false);
  const generation = useRef(0);
  const epoch = auth.getSessionEpoch(), revision = auth.getIdentityRevision();
  const context = getContext();

  async function refresh(preserveFeedback = false) {
    const initial = getContext();
    const request = ++generation.current;
    dialogRef.current = null; setDialog(null);
    if (!initial) { setView({ scope: null, status: 'loading', data: null, error: null, pending: null, busy: false, feedback: null }); return; }
    setView(previous => ({ ...previous, scope: initial, status: 'loading', data: null, error: null,
      feedback: preserveFeedback ? previous.feedback : null }));
    const current = () => request === generation.current && same(initial, getContext());
    let stage = 'read';
    try {
      const data = coordinator
        ? await coordinator.readStationState(initial, experience.id, station.id)
        : await fetchStaffStationState(live.current.auth.httpClient, event.id, experience.id, station.id);
      if (!current()) return;
      let pending = null;
      if (coordinator) { stage = 'pending'; pending = await coordinator.pending(initial); }
      if (!current()) return;
      setView(previous => ({ ...previous, status: 'ready', data, pending, error: null }));
    } catch (error) {
      if (!current()) return;
      const kind = error?.status === 401 ? 'session' : [403, 404].includes(error?.status) ? 'denied'
        : error?.isNetworkError ? 'network' : 'unavailable';
      setView(previous => ({ ...previous, status: 'error', data: null,
        pending: stage === 'pending' ? { kind: 'storage_error' } : null, error: kind }));
    }
  }

  async function poll() {
    const scope = getContext(), request = generation.current;
    if (!scope || viewRef.current.status !== 'ready' || viewRef.current.busy || dialogRef.current ||
        dispatching.current || acknowledging.current) return;
    try {
      const data = coordinator
        ? await coordinator.readStationState(scope, experience.id, station.id)
        : await fetchStaffStationState(live.current.auth.httpClient, event.id, experience.id, station.id);
      if (request === generation.current && same(scope, getContext()))
        setView(previous => ({ ...previous, data, error: null }));
    } catch (error) {
      if (request !== generation.current || !same(scope, getContext())) return;
      const kind = error?.status === 401 ? 'session' : [403, 404].includes(error?.status) ? 'denied' : 'stale';
      setView(previous => kind === 'stale' ? { ...previous, error: kind }
        : { ...previous, data: null, status: 'error', error: kind });
    }
  }

  useStaffPolling(Boolean(context && view.status === 'ready' && !view.busy), poll, 5000,
    `${event.id}:${station.id}:${epoch}:${revision}`);

  useEffect(() => {
    mounted.current = true;
    autoAttempt.current = null;
    void refresh();
    return () => { mounted.current = false; generation.current++; dialogRef.current = null; };
  }, [event.id, experience.id, station.id, auth.user?.id, auth.sessionId, epoch, revision]);

  useEffect(() => {
    const pending = view.pending, scope = view.scope;
    if (!coordinator || view.status !== 'ready' || view.busy || pending?.kind !== 'terminal_pending' || !pending.receiptId ||
        !same(scope, getContext()) || autoAttempt.current === pending.receiptId || acknowledging.current) return;
    autoAttempt.current = pending.receiptId;
    acknowledging.current = true;
    setView(previous => ({ ...previous, busy: true }));
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
        if (verified) setView(previous => ({ ...previous, feedback: pending.outcome }));
        setView(previous => ({ ...previous, busy: false }));
        await refresh(true);
      } else if (getContext()) void refresh();
    })();
  }, [view.pending, view.scope, coordinator]);

  const blocked = !same(view.scope, context) || view.busy || view.status !== 'ready' || view.error === 'stale' || !coordinator ||
    dispatching.current || acknowledging.current || (view.pending && view.pending.kind !== 'none');
  const open = action => {
    if (!blocked && context) setDialog({ action, context, observed: view.data });
  };
  async function dispatch(expected, fromDialog = false) {
    if (!expected || dispatching.current || acknowledging.current || !coordinator || (fromDialog && dialogRef.current !== expected) ||
        (!fromDialog && (expected.action.kind !== 'call' || dialogRef.current)) ||
        !same(expected.context, getContext()) ||
        !same(viewRef.current.scope, getContext()) || viewRef.current.busy || viewRef.current.status !== 'ready' ||
        viewRef.current.error === 'stale' ||
        (viewRef.current.pending && viewRef.current.pending.kind !== 'none')) return;
    if (expected.action.kind === 'call' && (!viewRef.current.data?.canCall ||
        viewRef.current.data.pending || viewRef.current.data.waitingCount === 0 ||
        viewRef.current.data.availability !== 'available')) return;
    dispatching.current = true;
    dialogRef.current = null; setDialog(null);
    const scope = expected.context;
    setView(previous => ({ ...previous, busy: true, feedback: null }));
    try {
      let result;
      try {
        const action = expected.action;
        result = action.kind === 'call' ? await coordinator.callNext(scope, experience.id, station.id)
          : action.kind === 'complete' ? await coordinator.complete(scope, action.serviceSessionId, station.id)
            : action.kind === 'absent' ? await coordinator.absent(scope, action.serviceSessionId, station.id)
              : await coordinator.removeCalled(scope, experience.id, station.id, action.serviceSessionId);
      } catch { result = { kind: 'storage_error' }; }
      if (!same(scope, getContext())) return;
      setView(previous => ({ ...previous, busy: false, feedback: result }));
      await refresh(true);
      if (same(scope, getContext())) onChanged();
    } finally { dispatching.current = false; }
  }

  async function resolvePending(expected, scope) {
    const pending = viewRef.current.pending;
    if (!coordinator || acknowledging.current || !same(scope, getContext()) || viewRef.current.busy || !pending || !expected ||
        pending.kind !== expected.kind || !expected.receiptId || pending.receiptId !== expected.receiptId) return;
    setView(previous => ({ ...previous, busy: true }));
    try {
      if (pending.kind === 'reserved') await coordinator.cancelReserved(scope, expected.receiptId);
    } catch { /* A intenção permanece bloqueada; nova leitura mostra o estado persistido. */ }
    if (same(scope, getContext())) {
      setView(previous => ({ ...previous, busy: false }));
      await refresh();
    }
  }

  if (!context) return null;
  if (!same(view.scope, context)) return <View style={styles.content}>
    <Text style={styles.text}>Verificando atendimento da estação...</Text></View>;
  const messages = { session: 'Sessão inválida. Entre novamente.', denied: 'Acesso à estação indisponível.',
    network: 'Falha de conexão. Atualize a estação.', unavailable: 'Não foi possível consultar a estação.',
    stale: 'Dados da estação possivelmente desatualizados. Atualize antes de operar.' };
  const data = view.data;
  const pending = view.pending;
  return <View style={styles.content}>
    <Text style={styles.title}>Atendimento da estação</Text>
    <Text style={styles.text}>{experience.name} · {station.label}</Text>
    {view.status === 'loading' && <View accessibilityRole="progressbar"><ActivityIndicator color="#a78bfa" />
      <Text style={styles.text}>Carregando atendimento...</Text></View>}
    {view.status === 'error' && <Text accessibilityRole="alert" style={styles.warning}>{messages[view.error]}</Text>}
    {view.error === 'stale' && <Text accessibilityRole="alert" style={styles.warning}>{messages.stale}</Text>}
    {view.feedback?.kind === 'confirmed' && <Text accessibilityRole="alert" style={styles.success}>
      {view.feedback.result?.status === 'absent'
        ? view.feedback.result.requeued ? 'Ausência registrada; participante retornou ao fim da fila.'
          : 'Ausência registrada; participante não retornou à fila após o corte.'
        : 'Operação confirmada pelo servidor.'}</Text>}
    {view.feedback?.kind === 'rejected' && <Text accessibilityRole="alert" style={styles.warning}>
      Operação recusada pelo servidor. Atualize o atendimento antes de decidir a próxima ação.</Text>}
    {['uncertain', 'pending_reconciliation', 'confirmed_cleanup_pending', 'rejected_cleanup_pending',
      'storage_error'].includes(view.feedback?.kind) && <Text accessibilityRole="alert" style={styles.warning}>
      O resultado exige verificação ou reconciliação. Não repita a operação.</Text>}
    {data && <>
      <Text style={styles.text}>Estação: {data.availability === 'available' ? 'Disponível' : 'Indisponível'}</Text>
      <Text style={styles.text}>Aguardando nesta experiência: {data.waitingCount}</Text>
      {data.pending ? <View style={styles.card}>
        <Text style={styles.title}>Participante chamado: {data.pending.displayName}</Text>
        <Text style={styles.text}>Resolva a chamada antes da próxima: conclua, registre ausência ou remova da fila.</Text>
        <Button label="Concluir atendimento" disabled={blocked} onPress={() => open({ kind: 'complete', serviceSessionId: data.pending.serviceSessionId })} />
        <Button label="Registrar ausência" disabled={blocked} onPress={() => open({ kind: 'absent', serviceSessionId: data.pending.serviceSessionId })} />
        <Button label="Remover da fila" disabled={blocked} onPress={() => open({ kind: 'remove_called', serviceSessionId: data.pending.serviceSessionId })} />
      </View> : <Button label="Chamar próximo" disabled={blocked || !data.canCall || data.waitingCount === 0}
        onPress={() => dispatch({ action: { kind: 'call' }, context })} />}
      {data.waitingCount === 0 && <Text style={styles.text}>Nenhuma pessoa aguardando nesta experiência.</Text>}
      {data.waiting.map(person => <View key={person.queueEntryId} style={styles.card}>
        <Text style={styles.text}>{person.position}. {person.displayName}</Text>
      </View>)}
    </>}
    {!coordinator && <Text style={styles.warning}>Operações indisponíveis sem armazenamento seguro neste dispositivo.</Text>}
    {pending?.kind === 'pending_other' && <Text style={styles.warning}>Há uma operação pendente em outra sessão, evento ou estação desta conta.</Text>}
    {pending?.kind === 'pending_reconciliation' && <Text style={styles.warning}>Resultado incerto. Não repita a operação; peça reconciliação ao responsável.</Text>}
    {pending?.kind === 'reserved' && <><Text style={styles.warning}>Solicitação registrada, ainda não enviada.</Text>
      <Button label="Descartar solicitação não enviada" disabled={view.busy} onPress={() => resolvePending(pending, context)} /></>}
    {pending?.kind === 'terminal_pending' && <Text accessibilityRole="alert" style={styles.warning}>
      Resultado registrado; reconhecimento seguro pendente. As operações permanecem bloqueadas.</Text>}
    {pending?.kind === 'storage_error' && <Text style={styles.warning}>Não foi possível verificar a intenção persistida. Operações bloqueadas.</Text>}
    <Button label="Atualizar atendimento" disabled={view.busy || view.status === 'loading'}
      onPress={() => { autoAttempt.current = null; void refresh(); }} />
    <Modal transparent animationType="fade" visible={Boolean(dialog && same(dialog.context, getContext()) && !view.busy)}
      onRequestClose={() => { dialogRef.current = null; setDialog(null); }}>
      <View style={styles.backdrop}><View style={styles.card} accessibilityViewIsModal>
        <Text style={styles.title}>{dialog?.action.kind === 'call' ? 'Chamar o próximo participante?'
          : dialog?.action.kind === 'complete' ? 'Concluir atendimento?'
            : dialog?.action.kind === 'absent' ? 'Registrar ausência?'
              : 'Remover pessoa da fila?'}</Text>
        <Text style={styles.text}>Confirme a operação presencial. Uma resposta incerta bloqueará novas ações até reconciliação.</Text>
        <Button label="CONFIRMAR OPERAÇÃO" onPress={() => dispatch(dialog, true)} />
        <Button label="CANCELAR OPERAÇÃO" onPress={() => { dialogRef.current = null; setDialog(null); }} />
      </View></View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: 14 }, title: { color: '#fff', fontSize: 19, fontWeight: '800' },
  text: { color: '#cbd5e1', fontSize: 15, lineHeight: 22 },
  card: { gap: 10, padding: 16, borderRadius: 14, backgroundColor: '#191330', borderWidth: 1, borderColor: '#34265a' },
  button: { padding: 15, borderRadius: 14, backgroundColor: '#7c3aed', alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' }, disabled: { opacity: 0.45 },
  warning: { color: '#fbbf24', lineHeight: 22 }, success: { color: '#86efac', lineHeight: 22 },
  backdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.7)' },
});
