import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '../../context/AuthContext';
import { createStaffOperationsCoordinator, fetchStaffStationState } from '../../services/staffOperationsService';
import { defaultStaffIntentStorage } from '../../services/staffIntentStorage';

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

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; generation.current++; dialogRef.current = null; };
  }, [event.id, experience.id, station.id, auth.user?.id, auth.sessionId, epoch, revision]);

  const blocked = !same(view.scope, context) || view.busy || view.status !== 'ready' || !coordinator ||
    (view.pending && view.pending.kind !== 'none');
  const open = action => {
    if (!blocked && context) setDialog({ action, context, observed: view.data });
  };
  async function confirm(expected) {
    if (!expected || dialogRef.current !== expected || !same(expected.context, getContext()) ||
        !same(viewRef.current.scope, getContext()) || viewRef.current.busy || viewRef.current.status !== 'ready' ||
        (viewRef.current.pending && viewRef.current.pending.kind !== 'none')) return;
    dialogRef.current = null; setDialog(null);
    const scope = expected.context;
    setView(previous => ({ ...previous, busy: true, feedback: null }));
    let result;
    try {
      const action = expected.action;
      result = action.kind === 'call' ? await coordinator.callNext(scope, experience.id, station.id)
        : action.kind === 'complete' ? await coordinator.complete(scope, action.serviceSessionId, station.id)
          : action.kind === 'absent' ? await coordinator.absent(scope, action.serviceSessionId, station.id)
            : await coordinator.removeWaiting(scope, experience.id, station.id, action.queueEntryId);
    } catch { result = { kind: 'storage_error' }; }
    if (!same(scope, getContext())) return;
    setView(previous => ({ ...previous, busy: false, feedback: result }));
    await refresh(true);
    if (same(scope, getContext())) onChanged();
  }

  async function resolvePending(expected, scope) {
    const pending = viewRef.current.pending;
    if (!coordinator || !same(scope, getContext()) || viewRef.current.busy || !pending || !expected ||
        pending.kind !== expected.kind || !expected.receiptId || pending.receiptId !== expected.receiptId) return;
    setView(previous => ({ ...previous, busy: true }));
    try {
      if (pending.kind === 'reserved') await coordinator.cancelReserved(scope, expected.receiptId);
      if (pending.kind === 'terminal_pending' && pending.receiptId) {
        const target = { ...scope, serviceSessionId: pending.serviceSessionId ?? null };
        const cleanup = await coordinator.cleanupTerminal(target, pending.receiptId);
        if (cleanup.kind === 'terminal_pending') await coordinator.acknowledgeTerminal(target, pending.receiptId);
      }
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
    network: 'Falha de conexão. Atualize a estação.', unavailable: 'Não foi possível consultar a estação.' };
  const data = view.data;
  const pending = view.pending;
  return <View style={styles.content}>
    <Text style={styles.title}>Atendimento da estação</Text>
    <Text style={styles.text}>{experience.name} · {station.label}</Text>
    {view.status === 'loading' && <View accessibilityRole="progressbar"><ActivityIndicator color="#a78bfa" />
      <Text style={styles.text}>Carregando atendimento...</Text></View>}
    {view.status === 'error' && <Text accessibilityRole="alert" style={styles.warning}>{messages[view.error]}</Text>}
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
        <Text style={styles.text}>A chamada precisa ser concluída ou registrada como ausência antes da próxima.</Text>
        <Button label="Concluir atendimento" disabled={blocked} onPress={() => open({ kind: 'complete', serviceSessionId: data.pending.serviceSessionId })} />
        <Button label="Registrar ausência" disabled={blocked} onPress={() => open({ kind: 'absent', serviceSessionId: data.pending.serviceSessionId })} />
      </View> : <Button label="Chamar próximo" disabled={blocked || !data.canCall || data.waitingCount === 0}
        onPress={() => open({ kind: 'call' })} />}
      {data.waitingCount === 0 && <Text style={styles.text}>Nenhuma pessoa aguardando nesta experiência.</Text>}
      {data.waiting.map(person => <View key={person.queueEntryId} style={styles.card}>
        <Text style={styles.text}>{person.position}. {person.displayName}</Text>
        <Button label={`Remover ${person.displayName} da fila`} disabled={blocked}
          onPress={() => open({ kind: 'remove', queueEntryId: person.queueEntryId })} />
      </View>)}
    </>}
    {!coordinator && <Text style={styles.warning}>Operações indisponíveis sem armazenamento seguro neste dispositivo.</Text>}
    {pending?.kind === 'pending_other' && <Text style={styles.warning}>Há uma operação pendente em outra sessão, evento ou estação desta conta.</Text>}
    {pending?.kind === 'pending_reconciliation' && <Text style={styles.warning}>Resultado incerto. Não repita a operação; peça reconciliação ao responsável.</Text>}
    {pending?.kind === 'reserved' && <><Text style={styles.warning}>Solicitação registrada, ainda não enviada.</Text>
      <Button label="Descartar solicitação não enviada" disabled={view.busy} onPress={() => resolvePending(pending, context)} /></>}
    {pending?.kind === 'terminal_pending' && <View style={styles.card}>
      <Text style={pending.outcome?.kind === 'confirmed' ? styles.success : styles.warning}>
        {pending.outcome?.kind === 'confirmed' ? 'Operação confirmada pelo servidor.' : 'Operação recusada pelo servidor.'}</Text>
      <Button label="Entendi o resultado" disabled={view.busy} onPress={() => resolvePending(pending, context)} />
    </View>}
    {pending?.kind === 'storage_error' && <Text style={styles.warning}>Não foi possível verificar a intenção persistida. Operações bloqueadas.</Text>}
    <Button label="Atualizar atendimento" disabled={view.busy || view.status === 'loading'} onPress={() => refresh()} />
    <Modal transparent animationType="fade" visible={Boolean(dialog && same(dialog.context, getContext()) && !view.busy)}
      onRequestClose={() => { dialogRef.current = null; setDialog(null); }}>
      <View style={styles.backdrop}><View style={styles.card} accessibilityViewIsModal>
        <Text style={styles.title}>{dialog?.action.kind === 'call' ? 'Chamar o próximo participante?'
          : dialog?.action.kind === 'complete' ? 'Concluir atendimento?'
            : dialog?.action.kind === 'absent' ? 'Registrar ausência?'
              : 'Remover pessoa da fila?'}</Text>
        <Text style={styles.text}>Confirme a operação presencial. Uma resposta incerta bloqueará novas ações até reconciliação.</Text>
        <Button label="CONFIRMAR OPERAÇÃO" onPress={() => confirm(dialog)} />
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
