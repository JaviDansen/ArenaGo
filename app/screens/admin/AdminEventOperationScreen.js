import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '../../context/AuthContext';
import { adminIdentifier, formatAdminDate } from '../../services/adminEventsService';
import { readAdminEventOperation } from '../../services/adminEventOperationService';
import { adminReadOwner } from './useAdminEvents';
import { bindOperationSession, operationError } from './adminOperationSession';
import { allowedEventOperations, observedOperationNow, operationClock, prepareEventOperation } from './adminOperationForm';
import AdminLiveScreen from './components/AdminLiveScreen';
import AdminNotice from './components/AdminNotice';
import AdminButton from './components/AdminButton';
import AdminConfirmDialog from './components/AdminConfirmDialog';
import { OperationCloseCard, OperationEventCard, OperationMetrics, OperationQueueCard } from './components/AdminOperationCards';
import { ScheduleDateTime, SettingsField, SettingsSection } from './components/AdminScheduleFields';
import { liveColors as c, liveStyles as s } from './components/AdminLiveUI';

function useOperationSnapshot(navigation, eventId, owner, session) {
  const auth = useAuth(), client = auth.httpClient;
  const live = useRef(null), control = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  live.current = { auth, client, owner, eventId, session };

  useEffect(() => {
    const scope = { client, owner, eventId, session };
    let mounted = true, started = false, generation = 0, published = null;
    const current = () => mounted && navigation.isFocused() && live.current?.client === client &&
      adminReadOwner(live.current?.auth) === owner && live.current?.eventId === eventId && live.current?.session === session;
    function publish(value) {
      published = { scope, ...value };
      setSnapshot(published);
    }
    async function refresh() {
      if (!current() || session.snapshot(eventId).denied) return;
      const ticket = ++generation;
      publish({ loading: true });
      try {
        const view = await readAdminEventOperation(client, eventId);
        if (current() && ticket === generation) publish({ view, receivedAt: operationClock() });
      } catch (error) {
        if (current() && ticket === generation) publish({ error: operationError(error), denied: [401, 403].includes(error?.status) });
      }
    }
    function focus() {
      if (started || !current()) return;
      started = true;
      void refresh();
    }
    control.current = { refresh, isCurrent: value => current() && value === published && Boolean(published?.view) };
    const offFocus = navigation.addListener('focus', focus);
    const offBlur = navigation.addListener('blur', () => {
      started = false;
      generation++;
      published = null;
    });
    focus();
    return () => {
      mounted = false;
      control.current = null;
      offFocus();
      offBlur();
    };
  }, [navigation, client, owner, eventId, session]);

  const scope = snapshot?.scope;
  return {
    snapshot: scope && scope.owner === owner && scope.client === client && scope.eventId === eventId &&
      scope.session === session ? snapshot : { loading: true },
    refresh: () => control.current?.refresh(),
    isCurrent: value => control.current?.isCurrent(value) === true,
  };
}

function consequences(draft) {
  if (draft.kind === 'queue') return draft.enabled
    ? 'A fila externa será usada por novos ingressos elegíveis. Quem já entrou continua ativo.'
    : 'As pessoas que aguardam na fila externa passam a ativas. Novos ingressos elegíveis entram sem espera externa.';
  return draft.mode === 'immediate'
    ? 'Novos ingressos serão bloqueados. O servidor encerrará participações e filas abertas e cancelará chamadas pendentes, preservando atendimentos concluídos.'
    : 'Novos ingressos e inscrições internas serão bloqueados e a espera externa será finalizada. Só operações internas admissíveis já existentes poderão continuar até o prazo.';
}

function actionTitle(draft) {
  if (draft.kind === 'queue') return draft.enabled ? 'Ativar fila externa' : 'Desativar fila externa';
  return draft.mode === 'immediate' ? 'Encerrar imediatamente' : 'Encerramento controlado';
}

function receiptText(receipt, timezone) {
  const { kind, result } = receipt;
  if (kind === 'queue') {
    const action = result.externalQueueEnabled ? 'Fila externa ativa' : 'Fila externa desativada';
    const at = result.changedAt ? ` Alteração registrada em ${formatAdminDate(result.changedAt, timezone)}.` : '';
    return `${action}. Pessoas liberadas: ${result.releasedCount}.${at}`;
  }
  const action = result.closureMode === 'immediate' ? 'Encerramento imediato' : 'Encerramento controlado';
  return `${action} registrado. Corte de ingressos: ${formatAdminDate(result.newEntriesClosedAt, timezone)}. ` +
    `Prazo efetivo: ${formatAdminDate(result.effectiveOperationalDeadlineAt, timezone)}. ` +
    `Pessoas finalizadas na espera externa: ${result.externalWaitingFinalized}.`;
}

