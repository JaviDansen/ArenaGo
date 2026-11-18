import { adminIdentifier, getAdminEvent, getAdminEventReadiness } from '../../services/adminEventsService';
import { readEventStructure } from '../../services/adminEventSetupService';
import { configurationName } from './adminCreationForm';
import { attemptStructureIntent, forgetStructureIntent, matchesStructureIntent, structureIntentId,
  structureIntentsFor } from './adminStructureIntents';

const messages = {
  EVENT_CONFIGURATION_LOCKED: 'Já existe histórico de participação. Esta alteração da estrutura está bloqueada.',
  EVENT_OPERATION_ENDED: 'A operação do evento já terminou.',
  STATION_HAS_PENDING_CALL: 'Há uma chamada pendente. Aguarde sua resolução pela equipe Staff.',
  IDEMPOTENCY_KEY_REUSED: 'A chave já foi usada para outra solicitação. Confira os registros antes de continuar.',
  VALIDATION_ERROR: 'O servidor recusou os dados. Revise a identificação.',
};

function problem(error) {
  if (error?.status === 401) return 'Sessão inválida. Entre novamente.';
  if (error?.status === 403) return 'Acesso administrativo negado.';
  if (error?.status === 404) return 'Recurso não encontrado ou indisponível.';
  if (error?.isNetworkError || error?.status >= 500) return 'Falha na consulta ao servidor. Confira a conexão e atualize.';
  return messages[error?.code] || 'Não foi possível confirmar a resposta para o evento selecionado. Atualize a estrutura.';
}

function target(items, command) {
  const group = items.find(item => item.id === command.experienceId);
  return { group, station: group?.stations.find(row => row.id === command.stationId) };
}

function recoveryMessage(record) {
  if (record.flight) return 'Envio em andamento. Aguarde a atualização.';
  if (record.error?.code === 'IDEMPOTENCY_IN_PROGRESS') return 'Solicitação ainda em processamento. Confira a estrutura antes de repetir.';
  if (record.error?.status && !record.error.outcomeUnknown) return problem(record.error);
  if (record.result) return 'O estado atual difere do solicitado. Confira a estrutura antes de outra alteração.';
  return 'Resultado incerto. Confira a estrutura antes de repetir a mesma solicitação.';
}

