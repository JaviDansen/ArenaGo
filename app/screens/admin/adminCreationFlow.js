import { getAdminEvent, getAdminEventReadiness } from '../../services/adminEventsService';
import { createAdminEvent, grantEventStaff, readEventStructure, revokeEventStaff } from '../../services/adminEventSetupService';
import { configurationName, confirmOfficialEnd, creationBody, eventIdentity, staffEmail } from './adminCreationForm';
import { attemptStructureIntent, forgetStructureIntent, matchesStructureIntent, structureIntentId,
  structureIntentsFor } from './adminStructureIntents';

const emptyDate = () => ({ date: '', time: '' });
const initialForm = () => ({ name: '', accessCode: '', timezone: 'America/Fortaleza', margin: '0',
  start: emptyDate(), end: emptyDate(), externalQueueEnabled: false });
const endedPhase = phase => phase === 'closing' || phase === 'closed';
const uncertainMessage = 'Resultado não confirmado. Consulte os dados ou repita explicitamente a mesma solicitação.';
function structureRecoveryMessage({ kind, value }) {
  const resource = kind === 'addExperience' ? `experiência “${value}”` : `estação “${value}”`;
  return `O cadastro da ${resource} ficou sem confirmação. Confira os dados salvos antes de repetir a solicitação.`;
}

function writeMessage(error, operation) {
  const messages = {
    ACCESS_CODE_ALREADY_USED: 'Este código já foi reservado. Escolha outro código na primeira etapa.',
    ROLE_ALREADY_GRANTED: 'Este usuário já possui Staff neste evento.',
    ROLE_TARGET_INELIGIBLE: 'O usuário precisa ter conta ativa e e-mail verificado.',
    EVENT_CONFIGURATION_LOCKED: 'O evento já tem participação registrada e sua estrutura está protegida.',
    EVENT_OPERATION_ENDED: 'O evento já encerrou a janela de configuração.',
    IDEMPOTENCY_KEY_REUSED: 'Conflito de intenção. Consulte os registros antes de iniciar outra ação.',
  };
  if (messages[error?.code]) return messages[error.code];
  if (error?.status === 404) return 'O recurso ou usuário não foi encontrado.';
  if (operation === 'station') return 'A estação não foi salva. A experiência permanece cadastrada. Confira sua identificação.';
  if (error?.status === 400) return 'O servidor rejeitou os dados. Revise os campos desta etapa.';
  return 'A operação foi recusada. Confira os dados antes de tentar novamente.';
}