export default function AdminEventOperationScreen({ navigation, eventId }) {
  const auth = useAuth(), owner = adminReadOwner(auth);
  let valid = false;
  try { adminIdentifier(eventId); valid = true; } catch { /* Uma rota incompleta não inicia leitura. */ }
  const session = owner && valid && auth.getAdminOperationSession?.((manager, active) =>
    bindOperationSession(manager, randomUUID, active));
  if (session) return <EventOperation key={owner + ':' + eventId} {...{ navigation, eventId, owner, session }} />;
  return <AdminLiveScreen title="Operação do evento" eyebrow="PAINEL DO EVENTO" navigation={navigation} backLabel="Voltar ao painel"
    onBack={() => valid ? navigation.popTo('AdminRealEvent', { eventId }) : navigation.goBack()} showTabs>
    <AdminNotice tone="error" title={valid ? 'Acesso administrativo indisponível' : 'Evento não encontrado ou indisponível.'} />
  </AdminLiveScreen>;
}

function EventOperation({ navigation, eventId, owner, session }) {
  const { snapshot, refresh, isCurrent } = useOperationSnapshot(navigation, eventId, owner, session);
  const { view } = snapshot;
  const [, render] = useState(0);
  const [draft, setDraft] = useState(null), [error, setError] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const live = useRef(null);
  live.current = { draft, confirmation, snapshot, refresh, isCurrent };
  const state = session.snapshot(eventId);
  const { intent, receipt } = state;
  const blocked = state.denied || (snapshot.denied && snapshot.error);

  useEffect(() => {
    const unsubscribe = session.subscribe((id, reload) => {
      if (id && id !== eventId) return;
      render(n => n + 1);
      if (reload && navigation.isFocused()) void live.current.refresh();
    });
    const offBlur = navigation.addListener('blur', () => {
      live.current = { ...live.current, draft: null, confirmation: null };
      setDraft(null);
      setConfirmation(null);
      setError(null);
    });
    return () => { unsubscribe(); offBlur(); };
  }, [navigation, session, eventId]);

  useEffect(() => {
    if (!view || blocked || view.effectivePhase === 'closed') return undefined;
    const now = observedOperationNow(snapshot);
    const next = [view.startsAt, view.officialEndsAt, view.adminDeadlineAt ?? view.operationalDeadlineAt]
      .map(at => Date.parse(at)).filter(at => at > now).sort((a, b) => a - b)[0];
    if (!next) return undefined;
    const timer = setTimeout(() => { void live.current.refresh(); }, Math.min(next - now + 250, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [snapshot, view, blocked]);

  const now = view ? observedOperationNow(snapshot) : 0;
  const allowed = view ? allowedEventOperations(view, now) : {};
  const formVisible = draft && allowed[draft.kind] && !blocked && !intent;
  const confirmationVisible = Boolean(confirmation && formVisible && confirmation.snapshot === snapshot);
  const isImmediate = draft?.mode === 'immediate';
  const formIcon = draft?.kind === 'queue' ? (draft.enabled ? 'gauge' : 'pause') : isImmediate ? 'stop' : 'history';
  function open(selection) {
    if (!isCurrent(snapshot) || session.snapshot(eventId).intent || !allowedEventOperations(view, observedOperationNow(snapshot))[selection.kind]) return;
    setDraft({ ...selection, reason: '', deadline: { date: '', time: '' } });
    setConfirmation(null);
    setError(null);
  }
  function edit(patch) {
    if (live.current.draft !== draft) return;
    setDraft({ ...draft, ...patch });
    setError(null);
  }
  function cancel() {
    live.current = { ...live.current, draft: null, confirmation: null };
    setDraft(null);
    setConfirmation(null);
    setError(null);
  }
  function review() {
    if (!formVisible || live.current.draft !== draft || !isCurrent(snapshot) || session.snapshot(eventId).intent) return;
    try {
      prepareEventOperation(view, draft, observedOperationNow(snapshot));
      setConfirmation({ draft, snapshot });
      setError(null);
    } catch (invalid) { setError(invalid.message); }
  }
  function confirm() {
    if (!confirmationVisible || live.current.confirmation !== confirmation || live.current.draft !== confirmation.draft ||
        !isCurrent(confirmation.snapshot) || session.snapshot(eventId).intent) return;
    try {
      const command = prepareEventOperation(view, confirmation.draft, observedOperationNow(snapshot));
      cancel();
      void session.start(eventId, { ...command, timezone: view.timezone });
    } catch (invalid) {
      setConfirmation(null);
      setError(invalid.message);
    }
  }
  function retry() {
    if (!view || blocked || !isCurrent(snapshot) || session.snapshot(eventId).intent !== intent) return;
    void session.retry(eventId, intent);
  }

  return <AdminLiveScreen title="Operação do evento" eyebrow="PAINEL DO EVENTO"
    subtitle="Acompanhe o funcionamento e gerencie os controles do evento."
    navigation={navigation} backLabel="Voltar ao painel" onBack={() => navigation.popTo('AdminRealEvent', { eventId })} showTabs>
    {blocked ? <AdminNotice tone="error" title="Sessão sem autorização" message={blocked} /> : <>
      {intent?.status === 'sending' && <AdminNotice title="Operação administrativa em andamento" />}
      {intent && intent.status !== 'sending' && <AdminNotice tone="warning" title="Resultado ainda não confirmado" message={state.error}>
        <Text style={s.body}>Solicitação: {actionTitle({ kind: intent.kind, ...intent.body })}.</Text>
        <Text style={s.body}>A consulta mostra o estado persistido. A coincidência com a ação solicitada não confirma a operação.</Text>
        {intent.status === 'unknown' && view && <AdminButton label="Reenviar a mesma solicitação" onPress={retry} variant="secondary" />}
      </AdminNotice>}
      {!intent && state.error && <AdminNotice tone="error" title="Operação recusada" message={state.error} />}
      {receipt && <AdminNotice tone="success" title="Resposta confirmada"
        message={receiptText(receipt, view?.timezone ?? receipt.timezone ?? 'UTC')} />}
      {snapshot.loading ? <AdminNotice title="Carregando operação..." /> : !view ?
        <AdminNotice tone="error" title="Dados operacionais indisponíveis" message={snapshot.error}>
          <AdminButton label="Tentar novamente" onPress={refresh} />
        </AdminNotice> : <>
          <OperationEventCard view={view} onRefresh={refresh} />
          <OperationMetrics view={view} />
          <OperationQueueCard enabled={view.externalQueueEnabled} unavailable={!allowed.queue}
            onToggle={allowed.queue && !intent ? () => open({ kind: 'queue', enabled: !view.externalQueueEnabled }) : undefined} />
          <OperationCloseCard onSelect={allowed.close && !intent ? mode => open({ kind: 'close', mode }) : undefined}
            unavailableMessage={allowed.close ? undefined : view.effectivePhase === 'closing' || view.effectivePhase === 'closed'
              ? 'O encerramento já está em curso ou concluído. O estado é atualizado pelo servidor.'
              : 'O encerramento administrativo está indisponível nesta situação.'} />
          {formVisible && <SettingsSection title={actionTitle(draft)} icon={formIcon} iconColor={isImmediate ? c.danger : undefined}>
            {isImmediate ? <AdminNotice tone="warning" title="Ação crítica" message={consequences(draft)} />
              : <Text style={s.body}>{consequences(draft)}</Text>}
            {draft.mode === 'controlled' && <>
              <Text style={s.body}>Escolha um prazo futuro no fuso {view.timezone}. Máximo de uma hora, limitado a {formatAdminDate(view.operationalDeadlineAt, view.timezone)}.</Text>
              <ScheduleDateTime label="encerramento" timezone={view.timezone} instant={view.observedAt} value={draft.deadline} wideFields
                onChange={deadline => edit({ deadline })} />
            </>}
            <SettingsField label="Justificativa" value={draft.reason} onChangeText={reason => edit({ reason })} />
            {error && <AdminNotice tone="error" title={error} />}
            <AdminButton label="Revisar operação" onPress={review} />
            <AdminButton label="Cancelar operação" onPress={cancel} variant="secondary" />
          </SettingsSection>}
          {confirmationVisible && <AdminConfirmDialog visible title={`Confirmar: ${actionTitle(draft)}?`}
            message={`${view.name}: ${consequences(draft)}`}
            note={draft.mode === 'controlled' ? `Prazo solicitado: ${draft.deadline.date} às ${draft.deadline.time} (${view.timezone}).` : undefined}
            confirmLabel="Confirmar operação" cancelLabel="Voltar à edição" variant={draft.kind === 'close' ? 'danger' : 'primary'}
            onConfirm={confirm} onCancel={() => {
              live.current = { ...live.current, confirmation: null };
              setConfirmation(null);
            }} />}
        </>}
    </>}
  </AdminLiveScreen>;
}