export function createStructureFlow({ client, eventId, intents, newKey, isCurrent }) {
  const pending = () => structureIntentsFor(intents, eventId);
  let state = { data: null, loading: true, busy: false, denied: false, message: '', pending: [] };
  let reviewed = new Map();
  let listener, generation = 0;
  const active = () => Boolean(listener && isCurrent());
  const canReview = record => Boolean(record && reviewed.has(record) && reviewed.get(record) === record.attempts &&
    !record.flight && intents.get(record.id) === record);
  function update(patch) {
    if (!active()) return;
    state = { ...state, ...patch };
    listener(state);
  }
  function deny(error) {
    generation++;
    update({ denied: true, data: null, loading: false, busy: false, pending: [], message: problem(error) });
  }

  async function refresh(notice = '', afterWrite = false) {
    if (!active() || state.denied || (state.busy && !afterWrite)) return;
    const ticket = ++generation;
    reviewed = new Map();
    update({ loading: true, data: null, message: '', pending: [] });
    try {
      const observed = pending().map(record => ({ record, flight: record.flight, attempts: record.attempts }));
      const responses = await Promise.allSettled([
        getAdminEvent(client, eventId), readEventStructure(client, eventId), getAdminEventReadiness(client, eventId),
      ]);
      if (!active() || ticket !== generation) return;
      const failure = responses.find(r => r.status === 'rejected' && [401, 403].includes(r.reason?.status)) ??
        responses.find(r => r.status === 'rejected');
      if (failure) throw failure.reason;
      const [event, items, readiness] = responses.map(r => r.value);
      const groups = new Set(items.map(group => group.id));
      if (groups.size !== items.length) throw new Error('Experiência duplicada na estrutura.');
      const stations = new Set();
      for (const group of items) for (const row of group.stations) {
        if (stations.has(row.id)) throw new Error('Estação duplicada na estrutura.');
        stations.add(row.id);
        if (row.pendingServiceSessionId !== null) adminIdentifier(row.pendingServiceSessionId);
      }
      for (const { record, flight, attempts } of observed) {
        if (flight || record.flight || attempts !== record.attempts || intents.get(record.id) !== record) continue;
        reviewed.set(record, attempts);
        if (!record.result && record.kind !== 'availability') continue;
        const confirmed = matchesStructureIntent(items, record);
        if (confirmed || record.kind === 'availability') {
          forgetStructureIntent(intents, record);
          notice ||= confirmed ? 'Estado solicitado confirmado na estrutura do evento.' :
            'O estado atual difere do solicitado. Confira a estrutura antes de outra alteração.';
        }
      }
      const outstanding = pending();
      update({ data: { event, items, readiness }, loading: false, busy: false, message: notice || (outstanding.length === 1 ?
        recoveryMessage(outstanding[0]) : ''), pending: outstanding });
      for (const flight of new Set(observed.map(item => item.flight).filter(Boolean))) {
        void flight.then(recheck, recheck);
      }
      function recheck() { if (ticket === generation && active()) void refresh(); }
    } catch (error) {
      if (!active() || ticket !== generation) return;
      if ([401, 403].includes(error?.status)) deny(error);
      else update({ data: null, loading: false, busy: false, message: [notice, problem(error)].filter(Boolean).join(' ') });
    }
  }

  async function submit(action) {
    const request = attemptStructureIntent(client, intents, action);
    if (!request) return;
    update({ busy: true, message: '' });
    generation++;
    let notice = '';
    try { await request; }
    catch (error) {
      if ([401, 403].includes(error?.status) && active()) deny(error);
      if (intents.get(action.id) !== action || error?.code === 'EVENT_OPERATION_ENDED') notice = problem(error);
    }
    if (!active() || state.denied) return;
    // Uma intenção transmitida e ainda incerta volta pelo cartão de recuperação,
    // inclusive se a leitura seguinte falhar. O formulário fica para recusas definitivas.
    const dismissForm = Boolean(action.result) || intents.get(action.id) === action;
    await refresh(notice, true);
    return dismissForm;
  }

  return {
    isActive: active,
    canReview,
    recoveryMessage,
    snapshot: () => state,
    mount(callback) { listener = callback; void refresh(); return () => { generation++; listener = null; }; },
    refresh: () => refresh(),
    async save(command, displayed = state.data) {
      if (!active() || !state.data || displayed !== state.data || state.busy || state.loading ||
          state.data.readiness.effectivePhase === 'closed' || state.data.event.effectivePhase === 'closed') return;
      const { group, station } = target(state.data.items, command);
      const { kind } = command;
      if ((kind !== 'addExperience' && !group) ||
          (['renameStation', 'availability'].includes(kind) && !station)) {
        await refresh('Recurso não encontrado ou indisponível.');
        return;
      }
      let value;
      try {
        if (command.original !== undefined && command.original !==
            (kind === 'renameStation' ? station.label : kind === 'availability' ? station.availability : group.name)) {
          update({ message: 'A identificação ou disponibilidade mudou. Confira o valor atual antes de editar novamente.' });
          return;
        }
        if (kind === 'availability') {
          value = command.value;
          if (!['available', 'unavailable'].includes(value)) throw new Error('Disponibilidade inválida.');
          if (value === 'unavailable' && station.pendingServiceSessionId) {
            await refresh(messages.STATION_HAS_PENDING_CALL);
            return;
          }
        } else value = configurationName(command.value, kind.endsWith('Station') ? 120 : 160);
      } catch (error) { update({ message: error.message }); return; }
      const action = { eventId, kind, experienceId: kind === 'addExperience' ? undefined : command.experienceId,
        stationId: ['availability', 'renameStation'].includes(kind) ? command.stationId : undefined, value };
      action.id = structureIntentId(action);
      const conflicts = kind.startsWith('rename') && pending().some(record =>
        record.kind === kind && record.experienceId === action.experienceId && record.stationId === action.stationId);
      if (intents.has(action.id) || conflicts) {
        update({ message: 'Já existe uma solicitação pendente para esta operação. Confira a tentativa antes de repetir.',
          pending: pending() });
        return;
      }
      action.key = kind === 'availability' ? undefined : newKey();
      intents.set(action.id, action);
      return submit(action);
    },
    retry(action) {
      if (active() && state.data && canReview(action) && action.kind !== 'availability' &&
          state.data.readiness.effectivePhase !== 'closed' && state.data.event.effectivePhase !== 'closed' &&
          !state.busy && !state.loading) return submit(action);
    },
    discard(action) {
      if (active() && state.data && !state.busy && canReview(action) && forgetStructureIntent(intents, action)) {
        update({ pending: pending(), message: 'Tentativa encerrada. O envio anterior ainda pode ter sido salvo.' });
      }
    },
  };
}
