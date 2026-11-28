const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');
const api = loadModule('services/staffEntryService.js', require).exports;
const id = n => `abcdef00-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-11-10T15:00:00.000Z';

const context = { userId: id(1), sessionId: id(2), eventId: id(3), epoch: 1, revision: 1 };
const body = () => ({ eventId: id(3), observedAt: at, externalQueueEnabled: true, canManage: true, pendingCall:null, canCall:true,canConfirm:false,canMarkAbsent:false,canRemove:false, waitingCount: 2,
  waiting: [{ participationId: id(4), displayName: 'Ana', position: 1 }, { participationId: id(5), displayName: 'Bia', position: 2 }] });
const callResult=(participationId=id(4))=>({eventId:id(3),call:{id:id(60),participationId,status:'pending',calledAt:at,resolvedAt:null},
 participation:{id:participationId,status:'waiting',arenaEnteredAt:null,finishReason:null,externalQueueOrder:'1'},requeued:false});
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function adapter(values = new Map(), fault = {}) {
  const secureStore = { getItemAsync: async key => { if (fault.read) throw new Error('read'); return values.get(key) ?? null; },
    setItemAsync: async (key, raw) => {
      const value = JSON.parse(raw), match = fault.phase === value.phase;
      if (match && fault.mode === 'before') throw new Error('before');
      values.set(key, raw);
      if (match && fault.pending) { fault.entered?.(); await fault.pending; }
      if (match && fault.mode === 'after') throw new Error('after');
    } };
  const { createStaffEntryIntentStorage } = loadModule('services/staffEntryIntentStorage.js', name => {
    if (name === 'react-native') return { Platform: { OS: 'android' } };
    if (name === 'expo-secure-store') return secureStore;
    if (name === './staffEntryService') return api;
    return require(name);
  }).exports;
  return { storage: createStaffEntryIntentStorage({ platformOS: 'android', secureStore }),
    reopen: () => createStaffEntryIntentStorage({ platformOS: 'android', secureStore }), values, fault };
}
async function rig(options = {}) {
  let current = { ...context }, data = body(), key = 20;
  const persisted = options.persisted ?? adapter(); const calls = [];
  const client = {
    get: async (path, opts) => { calls.push({ method: 'GET', path, opts }); if (options.get) return options.get(); return structuredClone(data); },
    post: async (path, payload, opts) => {
      calls.push({ method: 'POST', path, payload, opts }); if (options.post) return options.post();
      const first = data.waiting.shift(); data.waiting.forEach((p, i) => { p.position = i + 1; }); data.waitingCount--;
      data.pendingCall = {id:id(60),participationId:first.participationId,displayName:first.displayName,calledAt:at};
      Object.assign(data,{canCall:false,canConfirm:true,canMarkAbsent:true,canRemove:true});
      return callResult(first.participationId);
    },
    patch: async (path, payload, opts) => {
      calls.push({ method: 'PATCH', path, payload, opts }); if (options.patch) return options.patch();
      const releasedCount = payload.enabled ? 0 : data.waiting.length + (data.pendingCall ? 1 : 0); data.externalQueueEnabled = payload.enabled;
      if (!payload.enabled) { data.waiting = []; data.waitingCount = 0; data.pendingCall=null;
        Object.assign(data,{canCall:false,canConfirm:false,canMarkAbsent:false,canRemove:false}); }
      return { eventId: data.eventId, externalQueueEnabled: payload.enabled, releasedCount, changedAt: at };
    },
  };
  const make = storage => api.createStaffEntryStore({ client, storage, getContext: () => current, createKey: () => id(key++) });
  const store = make(persisted.storage); store.setContext(current); await store.refresh();
  return { store, persisted, calls, client, make, setContext(value) { current = value; store.setContext(value); }, get current() { return current; } };
}
test('leitura silenciosa atualiza FIFO sem POST e conserva dados durante falha transitória', async () => {
  let answer = body();
  const r = await rig({ get: () => answer });
  answer = { ...body(), waiting: [body().waiting[1]], waitingCount: 1, canCall: true };
  answer.waiting[0].position = 1;
  await r.store.poll();
  assert.equal(r.store.getSnapshot().data.waiting[0].displayName, 'Bia');
  assert.equal(r.calls.filter(call => call.method !== 'GET').length, 0);
  answer = Promise.reject(Object.assign(new Error('offline'), { isNetworkError: true }));
  await r.store.poll();
  assert.equal(r.store.getSnapshot().data.waiting[0].displayName, 'Bia');
  assert.equal(r.store.getSnapshot().error, 'stale');
});
test('contrato valida identidade mínima, FIFO, contagem e resposta da operação', () => {
  assert.equal(api.parseEntryState(body(), id(3)).waiting[0].displayName, 'Ana');
  assert.throws(() => api.parseEntryState({
    ...body(),
    pendingCall: { id: id(60), participationId: id(4), displayName: 'Ana', calledAt: at },
    canCall: false, canConfirm: true, canMarkAbsent: true, canRemove: true,
  }, id(3)), /Resposta inválida/);
  for (const patch of [{ waitingCount: 3 }, { observedAt: '2026-11-10' }, { waiting: [...body().waiting].reverse() },
    { waiting: [body().waiting[0], { ...body().waiting[1], participationId: id(4) }] }]) {
    assert.throws(() => api.parseEntryState({ ...body(), ...patch }, id(3)));
  }
  assert.throws(() => api.parseEntryResult({ eventId: id(3), externalQueueEnabled: true, releasedCount: 1, changedAt: at }, { kind: 'toggle', eventId: id(3), enabled: true }));
});
test('consulta autenticada, confirmação FIFO, atualização e reconhecimento explícito', async () => {
  const r = await rig(); assert.equal(r.calls[0].opts.auth, true);
  assert.equal((await r.store.mutate({ kind: 'confirm_call', callId: id(99) })).kind, 'blocked');
  assert.equal((await r.store.mutate({ kind: 'call' })).kind, 'confirmed');
  const sent = r.calls.find(c => c.method === 'POST');
  assert.equal(sent.opts.retryOnUnauthorized, false); assert.equal(sent.opts.outcomeUnknownOnNetworkError, true);
  assert.equal(sent.opts.headers['Idempotency-Key'], id(20));
  assert.equal(r.store.getSnapshot().data.waitingCount, 1);
  assert.equal((await r.store.mutate({ kind: 'call' })).kind, 'blocked');
  await r.store.acknowledge(id(20)); assert.equal(r.store.getSnapshot().pending, null);
});
test('desativar libera lista, reativar não recoloca liberados', async () => {
  const r = await rig(); await r.store.mutate({ kind: 'toggle', enabled: false });
  assert.equal(r.store.getSnapshot().pending.outcome.result.releasedCount, 2);
  await r.store.acknowledge(id(20)); await r.store.mutate({ kind: 'toggle', enabled: true });
  assert.equal(r.store.getSnapshot().data.externalQueueEnabled, true); assert.equal(r.store.getSnapshot().data.waitingCount, 0);
});
test('timeout e reinício com novo adaptador preservam dispatching sem outro POST', async () => {
  const r = await rig({ post: async () => { throw { isTimeout: true, outcomeUnknown: true }; } });
  assert.equal((await r.store.mutate({ kind: 'call' })).kind, 'uncertain');
  const restarted = r.make(r.persisted.reopen()); restarted.setContext(r.current); await restarted.refresh();
  assert.equal(restarted.getSnapshot().pending.phase, 'dispatching');
  assert.equal((await restarted.mutate({ kind: 'toggle', enabled: false })).kind, 'blocked');
  assert.equal(r.calls.filter(c => c.method === 'POST').length, 1);
});
for (const phase of ['reserved', 'dispatching']) for (const mode of ['before', 'after']) {
  test(`persistência ${phase} falha ${mode} sem envio`, async () => {
    const persisted = adapter(new Map(), { phase, mode }), r = await rig({ persisted });
    assert.equal((await r.store.mutate({ kind: 'call' })).kind, 'storage_error');
    assert.equal(r.calls.some(c => ['POST', 'PATCH'].includes(c.method)), false);
    assert.equal(r.store.getSnapshot().storageError, false, 'refresh recupera disponibilidade local');
    assert.equal(r.store.getSnapshot().feedback, 'storage', 'feedback histórico sobrevive à recuperação');
    await r.store.poll();
    await r.store.refresh();
    assert.equal(r.store.getSnapshot().feedback, 'storage');
    const pending = r.store.getSnapshot().pending;
    if (phase === 'reserved' && mode === 'before') {
      assert.equal(pending, null);
      persisted.fault.phase = null;
      assert.equal((await r.store.mutate({ kind: 'call' })).kind, 'confirmed');
      assert.equal(r.store.getSnapshot().feedback, 'confirmed');
      assert.equal(r.calls.find(c => c.method === 'POST').opts.headers['Idempotency-Key'], id(21));
    } else {
      assert.ok(pending);
      assert.equal((await r.store.mutate({ kind: 'call' })).kind, 'blocked');
    }
    if (phase === 'dispatching' && mode === 'after') assert.equal(pending.phase, 'dispatching');
    if (pending?.phase === 'reserved') { persisted.fault.phase = null; await r.store.cancelReserved(pending.key); assert.equal(r.store.getSnapshot().pending, null); }
    r.setContext({ ...context, sessionId: id(98), epoch: 2 });
    assert.equal(r.store.getSnapshot().feedback, null);
  });
}
for (const mode of ['before', 'after']) test(`confirmação não perdida em memória após falha ${mode} do recibo`, async () => {
  const persisted = adapter(new Map(), { phase: 'terminal', mode }), r = await rig({ persisted });
  await r.store.mutate({ kind: 'call' });
  assert.equal(r.store.getSnapshot().knownOutcome.kind, 'confirmed');
  assert.equal(r.store.getSnapshot().pending.phase, mode === 'before' ? 'dispatching' : 'terminal');
  assert.equal((await r.store.mutate({ kind: 'toggle', enabled: false })).kind, 'blocked');
});
test('recibo atrasado A não reconhece B; gravação de reconhecimento pode ser repetida sem mutação', async () => {
  const r = await rig(); await r.store.mutate({ kind: 'call' });
  r.persisted.fault.phase = 'acknowledged'; r.persisted.fault.mode = 'before';
  await r.store.acknowledge(id(20)); assert.equal(r.store.getSnapshot().pending.phase, 'terminal');
  r.persisted.fault.mode = 'after'; await r.store.acknowledge(id(20)); assert.equal(r.store.getSnapshot().pending, null);
  r.persisted.fault.phase = null; await r.store.mutate({ kind: 'toggle', enabled:false });
  assert.equal((await r.store.acknowledge(id(20))).kind, 'blocked'); assert.equal(r.store.getSnapshot().pending.key, id(21));
  assert.equal(r.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(r.calls.filter(c => c.method === 'PATCH').length, 1);
});
test('dois coordenadores compartilham reserva e bloqueiam segundo envio durante POST pendente', async () => {
  const pending = defer(), entered = defer(), r = await rig({ post: async () => { entered.resolve(); return pending.promise; } });
  const other = r.make(r.persisted.storage); other.setContext(r.current); await other.refresh();
  const first = r.store.mutate({ kind: 'call' }); await entered.promise;
  assert.equal((await other.mutate({ kind: 'toggle', enabled: false })).kind, 'blocked');
  pending.resolve(callResult()); await first;
  assert.equal(r.calls.filter(c => c.method === 'POST').length, 1); assert.equal(r.calls.some(c => c.method === 'PATCH'), false);
});
test('logout ou troca de evento descarta resultado antigo mas preserva recibo original', async () => {
  const pending = defer(), entered = defer(), r = await rig({ post: async () => { entered.resolve(); return pending.promise; } });
  const work = r.store.mutate({ kind: 'call' }); await entered.promise;
  r.setContext(null); pending.resolve(callResult());
  assert.equal((await work).kind, 'stale'); assert.equal(r.store.getSnapshot().data, null);
  assert.equal((await r.persisted.storage.get(context.userId)).phase, 'terminal');
  r.setContext({ ...context, sessionId: id(99), epoch: 2 }); await r.store.refresh();
  assert.equal((await r.store.mutate({ kind: 'toggle', enabled: false })).kind, 'blocked');
});
test('falha de leitura segura bloqueia alterações; erro de rede limpa lista', async () => {
  const persisted = adapter(new Map(), { read: true }), r = await rig({ persisted });
  assert.equal(r.store.getSnapshot().storageError, true); assert.equal((await r.store.mutate({ kind: 'toggle', enabled: false })).kind, 'blocked');
  r.client.get = async () => { throw { isNetworkError: true }; }; await r.store.refresh();
  assert.equal(r.store.getSnapshot().data, null); assert.equal(r.store.getSnapshot().error, 'network');
});
test('respostas de consulta fora de ordem e de outro evento não reaparecem', async () => {
  const r = await rig(), requests = [];
  let entered = defer();
  r.client.get = () => { const request = defer(); requests.push(request); entered.resolve(); return request.promise; };
  const older = r.store.refresh(); await entered.promise;
  entered = defer(); const newer = r.store.refresh(); await entered.promise;
  requests[1].resolve({ ...body(), canCall:false, waitingCount: 0, waiting: [] }); await newer;
  requests[0].resolve(body()); await older; assert.equal(r.store.getSnapshot().data.waitingCount, 0);
  entered = defer(); const previousEvent = r.store.refresh(); await entered.promise;
  r.setContext({ ...context, eventId: id(88) }); requests[2].resolve(body()); await previousEvent;
  assert.equal(r.store.getSnapshot().data, null);
});
test('marcação de reconhecimento pendente impede nova reserva e confirmação concorrente', async () => {
  const r = await rig(); await r.store.mutate({ kind: 'call' });
  const pending = defer(), entered = defer();
  Object.assign(r.persisted.fault, { phase: 'acknowledged', pending: pending.promise, entered: entered.resolve });
  const ack = r.store.acknowledge(id(20)); await entered.promise;
  assert.equal((await r.store.mutate({ kind: 'toggle', enabled: false })).kind, 'blocked');
  assert.equal((await r.store.acknowledge(id(20))).kind, 'blocked');
  pending.resolve(); await ack;
  assert.equal(r.store.getSnapshot().pending, null); assert.equal(r.calls.filter(c => c.method === 'POST').length, 1);
});
for (const [status, code, phase] of [[401, 'SESSION_REVOKED', 'terminal'], [403, 'STAFF_EVENT_FORBIDDEN', 'terminal'],
  [404, 'RESOURCE_NOT_FOUND', 'terminal'], [409, 'ENTRY_NOT_FIRST', 'terminal'], [409, 'IDEMPOTENCY_IN_PROGRESS', 'dispatching'], [500, 'INTERNAL_SERVER_ERROR', 'dispatching']]) {
  test(`erro HTTP ${status} ${code} preserva classificação segura`, async () => {
    const r = await rig({ post: async () => { throw { status, code }; } }); await r.store.mutate({ kind: 'call' });
    assert.equal(r.store.getSnapshot().pending.phase, phase); assert.equal(r.calls.filter(c => c.method === 'POST').length, 1);
  });
}

for (const kind of ['confirm_call','absent','remove']) test(`resolução externa ${kind} usa callId e persiste recibo sem acionar rota legada`, async () => {
  const persisted=adapter(), calls=[];
  const state={...body(),pendingCall:{id:id(60),participationId:id(6),displayName:'Dora',calledAt:at},
    canCall:false,canConfirm:true,canMarkAbsent:true,canRemove:true};
  const status={confirm_call:'active',absent:'waiting',remove:'canceled'}[kind];
  const client={get:async()=>state,post:async(path,payload,options)=>{
    calls.push({path,payload,options});
    assert.equal((await persisted.storage.get(context.userId)).phase,'dispatching');
    return {eventId:context.eventId,call:{id:id(60),participationId:id(6),status:{confirm_call:'confirmed',absent:'absent',remove:'removed'}[kind],
      calledAt:at,resolvedAt:at},participation:{id:id(6),status,arenaEnteredAt:kind==='confirm_call'?at:null,
      finishReason:kind==='remove'?'staff_external_wait_removed':null,externalQueueOrder:'3'},requeued:kind==='absent'};
  }};
  const store=api.createStaffEntryStore({client,storage:persisted.storage,getContext:()=>context,createKey:()=>id(20)});
  store.setContext(context);await store.refresh();
  assert.equal((await store.mutate({kind:'call'})).kind,'blocked');
  assert.equal((await store.mutate({kind,callId:id(99)})).kind,'blocked');
  const results=await Promise.all([store.mutate({kind,callId:id(60)}),store.mutate({kind,callId:id(60)})]);
  assert.equal(results[0].kind,'confirmed');assert.equal(calls.length,1);
  assert.ok(calls[0].path.endsWith(`/calls/${id(60)}/${kind==='confirm_call'?'confirm':kind}`));
  await store.refresh();assert.equal(calls.length,1);
  const reloaded=persisted.reopen();assert.equal((await reloaded.get(context.userId)).phase,'terminal');
});

test('intenção confirm legada dispatching sobrevive sem conversão nem POST novo',async()=>{
  const persisted=adapter();const old={...context,key:id(20),kind:'confirm',participationId:id(4),enabled:null,phase:'reserved'};
  await persisted.storage.reserve(old);await persisted.storage.dispatch(old);
  const r=await rig({persisted});assert.equal(r.store.getSnapshot().pending.kind,'confirm');
  assert.equal((await r.store.mutate({kind:'call'})).kind,'blocked');assert.equal(r.calls.some(c=>c.method==='POST'),false);
});

test('R3-02: negativa 403/404 ou 401 em GET anterior não é descartada por refresh manual concorrente que falha com 500, em qualquer ordem, e respeita escopo', async () => {
  async function startRead(r, method) {
    const request = defer(), started = defer();
    r.client.get = (path) => {
      started.resolve(path);
      return request.promise;
    };
    const done = r.store[method]();
    const path = await Promise.race([
      started.promise,
      done.then(() => assert.fail(`${method} terminou sem consultar o Controle de Entrada`)),
    ]);
    assert.equal(path, `/staff/events/${r.current.eventId}/entry-control`);
    return { reject: request.reject, done };
  }

  // Cenário 1: GET A (poll ou refresh) pendente -> refresh manual inicia GET B -> GET A retorna 403 -> GET B retorna 500
  {
    const r = await rig();
    assert.equal(r.store.getSnapshot().status, 'ready');

    const getA = await startRead(r, 'poll');
    const getB = await startRead(r, 'refresh');

    getA.reject({ status: 403, code: 'STAFF_EVENT_FORBIDDEN' });
    await getA.done;
    assert.equal(r.store.getSnapshot().status, 'error');
    assert.equal(r.store.getSnapshot().error, 'denied');
    assert.equal(r.store.getSnapshot().data, null);

    getB.reject({ status: 500, code: 'INTERNAL_SERVER_ERROR' });
    await getB.done;
    assert.equal(r.store.getSnapshot().status, 'error');
    assert.equal(r.store.getSnapshot().error, 'denied');
    assert.equal(r.store.getSnapshot().data, null);
  }

  // Cenário 2 (ordem inversa): GET B retorna 500 primeiro -> GET A retorna 404 depois
  {
    const r = await rig();
    const getA = await startRead(r, 'refresh');
    const getB = await startRead(r, 'refresh');

    getB.reject({ status: 500, code: 'INTERNAL_SERVER_ERROR' });
    await getB.done;
    assert.equal(r.store.getSnapshot().error, 'unavailable');

    getA.reject({ status: 404, code: 'RESOURCE_NOT_FOUND' });
    await getA.done;
    assert.equal(r.store.getSnapshot().status, 'error');
    assert.equal(r.store.getSnapshot().error, 'denied');
    assert.equal(r.store.getSnapshot().data, null);
  }

  // Cenário 3: GET A retorna 401 (session) e GET B retorna 500 -> preserva session; troca de evento/logout descarta 403 antigo
  {
    const r = await rig();
    const getA = await startRead(r, 'refresh');
    const getB = await startRead(r, 'refresh');
    getA.reject({ status: 401, code: 'SESSION_REVOKED' });
    await getA.done;
    getB.reject({ status: 500, code: 'INTERNAL_SERVER_ERROR' });
    await getB.done;
    assert.equal(r.store.getSnapshot().error, 'session');

    // Agora testa troca de evento e logout descartando 403 do escopo antigo
    const oldEventReq = await startRead(r, 'refresh');
    r.setContext({ ...context, eventId: id(91) });
    oldEventReq.reject({ status: 403, code: 'STAFF_EVENT_FORBIDDEN' });
    await oldEventReq.done;
    assert.equal(r.store.getSnapshot().error, null);

    const logoutReq = await startRead(r, 'refresh');
    r.setContext(null);
    logoutReq.reject({ status: 403, code: 'STAFF_EVENT_FORBIDDEN' });
    await logoutReq.done;
    assert.equal(r.store.getSnapshot().status, 'idle');
    assert.equal(r.store.getSnapshot().error, null);
  }
});

test('STAFF-04: poll recupera automaticamente após falha inicial transitória (rede/timeout/503/inválida) preservando intenção persistida e respeitando 401/403', async () => {
  const persisted = adapter();
  const dispatchingIntent = {
    ...context,
    key: id(77),
    kind: 'call',
    participationId: null,
    callId: null,
    enabled: null,
    phase: 'reserved',
  };
  await persisted.storage.reserve(dispatchingIntent);
  await persisted.storage.dispatch(dispatchingIntent);

  let mode = 'timeout';
  const calls = [];
  const client = {
    get: async (path, opts) => {
      calls.push({ method: 'GET', path, opts });
      if (mode === 'timeout') throw Object.assign(new Error('timeout'), { isTimeout: true });
      if (mode === '503') throw Object.assign(new Error('unavailable'), { status: 503 });
      if (mode === 'malformed') return { eventId: context.eventId, waitingCount: 5, waiting: [] };
      if (mode === '403') throw Object.assign(new Error('forbidden'), { status: 403 });
      return body();
    },
    post: async () => { calls.push({ method: 'POST' }); return callResult(); },
    patch: async () => { calls.push({ method: 'PATCH' }); return {}; },
  };
  const store = api.createStaffEntryStore({
    client,
    storage: persisted.storage,
    getContext: () => context,
    createKey: () => id(78),
  });
  store.setContext(context);
  await store.refresh();
  assert.equal(store.getSnapshot().status, 'error');
  assert.equal(store.getSnapshot().error, 'network');
  assert.equal(store.getSnapshot().data, null);

  // 503 e payload malformado no poll mantêm status error sem fabricar fila vazia
  mode = '503';
  await store.poll();
  assert.equal(store.getSnapshot().status, 'error');
  assert.equal(store.getSnapshot().error, 'unavailable');
  assert.equal(store.getSnapshot().data, null);

  mode = 'malformed';
  await store.poll();
  assert.equal(store.getSnapshot().status, 'error');
  assert.equal(store.getSnapshot().error, 'unavailable');
  assert.equal(store.getSnapshot().data, null);

  // Recuperação por GET carrega estado oficial e preserva a intenção dispatching do SecureStore bloqueando mutações
  mode = 'ok';
  await store.poll();
  assert.equal(store.getSnapshot().status, 'ready');
  assert.equal(store.getSnapshot().error, null);
  assert.equal(store.getSnapshot().data.waitingCount, 2);
  assert.equal(store.getSnapshot().pending?.phase, 'dispatching');
  assert.equal((await store.mutate({ kind: 'call' })).kind, 'blocked');
  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0, 'nenhuma mutação automática enviada na recuperação');

  // 403 no poll limpa dados nominais, bloqueia novas tentativas de poll e preserva SecureStore
  mode = '403';
  await store.poll();
  const getsAfter403 = calls.length;
  assert.equal(store.getSnapshot().status, 'error');
  assert.equal(store.getSnapshot().error, 'denied');
  assert.equal(store.getSnapshot().data, null);
  await store.poll();
  assert.equal(calls.length, getsAfter403, 'poll não volta a consultar após 403');
  assert.equal((await persisted.storage.get(context.userId)).phase, 'dispatching');
});

test('STAFF-04: falha de armazenamento ao gravar recusa definitiva preserva knownOutcome rejected sem reenviar mutação', async () => {
  const persisted = adapter(new Map(), { phase: 'terminal', mode: 'before' });
  const r = await rig({
    persisted,
    post: async () => { throw { status: 409, code: 'ENTRY_NOT_FIRST' }; },
  });
  const outcome = await r.store.mutate({ kind: 'call' });
  assert.equal(outcome.kind, 'storage_error');
  assert.equal(r.store.getSnapshot().knownOutcome?.kind, 'rejected');
  assert.equal(r.store.getSnapshot().knownOutcome?.code, 'ENTRY_NOT_FIRST');
  assert.equal(r.store.getSnapshot().pending?.phase, 'dispatching');
  assert.equal((await r.store.mutate({ kind: 'call' })).kind, 'blocked');
  assert.equal(r.calls.filter((c) => c.method === 'POST').length, 1);
});

for (const [httpStatus, code, expectedError] of [
  [403, 'STAFF_EVENT_FORBIDDEN', 'denied'],
  [401, 'SESSION_REVOKED', 'session'],
]) {
  test(`STAFF04-AUD-04: ${httpStatus} em mutação do Controle de Entrada trava acesso de imediato, ignora GET 200 atrasado e 503 posterior, preserva recibo e respeita troca de conta`, async () => {
    const persisted = adapter();
    let getMode = 'ok';
    let delayedPoll = null;
    const calls = [];
    const client = {
      get: async (path, opts) => {
        calls.push({ method: 'GET', path, opts });
        if (getMode === 'deferred') {
          delayedPoll = defer();
          return delayedPoll.promise;
        }
        if (getMode === '503') throw Object.assign(new Error('unavailable'), { status: 503 });
        return body();
      },
      post: async (path, payload, opts) => {
        calls.push({ method: 'POST', path, payload, opts });
        throw Object.assign(new Error('auth-denied'), { status: httpStatus, code });
      },
      patch: async (path, payload, opts) => {
        calls.push({ method: 'PATCH', path, payload, opts });
        return { eventId: context.eventId, externalQueueEnabled: payload.enabled, releasedCount: 0, changedAt: at };
      },
    };
    let current = { ...context };
    const store = api.createStaffEntryStore({
      client,
      storage: persisted.storage,
      getContext: () => current,
      createKey: () => id(95),
    });
    store.setContext(current);
    await store.refresh();
    assert.equal(store.getSnapshot().status, 'ready');
    assert.equal(store.getSnapshot().data.waiting[0].displayName, 'Ana');

    // Dispara poll lento seguido de mutação que falha com 401/403
    getMode = 'deferred';
    const pendingPoll = store.poll();
    const outcome = await store.mutate({ kind: 'call' });
    assert.equal(outcome.kind, 'rejected');
    assert.equal(outcome.status, httpStatus);
    assert.equal(store.getSnapshot().status, 'error');
    assert.equal(store.getSnapshot().error, expectedError);
    assert.equal(store.getSnapshot().data, null, 'dados nominais removidos imediatamente sem depender de GET posterior');
    assert.equal(store.getSnapshot().pending?.phase, 'terminal');
    assert.equal((await persisted.storage.get(context.userId)).key, id(95));

    // GET 200 atrasado (iniciado antes da negativa) nunca restaura acesso nem dados nominais
    delayedPoll.resolve(body());
    await pendingPoll;
    assert.equal(store.getSnapshot().status, 'error');
    assert.equal(store.getSnapshot().error, expectedError);
    assert.equal(store.getSnapshot().data, null);

    // Polling automático permanece bloqueado (0 GETs extras); refresh manual com 503 mantém a trava
    const getsAfterRevoke = calls.filter((c) => c.method === 'GET').length;
    await store.poll();
    assert.equal(calls.filter((c) => c.method === 'GET').length, getsAfterRevoke);

    getMode = '503';
    await store.refresh();
    assert.equal(store.getSnapshot().status, 'error');
    assert.equal(store.getSnapshot().error, expectedError);
    assert.equal(store.getSnapshot().data, null);
    const getsAfterManual503 = calls.filter((c) => c.method === 'GET').length;
    await store.poll();
    assert.equal(calls.filter((c) => c.method === 'GET').length, getsAfterManual503);

    // Reconhecimento local limpa recibo mantendo o bloqueio até revalidação legítima ou troca de conta
    await store.acknowledge(id(95));
    assert.equal(store.getSnapshot().status, 'error');
    assert.equal(store.getSnapshot().error, expectedError);
    assert.equal((await store.mutate({ kind: 'call' })).kind, 'blocked');

    // Revalidação manual legítima 200 restaura o acesso
    getMode = 'ok';
    await store.refresh();
    assert.equal(store.getSnapshot().status, 'ready');
    assert.equal(store.getSnapshot().error, null);
    assert.equal(store.getSnapshot().data.waiting[0].displayName, 'Ana');

    // Troca de conta limpa estado/trava anterior e não vaza acesso da conta antiga
    current = { ...context, userId: id(99), sessionId: id(98), epoch: 2, revision: 1 };
    store.setContext(current);
    await store.refresh();
    assert.equal(store.getSnapshot().status, 'ready');
    assert.equal(store.getSnapshot().error, null);
  });
}

test('STAFF04-AUD-04: 403 em mutação com falha SecureStore mantém acesso bloqueado, dispatching intacto e knownOutcome', async () => {
  const persisted = adapter(new Map(), { phase: 'terminal', mode: 'before' });
  const r = await rig({
    persisted,
    post: async () => { throw Object.assign(new Error('forbidden'), { status: 403, code: 'STAFF_EVENT_FORBIDDEN' }); },
  });
  const outcome = await r.store.mutate({ kind: 'call' });
  assert.equal(outcome.kind, 'storage_error');
  assert.equal(r.store.getSnapshot().status, 'error');
  assert.equal(r.store.getSnapshot().error, 'denied');
  assert.equal(r.store.getSnapshot().data, null);
  assert.equal(r.store.getSnapshot().pending?.phase, 'dispatching');
  assert.equal(r.store.getSnapshot().pending?.key, id(20));
  assert.equal(r.store.getSnapshot().knownOutcome?.kind, 'rejected');
  assert.equal(r.store.getSnapshot().knownOutcome?.status, 403);
  const getsBefore = r.calls.filter((c) => c.method === 'GET').length;
  await r.store.poll();
  assert.equal(r.calls.filter((c) => c.method === 'GET').length, getsBefore);
  assert.equal((await r.store.mutate({ kind: 'call' })).kind, 'blocked');
});

test('STAFF04-AUD-04: 404 RESOURCE_NOT_FOUND na resolução de chamada mantém evento válido com GET 200 e só revoga se GET contextual confirmar 403/404', async () => {
  const activeCall = { id: id(60), participationId: id(4), displayName: 'Ana', calledAt: at };
  const stateWithCall = {
    ...body(),
    pendingCall: activeCall,
    waitingCount: 1,
    waiting: [{ participationId: id(5), displayName: 'Bia', position: 1 }],
    canCall: false,
    canConfirm: true,
    canMarkAbsent: true,
    canRemove: true,
  };
  const resolvedState = { ...body(), pendingCall: null, waitingCount: 0, waiting: [], canCall: false };
  const makeScenario = (scenarioContext, persisted) => {
    const scenario = { getMode: 'initial', modeAfterPost: 'resolved_200', posts: [] };
    const client = {
      get: async () => {
        if (scenario.getMode === 'forbidden_403') {
          throw Object.assign(new Error('forbidden'), { status: 403, code: 'STAFF_EVENT_FORBIDDEN' });
        }
        if (scenario.getMode === 'missing_404') {
          throw Object.assign(new Error('event missing'), { status: 404, code: 'RESOURCE_NOT_FOUND' });
        }
        return scenario.getMode === 'resolved_200' ? resolvedState : stateWithCall;
      },
      post: async (path, payload, options) => {
        scenario.posts.push({ path, payload, options });
        scenario.getMode = scenario.modeAfterPost;
        throw Object.assign(new Error('not found'), { status: 404, code: 'RESOURCE_NOT_FOUND' });
      },
    };
    return {
      scenario,
      store: api.createStaffEntryStore({
        client,
        storage: persisted.storage,
        getContext: () => scenarioContext,
        createKey: (() => { let nextKey = scenarioContext === context ? 30 : 32; return () => id(nextKey++); })(),
      }),
      persisted,
    };
  };

  const persisted = adapter();
  const first = makeScenario(context, persisted);
  first.store.setContext(context);
  await first.store.refresh();
  const initial = first.store.getSnapshot();
  assert.equal(initial.status, 'ready');
  assert.equal(initial.error, null);
  assert.equal(initial.data.pendingCall.id, activeCall.id);
  assert.equal(initial.data.pendingCall.participationId, activeCall.participationId);
  assert.equal(initial.data.waiting.some((row) => row.participationId === activeCall.participationId), false);
  assert.equal(initial.data.waitingCount, 1);
  assert.deepEqual(initial.data.waiting.map((row) => row.position), [1]);
  assert.equal(initial.data.canConfirm, true);

  // Caso A: POST 404 seguido da revalidação contextual GET 200.
  first.scenario.modeAfterPost = 'resolved_200';
  const resValid = await first.store.mutate({ kind: 'confirm_call', callId: activeCall.id });
  assert.equal(resValid.kind, 'rejected');
  assert.equal(resValid.status, 404);
  assert.equal(first.scenario.posts.length, 1);
  assert.equal(first.scenario.posts[0].options.headers['Idempotency-Key'], id(30));
  const pendingA = first.store.getSnapshot().pending;
  assert.equal(pendingA.phase, 'terminal');
  assert.equal(pendingA.outcome.kind, 'rejected');
  assert.equal(pendingA.outcome.status, 404);
  assert.equal(pendingA.outcome.code, 'RESOURCE_NOT_FOUND');
  const persistedA = await persisted.storage.get(context.userId);
  assert.equal(persistedA.phase, 'terminal');
  assert.equal(persistedA.key, id(30));
  assert.deepEqual(persistedA.outcome, pendingA.outcome);
  assert.equal(first.store.getSnapshot().status, 'ready');
  assert.equal(first.store.getSnapshot().error, null);
  assert.deepEqual(first.store.getSnapshot().data, api.parseEntryState(resolvedState, context.eventId));

  // O primeiro recibo é reconhecido antes de uma nova intenção com chave distinta.
  assert.equal((await first.store.acknowledge(id(30))).kind, 'done');
  assert.equal((await persisted.storage.get(context.userId)).phase, 'acknowledged');
  first.scenario.getMode = 'initial';
  await first.store.refresh();
  assert.equal(first.store.getSnapshot().status, 'ready');
  assert.equal(first.store.getSnapshot().data.canConfirm, true);

  // Caso B: segundo POST 404 seguido de GET 403 bloqueia o contexto sem perder o recibo.
  first.scenario.modeAfterPost = 'forbidden_403';
  const resForbidden = await first.store.mutate({ kind: 'confirm_call', callId: activeCall.id });
  assert.equal(resForbidden.kind, 'rejected');
  assert.equal(resForbidden.status, 404);
  assert.equal(first.scenario.posts.length, 2);
  assert.equal(first.scenario.posts[1].options.headers['Idempotency-Key'], id(31));
  const pendingB = first.store.getSnapshot().pending;
  assert.equal(pendingB.key, id(31));
  assert.equal(pendingB.phase, 'terminal');
  assert.equal(pendingB.outcome.code, 'RESOURCE_NOT_FOUND');
  const persistedB = await persisted.storage.get(context.userId);
  assert.equal(persistedB.key, id(31));
  assert.equal(persistedB.phase, 'terminal');
  assert.equal(persistedB.outcome.status, 404);
  assert.equal(first.store.getSnapshot().status, 'error');
  assert.equal(first.store.getSnapshot().error, 'denied');
  assert.equal(first.store.getSnapshot().data, null);
  assert.equal((await first.store.mutate({ kind: 'confirm_call', callId: activeCall.id })).kind, 'blocked');

  // Caso C: fixture independente, POST 404 seguido de GET 404 contextual também bloqueia com segurança.
  const context404 = { ...context, sessionId: id(10) };
  const third = makeScenario(context404, adapter());
  third.store.setContext(context404);
  await third.store.refresh();
  assert.equal(third.store.getSnapshot().status, 'ready');
  third.scenario.modeAfterPost = 'missing_404';
  const resMissing = await third.store.mutate({ kind: 'confirm_call', callId: activeCall.id });
  assert.equal(resMissing.kind, 'rejected');
  assert.equal(resMissing.status, 404);
  assert.equal(third.scenario.posts.length, 1);
  assert.equal(third.scenario.posts[0].options.headers['Idempotency-Key'], id(32));
  const persistedC = await third.persisted.storage.get(context404.userId);
  assert.equal(persistedC.phase, 'terminal');
  assert.equal(persistedC.outcome.code, 'RESOURCE_NOT_FOUND');
  assert.equal(third.store.getSnapshot().status, 'error');
  assert.equal(third.store.getSnapshot().error, 'denied');
  assert.equal(third.store.getSnapshot().data, null);
  assert.equal((await third.store.mutate({ kind: 'confirm_call', callId: activeCall.id })).kind, 'blocked');
});
test('STAFF04-AUD-04 e AUD-03 (store): GET 401/403 concorrente durante reserve/dispatch bloqueia POST, isola busyKind por contexto e grava finish lento', async () => {
  // 1. Troca de contexto enquanto acknowledge está em voo não limpa busyKind do novo contexto
  {
    const slotA = new Map();
    const slotB = new Map();
    const ackDeferred = defer();
    const reserveBDeferred = defer();
    const ackStarted = defer();
    const makeIndependentStorage = () => ({
      isPersistent: true,
      async get(user) { return (user === context.userId ? slotA : slotB).get(user) ?? null; },
      async reserve(intent) {
        const m = intent.userId === context.userId ? slotA : slotB;
        if (intent.userId !== context.userId) await reserveBDeferred.promise;
        m.set(intent.userId, intent);
        return { created: true, intent };
      },
      async dispatch(intent) {
        const m = intent.userId === context.userId ? slotA : slotB;
        m.set(intent.userId, { ...intent, phase: 'dispatching' });
        return true;
      },
      async finish(intent, outcome) {
        const m = intent.userId === context.userId ? slotA : slotB;
        m.set(intent.userId, { ...intent, phase: 'terminal', outcome });
        return true;
      },
      async acknowledge(intent) {
        ackStarted.resolve();
        await ackDeferred.promise;
        const m = intent.userId === context.userId ? slotA : slotB;
        m.set(intent.userId, { ...intent, phase: 'acknowledged' });
        return true;
      },
      async cancelReserved(intent) {
        const m = intent.userId === context.userId ? slotA : slotB;
        m.set(intent.userId, { ...intent, phase: 'cancelled' });
        return true;
      },
    });
    const ctxA = { ...context };
    const ctxB = { ...context, userId: id(99), sessionId: id(98), eventId: id(88), epoch: 2, revision: 1 };
    let cur = ctxA;
    slotA.set(ctxA.userId, { ...ctxA, key: id(21), kind: 'call', participationId: null, callId: null, enabled: null, phase: 'terminal', outcome: { kind: 'confirmed', result: callResult() } });
    const store = api.createStaffEntryStore({
      client: {
        get: async () => ({ ...body(), eventId: cur.eventId }),
        post: async () => callResult(),
        patch: async () => ({ eventId: cur.eventId, externalQueueEnabled: true, releasedCount: 0, changedAt: at }),
      },
      storage: makeIndependentStorage(),
      getContext: () => cur,
      createKey: () => id(40),
    });
    store.setContext(ctxA);
    await store.refresh();
    const oldAck = store.acknowledge(id(21));
    await ackStarted.promise;
    assert.equal(store.getSnapshot().busyKind, 'acknowledging');

    cur = ctxB;
    store.setContext(ctxB);
    await store.refresh();
    assert.equal(store.getSnapshot().busy, false);
    assert.equal(store.getSnapshot().busyKind, null);

    const newMutate = store.mutate({ kind: 'call' });
    assert.equal(store.getSnapshot().busy, true);
    assert.equal(store.getSnapshot().busyKind, 'preparing');

    // Reconhecimento antigo finaliza sem limpar busyKind do contexto B
    ackDeferred.resolve();
    await oldAck;
    assert.equal(store.getSnapshot().busy, true);
    assert.equal(store.getSnapshot().busyKind, 'preparing');

    reserveBDeferred.resolve();
    await newMutate;
    assert.equal(store.getSnapshot().busy, false);
    assert.equal(store.getSnapshot().busyKind, null);
  }

  // 2. GET 403/401 concorrente durante reserve() cancela APENAS reserved e não dispara dispatch() nem POST
  for (const [httpStatus, expectedError] of [[403, 'denied'], [401, 'session']]) {
    const reserveGate = defer();
    let dispatchCalls = 0;
    let postCalls = 0;
    const saved = new Map();
    const baseStorage = {
      isPersistent: true,
      async get(user) { return saved.get(user) ?? null; },
      async reserve(intent) {
        await reserveGate.promise;
        saved.set(intent.userId, intent);
        return { created: true, intent };
      },
      async dispatch(intent) {
        dispatchCalls += 1;
        saved.set(intent.userId, { ...intent, phase: 'dispatching' });
        return true;
      },
      async finish() {},
      async acknowledge() {},
      async cancelReserved(intent) {
        saved.set(intent.userId, { ...intent, phase: 'cancelled' });
        return true;
      },
    };
    let pollGate = null;
    const store = api.createStaffEntryStore({
      client: {
        get: async () => (pollGate ? pollGate.promise : body()),
        post: async () => { postCalls += 1; return callResult(); },
        patch: async () => ({}),
      },
      storage: baseStorage,
      getContext: () => context,
      createKey: () => id(55),
    });
    store.setContext(context);
    await store.refresh();

    pollGate = defer();
    const pPoll = store.poll();
    const pMutate = store.mutate({ kind: 'call' });
    pollGate.reject(Object.assign(new Error('auth-lost'), { status: httpStatus }));
    await pPoll;
    assert.equal(store.getSnapshot().status, 'error');
    assert.equal(store.getSnapshot().error, expectedError);
    assert.equal(store.getSnapshot().data, null);

    reserveGate.resolve();
    const outcome = await pMutate;
    assert.equal(outcome.kind, 'rejected');
    assert.equal(outcome.status, httpStatus);
    assert.equal(dispatchCalls, 0);
    assert.equal(postCalls, 0);
    assert.equal(saved.get(context.userId).phase, 'cancelled');
  }

  // 3. GET 403 concorrente durante dispatch() preserva dispatching de forma conservadora e aborta POST
  {
    const dispatchGate = defer();
    let postCalls = 0;
    const saved = new Map();
    const baseStorage = {
      isPersistent: true,
      async get(user) { return saved.get(user) ?? null; },
      async reserve(intent) {
        saved.set(intent.userId, intent);
        return { created: true, intent };
      },
      async dispatch(intent) {
        saved.set(intent.userId, { ...intent, phase: 'dispatching' });
        await dispatchGate.promise;
        return true;
      },
      async finish() {},
      async acknowledge() {},
      async cancelReserved() { return false; },
    };
    let pollGate = null;
    const store = api.createStaffEntryStore({
      client: {
        get: async () => (pollGate ? pollGate.promise : body()),
        post: async () => { postCalls += 1; return callResult(); },
        patch: async () => ({}),
      },
      storage: baseStorage,
      getContext: () => context,
      createKey: () => id(56),
    });
    store.setContext(context);
    await store.refresh();

    pollGate = defer();
    const pPoll = store.poll();
    const pMutate = store.mutate({ kind: 'call' });
    await Promise.resolve();
    await Promise.resolve();
    pollGate.reject(Object.assign(new Error('forbidden'), { status: 403 }));
    await pPoll;

    dispatchGate.resolve();
    await pMutate;
    assert.equal(postCalls, 0);
    assert.equal(saved.get(context.userId).phase, 'dispatching');
    assert.equal(store.getSnapshot().status, 'error');
    assert.equal(store.getSnapshot().error, 'denied');
  }
});

test('STAFF04-AUD-10 (store Entrada): busyKind transita para persisting em storage.finish de confirmação ou 409, mas limpa imediatamente em 401/403 e nunca aparece em uncertain', async () => {
  for (const scenario of ['confirmed', 'rejected_409', 'auth_403', 'uncertain']) {
    const finishGate = defer();
    const seenBusyKinds = [];
    const saved = new Map();
    const customStorage = {
      isPersistent: true,
      async get(user) { return saved.get(user) ?? null; },
      async reserve(intent) { saved.set(intent.userId, intent); return { created: true, intent }; },
      async dispatch(intent) { saved.set(intent.userId, { ...intent, phase: 'dispatching' }); return true; },
      async finish(intent, outcome) {
        await finishGate.promise;
        saved.set(intent.userId, { ...intent, phase: 'terminal', outcome });
        return true;
      },
      async acknowledge() { return true; },
      async cancelReserved() { return true; },
    };
    const store = api.createStaffEntryStore({
      client: {
        get: async () => body(),
        post: async () => {
          if (scenario === 'confirmed') return callResult();
          if (scenario === 'rejected_409') throw Object.assign(new Error('409'), { status: 409, code: 'ENTRY_NOT_FIRST' });
          if (scenario === 'auth_403') throw Object.assign(new Error('403'), { status: 403, code: 'STAFF_EVENT_FORBIDDEN' });
          throw Object.assign(new Error('timeout'), { isTimeout: true });
        },
        patch: async () => ({}),
      },
      storage: customStorage,
      getContext: () => context,
      createKey: () => id(70),
    });
    store.subscribe((snap) => {
      if (snap.busy && snap.busyKind && seenBusyKinds[seenBusyKinds.length - 1] !== snap.busyKind) {
        seenBusyKinds.push(snap.busyKind);
      }
    });
    store.setContext(context);
    await store.refresh();

    const pMutate = store.mutate({ kind: 'call' });
    await new Promise((r) => setTimeout(r, 10));

    if (scenario === 'confirmed' || scenario === 'rejected_409') {
      assert.equal(store.getSnapshot().busy, true);
      assert.equal(store.getSnapshot().busyKind, 'persisting');
      assert.deepEqual(seenBusyKinds, ['preparing', 'dispatching', 'mutating', 'persisting']);
    } else if (scenario === 'auth_403') {
      assert.equal(store.getSnapshot().busy, false, '403 prioriza bloqueio imediato sem manter busy visível');
      assert.equal(store.getSnapshot().busyKind, null);
      assert.equal(store.getSnapshot().data, null);
      assert.equal(seenBusyKinds.includes('persisting'), false);
    } else {
      assert.equal(seenBusyKinds.includes('persisting'), false);
    }
    finishGate.resolve();
    await pMutate;
  }
});