// One instance per mounted wizard, authenticated session and selected event.
export function createEventSetup({ client, eventId = null, isCurrent, newKey, now = Date.now, structureIntents: sessionIntents }) {
  const structureIntents = sessionIntents ?? new Map();
  const pendingCreates = id => structureIntentsFor(structureIntents, id)
    .filter(record => record.kind === 'addExperience' || record.kind === 'addStation');
  const recovered = pendingCreates(eventId)[0];
  let state = { step: eventId ? 3 : 1, stepVersion: 0, eventId, form: initialForm(), edited: false, event: null, ended: false,
    items: [], readiness: null, grants: [], busy: false, loading: Boolean(eventId), blocked: false,
    readError: null, message: recovered ? structureRecoveryMessage(recovered) : null, uncertain: Boolean(recovered),
    experience: '', station: '', parent: null, email: '' };
  let active = false, generation = 0, intent = recovered ? structureAction(recovered) : null, lifecycle = 0;
  let reviewed = new Map();
  const listeners = new Set();
  const current = () => active && isCurrent();
  const update = patch => {
    if (!current()) return;
    state = { ...state, ...patch };
    listeners.forEach(listener => listener(state));
  };
  const editable = () => current() && !state.busy && !state.blocked && !intent;
  const canEditStructure = () => current() && !state.busy && !state.blocked && (!intent || (intent.structure && state.uncertain));
  const canReview = (record = intent?.structure) => Boolean(record && reviewed.has(record) &&
    reviewed.get(record) === record.attempts && !record.flight && structureIntents.get(record.id) === record);
  function clearIntent() { intent = null; }
  function deny() {
    intent = null;
    generation++;
    update({ blocked: true, busy: false, loading: false, uncertain: false, event: null, readiness: null,
      items: [], grants: [], form: initialForm(), email: '', experience: '', station: '', parent: null, message: null });
  }
  async function refresh() {
    if (!current() || !state.eventId || state.busy || state.blocked) return;
    const ticket = ++generation;
    const id = state.eventId;
    reviewed = new Map();
    const observed = pendingCreates(id).filter(record => !record.flight).map(record => [record, record.attempts]);
    update({ loading: true, readError: null, readiness: null });
    const results = await Promise.allSettled([
      getAdminEvent(client, id), readEventStructure(client, id), getAdminEventReadiness(client, id),
    ]);
    if (!current() || ticket !== generation) return;
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.some(result => [401, 403].includes(result.reason?.status))) { deny(); return; }
    if (failures.length) {
      update({ loading: false, event: null, items: [], readError: failures.some(result => result.reason?.status === 404)
        ? 'Evento não encontrado ou indisponível.' : 'Não foi possível confirmar os dados e a prontidão do evento.' });
      return;
    }
    const [event, items, readiness] = results.map(result => result.value);
    if (typeof event.accessCode !== 'string' || !event.accessCode.trim() || typeof event.externalQueueEnabled !== 'boolean' ||
        !Number.isFinite(Date.parse(event.operationalDeadlineAt))) {
      update({ loading: false, event: null, items: [], readError: 'Os dados do evento estão incompletos.' });
      return;
    }
    for (const [record, attempts] of observed) {
      if (record.flight || attempts !== record.attempts || structureIntents.get(record.id) !== record) continue;
      reviewed.set(record, attempts);
      if (record.result && matchesStructureIntent(items, record)) forgetStructureIntent(structureIntents, record);
    }
    if (intent?.structure && structureIntents.get(intent.structure.id) !== intent.structure) {
      intent = null;
      update({ uncertain: false, message: null });
    }
    update({ event, items, readiness, loading: false,
      ended: state.ended || endedPhase(event.effectivePhase) || endedPhase(readiness.effectivePhase) });
  }
  function step(next) {
    if (!editable() || state.ended || next < 1 || next > 6 || (next > 2 && !state.eventId)) return;
    if (next === 6 && (!state.readiness || state.loading || state.readError)) return;
    update({ step: next, stepVersion: state.stepVersion + 1, message: null });
    if (state.eventId) void refresh();
  }
  async function submit(action) {
    if (!current() || state.busy || state.blocked || state.ended || intent !== action) return;
    const retrying = state.uncertain;
    if (action.structure && (action.structure.flight || structureIntents.get(action.structure.id) !== action.structure)) return refresh();
    if (action.kind === 'create') {
      try { confirmOfficialEnd(action.officialEndsAt, now()); }
      catch (error) {
        if (!retrying) clearIntent();
        update({ message: retrying
          ? 'O término oficial foi alcançado e o resultado do envio anterior continua sem confirmação. Confira os registros antes de cadastrar outro evento. Eventos encerrados podem ficar fora da listagem.'
          : error.message });
        return;
      }
    }
    const epoch = lifecycle;
    generation++;
    update({ busy: true, uncertain: false, message: null });
    try {
      const result = await action.send();
      if (!current() || epoch !== lifecycle) return;
      if (action.structure) {
        update({ busy: false });
        await refresh();
        if (!current() || epoch !== lifecycle || state.blocked) return;
        const pending = structureIntents.get(action.structure.id) === action.structure;
        update(pending ? { uncertain: true, message: structureRecoveryMessage(action.structure) } :
          { ...action.confirmed(result), uncertain: false });
        return;
      }
      clearIntent();
      update({ ...action.confirmed(result), busy: false });
      await refresh();
    } catch (error) {
      if (!current() || epoch !== lifecycle) return;
      if ([401, 403].includes(error?.status)) {
        if (!retrying) clearIntent();
        deny();
        return;
      }
      if (error?.status === 404 && action.kind === 'revoke') {
        clearIntent();
        update({ busy: false, uncertain: false, grants: state.grants.filter(item => item.id !== action.grantId),
          message: 'Este vínculo Staff não está mais disponível.' });
        await refresh();
        return;
      }
      const unknown = action.structure ? structureIntents.get(action.structure.id) === action.structure :
        !error?.status || error.outcomeUnknown || error.status >= 500 || error.status === 408 ||
          error.code === 'IDEMPOTENCY_IN_PROGRESS' || (retrying && error.status === 429);
      if (!unknown) clearIntent();
      update({ busy: false, uncertain: Boolean(unknown), message: unknown
        ? (action.structure ? [error?.code === 'EVENT_OPERATION_ENDED' ? writeMessage(error, action.kind) : '',
          structureRecoveryMessage(action.structure)].filter(Boolean).join(' ') : uncertainMessage)
        : writeMessage(error, action.kind) });
      if (action.structure && unknown) await refresh();
    }
  }
  function write(kind, send, confirmed, details) {
    const key = newKey();
    intent = { kind, send: () => send(key), confirmed, ...details };
    return submit(intent);
  }
  function structureAction(structure) {
    const isExperience = structure.kind === 'addExperience';
    return { kind: isExperience ? 'experience' : 'station', structure,
      send: () => attemptStructureIntent(client, structureIntents, structure),
      confirmed: () => isExperience ? { experience: '', message: 'Experiência salva.' } :
        { station: '', parent: null, message: 'Estação salva.' } };
  }
  function writeStructure(record) {
    record.id = structureIntentId(record);
    const saved = structureIntents.get(record.id);
    if (saved) {
      intent = structureAction(saved);
      update({ uncertain: true, message: structureRecoveryMessage(saved) });
      return refresh();
    }
    const structure = { ...record, key: newKey() };
    intent = structureAction(structure);
    structureIntents.set(structure.id, structure);
    return submit(intent);
  }
  function confirmCreate(version) {
    if (version !== state.stepVersion || state.step !== 2 || state.eventId || !editable()) return;
    try {
      const body = creationBody(state.form);
      return write('create', key => createAdminEvent(client, body, key), event => ({
        eventId: event.id, event, step: 3, stepVersion: state.stepVersion + 1, ended: endedPhase(event.effectivePhase),
        edited: false, form: initialForm(), message: 'Evento salvo.',
      }), { officialEndsAt: body.officialEndsAt });
    } catch (error) { update({ message: error.message }); }
  }
  function run(kind, grantId) {
    const id = state.eventId;
    const structural = kind === 'experience' || kind === 'station';
    if (!(structural ? canEditStructure() : editable()) || state.loading || state.readError || state.ended || !id || !state.event) return;
    try {
      if (kind === 'experience' && state.step === 3) {
        const name = configurationName(state.experience, 160);
        return writeStructure({ kind: 'addExperience', eventId: id, value: name });
      }
      if (kind === 'station' && state.step === 3 && state.items.some(item => item.id === state.parent)) {
        const label = configurationName(state.station, 120);
        return writeStructure({ kind: 'addStation', eventId: id, experienceId: state.parent, value: label });
      }
      if (kind === 'grant' && state.step === 4) {
        const email = staffEmail(state.email);
        return write(kind, key => grantEventStaff(client, id, email, key), grant => ({
          email: '', grants: [...state.grants.filter(item => item.id !== grant.id), { ...grant, email }], message: 'Concessão confirmada.',
        }));
      }
      if (kind === 'revoke' && state.step === 4) {
        const grant = state.grants.find(item => item.id === grantId);
        if (grant) return write(kind, key => revokeEventStaff(client, id, grant, key), () => ({
          grants: state.grants.filter(item => item.id !== grantId), message: 'Revogação confirmada.',
        }), { grantId });
      }
    } catch (error) { update({ message: error.message }); }
  }
  return {
    snapshot: () => state,
    pendingStructure: () => intent?.structure,
    canReviewStructure: () => canReview(),
    mount(listener) {
      active = true;
      listeners.add(listener);
      listener(state);
      void refresh();
      return () => { active = false; generation++; lifecycle++; listeners.delete(listener); };
    },
    editForm(patch) {
      if (editable() && !state.eventId) update({ form: { ...state.form, ...patch }, edited: true, message: null });
    },
    editSetup(patch) {
      if ((Object.hasOwn(patch, 'email') ? editable() : canEditStructure()) && state.eventId) update({ ...patch, message: null });
    },
    next(version) {
      if (version !== state.stepVersion || !editable() || state.loading || state.readError) return;
      if (!state.eventId && state.step === 2) return;
      if (!state.eventId && state.step === 1) {
        try { update({ form: { ...state.form, ...eventIdentity(state.form) } }); }
        catch (error) { update({ message: error.message }); return; }
      }
      step(state.step + 1);
    },
    back: () => step(state.step - 1), step, refresh, run, confirmCreate,
    retry(record = intent?.structure ?? null) {
      if (!intent || !state.uncertain || state.loading) return;
      if (record !== (intent.structure ?? null)) return;
      if (intent.structure && (state.readError || !canReview())) return refresh();
      return submit(intent);
    },
    discardStructureIntent(record = intent?.structure) {
      if (!current() || state.blocked || state.ended || state.busy || state.loading || state.readError ||
          !state.uncertain || record !== intent?.structure || !canReview(record) || !forgetStructureIntent(structureIntents, record)) return;
      clearIntent();
      update({ uncertain: false, experience: '', station: '', parent: null,
        message: 'A confirmação pendente foi descartada. O cadastro anterior ainda pode ter sido salvo. Confira a estrutura antes de cadastrar novamente.' });
    },
  };
}
