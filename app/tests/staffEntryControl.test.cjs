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
    await r.store.mutate({ kind: 'call' });
    assert.equal(r.calls.some(c => c.method === 'POST'), false);
    const pending = r.store.getSnapshot().pending;
    if (phase === 'dispatching' && mode === 'after') assert.equal(pending.phase, 'dispatching');
    if (pending?.phase === 'reserved') { persisted.fault.phase = null; await r.store.cancelReserved(pending.key); assert.equal(r.store.getSnapshot().pending, null); }
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
