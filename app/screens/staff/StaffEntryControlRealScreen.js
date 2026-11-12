import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '../../context/AuthContext';
import { createStaffEntryStore } from '../../services/staffEntryService';
import { defaultStaffEntryIntentStorage } from '../../services/staffEntryIntentStorage';

function Button({ label, onPress, disabled = false, danger = false }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    onPress={disabled ? undefined : onPress} style={[styles.button, danger && styles.danger, disabled && styles.disabled]}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
}
export default function StaffEntryControlRealScreen({ event, isEventCurrent, onBack }) {
  const auth = useAuth(), live = useRef(null);
  live.current = { auth, event, isEventCurrent };
  const getContext = () => {
    const { auth: current, event: selected, isEventCurrent: selectedIsCurrent } = live.current;
    if (!current?.isAuthenticated || !current.isIdentityVerified() || !current.sessionId || !selectedIsCurrent() ||
        !current.user?.roles?.includes('staff') || current.user.roles.includes('admin')) return null;
    return { userId: current.user.id, sessionId: current.sessionId, eventId: selected.id,
      epoch: current.getSessionEpoch(), revision: current.getIdentityRevision() };
  };
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createStaffEntryStore({
    client: { get: (...args) => live.current.auth.httpClient.get(...args),
      post: (...args) => live.current.auth.httpClient.post(...args), patch: (...args) => live.current.auth.httpClient.patch(...args) },
    storage: defaultStaffEntryIntentStorage, createKey: randomUUID, getContext,
  });
  const store = storeRef.current;
  const [snapshot, setSnapshot] = useState(store.getSnapshot());
  const [dialog, setDialog] = useState(null), dialogRef = useRef(null);
  dialogRef.current = dialog;
  const epoch = auth.getSessionEpoch(), revision = auth.getIdentityRevision();
  useEffect(() => store.subscribe(setSnapshot), [store]);
  useEffect(() => {
    store.setContext(getContext()); setDialog(null); void store.refresh();
    return () => { dialogRef.current = null; store.setContext(null); };
  }, [store, event.id, auth.user?.id, auth.sessionId, epoch, revision]);
  if (!store.isCurrent(snapshot.context)) return null;
  const ownPending = snapshot.pending && ['userId', 'sessionId', 'eventId'].every(key => snapshot.pending[key] === snapshot.context[key]);
  const pending = ownPending ? snapshot.pending : null;
  const disabled = snapshot.busy || snapshot.status !== 'ready' || !snapshot.data ||
    Boolean(snapshot.pending) || snapshot.storageError || !defaultStaffEntryIntentStorage.isPersistent;
  const open = (action) => { if (!disabled && store.isCurrent()) setDialog({ action, context: snapshot.context }); };
  const confirm = (expected) => {
    if (!expected || dialogRef.current !== expected || !store.isCurrent(expected.context)) return;
    dialogRef.current = null; setDialog(null); return store.mutate(expected.action);
  };
  const refresh = () => { dialogRef.current = null; setDialog(null); void store.refresh(); };
  const errors = { session: 'Sessão inválida. Verifique sua sessão ou entre novamente.', denied: 'Acesso ao evento indisponível. Atualize seus eventos autorizados.',
    network: 'Não foi possível conectar. Verifique sua conexão e atualize.', unavailable: 'Não foi possível consultar a fila de entrada. Tente atualizar.' };
  const confirmed = pending?.phase === 'terminal' && pending.outcome.kind === 'confirmed';
  return <View style={styles.content}>
    <Text style={styles.title}>Controle de Entrada</Text>
    <Text style={styles.text}>Fila de acesso ao evento</Text>
    {snapshot.status === 'loading' && <View accessibilityRole="progressbar"><ActivityIndicator color="#a78bfa" /><Text style={styles.text}>Carregando fila de entrada...</Text></View>}
    {snapshot.status === 'error' && <Text accessibilityRole="alert" style={styles.warning}>{errors[snapshot.error]}</Text>}
    {snapshot.data && <>
      <View style={styles.card}>
        <Text style={styles.title}>Fila {snapshot.data.externalQueueEnabled ? 'ATIVA' : 'INATIVA'}</Text>
        <Text style={styles.text}>Aguardando: {snapshot.data.waitingCount}</Text>
        <Text style={styles.text}>{snapshot.data.externalQueueEnabled
          ? 'Chame o próximo participante para conferir sua entrada presencial.'
          : 'Novas participações entram diretamente no evento. Reativar não recoloca quem já foi liberado na fila.'}</Text>
        <Button label={snapshot.data.externalQueueEnabled ? 'Desativar fila externa' : 'Reativar fila externa'}
          danger={snapshot.data.externalQueueEnabled} disabled={disabled || !snapshot.data.canManage}
          onPress={() => open({ kind: 'toggle', enabled: !snapshot.data.externalQueueEnabled })} />
      </View>
      {!snapshot.data.canManage && <Text style={styles.warning}>O evento não permite entradas ou alterações da fila neste momento.</Text>}
      {snapshot.data.pendingCall ? <View style={styles.card}>
        <Text style={styles.title}>Participante chamado: {snapshot.data.pendingCall.displayName}</Text>
        <Button label="Confirmar entrada" disabled={disabled || !snapshot.data.canConfirm}
          onPress={() => open({ kind: 'confirm_call', callId: snapshot.data.pendingCall.id })} />
        <Button label="Marcar ausência" disabled={disabled || !snapshot.data.canMarkAbsent}
          onPress={() => open({ kind: 'absent', callId: snapshot.data.pendingCall.id })} />
        <Button label="Remover da fila" danger disabled={disabled || !snapshot.data.canRemove}
          onPress={() => open({ kind: 'remove', callId: snapshot.data.pendingCall.id })} />
      </View> : <Button label="Chamar próximo" disabled={disabled || !snapshot.data.canCall} onPress={() => open({ kind: 'call' })} />}
      <Text style={styles.title}>Participantes aguardando</Text>
      {snapshot.data.waiting.length === 0 && <Text style={styles.text}>Ninguém está aguardando na fila de entrada.</Text>}
      {snapshot.data.waiting.map((person, index) => <View key={person.participationId} style={styles.card}>
        <Text style={styles.text}>{person.position}. {person.displayName}{index === 0 && !snapshot.data.pendingCall ? ' · Próximo' : ''}</Text>

      </View>)}
    </>}
    {snapshot.storageError && <Text accessibilityRole="alert" style={styles.warning}>Não foi possível verificar o registro seguro da solicitação. Atualize antes de continuar.</Text>}
    {snapshot.knownOutcome?.kind === 'confirmed' && pending?.phase !== 'terminal' && <Text style={styles.success}>O servidor confirmou a alteração, mas o registro local não foi confirmado. Não repita a operação; procure o responsável.</Text>}
    {!defaultStaffEntryIntentStorage.isPersistent && <Text style={styles.warning}>As alterações de entrada estão disponíveis somente no aplicativo com armazenamento seguro.</Text>}
    {snapshot.pending && !ownPending && <Text style={styles.warning}>Há uma solicitação de entrada pendente em outro evento ou sessão desta conta. Procure o responsável antes de continuar.</Text>}
    {pending?.phase === 'dispatching' && <Text accessibilityRole="alert" style={styles.warning}>O resultado de uma solicitação ainda não foi confirmado. Não repita a operação. As alterações estão bloqueadas até verificação pelo responsável.</Text>}
    {pending?.phase === 'reserved' && <>
      <Text style={styles.warning}>Há uma solicitação registrada que ainda não foi enviada.</Text>
      <Button label="Descartar solicitação não enviada" disabled={snapshot.busy} onPress={() => { void store.cancelReserved(pending.key); }} />
    </>}
    {pending?.phase === 'terminal' && <View accessibilityRole="alert" style={styles.card}>
      <Text style={confirmed ? styles.success : styles.warning}>{confirmed
        ? pending.kind !== 'toggle' ? ({call:'Participante chamado pelo servidor.',confirm_call:'Entrada confirmada pelo servidor.',absent:'Ausência registrada pelo servidor.',remove:'Participante removido da espera externa.'}[pending.kind] ?? 'Entrada confirmada pelo servidor.')
          : `Fila ${pending.outcome.result.externalQueueEnabled ? 'reativada' : 'desativada'}. Participantes liberados: ${pending.outcome.result.releasedCount}.`
        : pending.outcome.code === 'ENTRY_NOT_FIRST' ? 'A fila mudou. Confira o primeiro participante na lista atualizada.' : 'A solicitação foi recusada pelo servidor. Confira o estado atualizado.'}</Text>
      <Button label="Entendi" disabled={snapshot.busy} onPress={() => { void store.acknowledge(pending.key); }} />
    </View>}
    <Button label="Atualizar fila de entrada" disabled={snapshot.busy || snapshot.status === 'loading'} onPress={refresh} />
    <Button label="Voltar ao painel" onPress={onBack} />
    <Modal transparent animationType="fade" visible={Boolean(dialog && store.isCurrent(dialog.context) && !snapshot.busy)}
      onRequestClose={() => { dialogRef.current = null; setDialog(null); }}>
      <View style={styles.backdrop}><View style={styles.card} accessibilityViewIsModal>
        <Text style={styles.title}>{dialog?.action.kind !== 'toggle' ? ({call:'Chamar próximo participante?',confirm_call:'Confirmar entrada presencial?',absent:'Marcar ausência externa?',remove:'Remover da fila externa?'}[dialog?.action.kind] ?? '')
          : dialog?.action.enabled ? 'Reativar fila externa?' : 'Desativar fila externa?'}</Text>
        <Text style={styles.text}>{dialog?.action.kind !== 'toggle' ? 'Confirme a ação para a chamada externa apresentada. A remoção cancela somente a espera no evento.'
          : dialog?.action.enabled ? 'Somente novas participações aguardarão. Quem já entrou permanece ativo.'
            : `Todos os ${snapshot.data?.waitingCount ?? 0} participantes aguardando serão liberados. Isso não encerra o evento nem altera filas de experiências.`}</Text>
        <Button label="CONFIRMAR ALTERAÇÃO" onPress={() => confirm(dialog)} />
        <Button label="CANCELAR ALTERAÇÃO" onPress={() => { dialogRef.current = null; setDialog(null); }} />
      </View></View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  content: { gap: 14 }, title: { color: '#fff', fontSize: 20, fontWeight: '800' }, text: { color: '#cbd5e1', fontSize: 15, lineHeight: 22 },
  card: { gap: 12, padding: 16, borderRadius: 14, backgroundColor: '#191330', borderWidth: 1, borderColor: '#34265a' },
  button: { padding: 16, borderRadius: 14, backgroundColor: '#7c3aed', alignItems: 'center' }, danger: { backgroundColor: '#9f2345' },
  buttonText: { color: '#fff', fontWeight: '700' }, disabled: { opacity: 0.45 }, warning: { color: '#fbbf24', lineHeight: 22 },
  success: { color: '#86efac', lineHeight: 22 }, backdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.7)' },
});
