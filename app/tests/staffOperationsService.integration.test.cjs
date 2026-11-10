const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');
const service = import(pathToFileURL(path.join(__dirname, '..', 'services', 'staffOperationsService.js')).href);
const userId = '20000000-0000-4000-8000-000000000001';
const eventId = 'e10da075-c6cb-4fd6-ba97-7b52403ebff8';
const experienceId = '63c7bb39-618d-4859-a851-f0ef7cbeaa6b';
const stationId = '892e9f40-d56a-464b-a6d4-aac44cbbb1fd';
const entryId = '6692c3ea-3335-4807-a1db-c97e83643d5a';
const sessionId = 'd87bacf1-4e38-4528-9f5a-f02afe4df39b';
const key = '50000000-0000-4000-8000-000000000001';
const context = { userId, eventId, sessionId: '10000000-0000-4000-8000-000000000001' };
const queue = () => ({ eventId, experienceId, waitingCount: 1, canCallWaitingEntries: true,
  firstWaitingQueueEntryId: entryId });
const stations = (pendingServiceSessionId = null) => ({ eventId, stations: [
  { id:stationId, experienceId, label:'Estação 01', availability:'available', pendingServiceSessionId },
] });
const called = () => ({ serviceSession: { id: sessionId, queueEntryId: entryId,
  experienceId, station: {id:stationId,label:'Estação 01'}, status:'pending' } });
const completed = () => ({ serviceSession: {id:sessionId,status:'completed',resolvedAt:'2026-11-07T21:24:52.985Z'},
  queueEntry:{status:'closed',closeReason:'completed'},
  participation:{status:'active',currentQueueEntryId:null} });
function memory() {
  const map = new Map(), receipts = new Map(), actions=[];
  return { map, receipts, actions, isPersistent: true,
    async get(user) { actions.push('get'); return receipts.get(user) ?? map.get(user) ?? null; },
    async set(intent) { actions.push('set'); map.set(intent.userId, { phase: 'dispatching', ...intent }); },
    async reserve(intent) { actions.push('reserve'); const previous = receipts.get(intent.userId) ?? map.get(intent.userId);
      if (previous) return { created: false, intent: previous };
      map.set(intent.userId, intent); return { created: true, intent }; },
    async dispatch(user, expected) { const intent = map.get(user); if (intent?.key !== expected || intent.phase !== 'reserved') return false;
      map.set(user, { ...intent, phase: 'dispatching' }); return true; },
    async recordTerminal(user, expected, outcome) { const intent = map.get(user);
      if (intent?.key !== expected || intent.phase !== 'dispatching') throw new Error('transição inválida');
      const receipt = { ...intent, phase: 'terminal', outcome }; receipts.set(user, receipt); return receipt; },
    async cancelReserved(user, expected) { const intent = map.get(user);
      if (intent?.key !== expected || intent.phase !== 'reserved') return false; map.delete(user); return true; },
    async clear(user, expected) { actions.push('clear'); if (receipts.get(user)?.key !== expected) throw new Error('sem recibo');
      if(map.get(user)?.key===expected) map.delete(user); },
    async acknowledge(user, expected, scope) { const receipt = receipts.get(user);
      if (receipt && receipt.key !== expected) return { kind: 'receipt_changed' };
      if (!receipt) return { kind: 'receipt_absent' };
      if (map.has(user)) return { kind: 'cleanup_pending' };
      if (receipt.sessionId !== scope.sessionId || receipt.eventId !== scope.eventId || receipt.stationId !== scope.stationId)
        return { kind: 'receipt_changed' };
      receipts.delete(user); return { kind: 'acknowledged' }; },
  };
}

test('lê estações e fila operacional apenas com sessão autenticada', async () => {
  const { fetchStaffStations, fetchStaffQueue } = await service;
  const paths=[];
  const client={ async get(path, opts) {paths.push([path,opts]);return path.endsWith('/stations') ? stations() : queue();} };
  const values=await Promise.all([fetchStaffStations(client,eventId),fetchStaffQueue(client,eventId,experienceId)]);
  assert.equal(values[0].stations[0].availability,'available');
  assert.equal(values[1].firstWaitingQueueEntryId, entryId);
  assert.deepEqual(paths.map(([p,o])=>o.auth),[true,true]);
});

test('não aceita estação inconsistente, fila negativa ou resposta de chamada inventada', async () => {
  const { parseStaffStations, parseStaffQueue, parseCalledSession } = await service;
  assert.throws(() => parseStaffStations(stations('errado'),eventId), /inválida/);
  assert.throws(() => parseStaffQueue({...queue(),waitingCount:-1},eventId,experienceId), /inválida/);
  assert.throws(() => parseCalledSession({serviceSession:{...called().serviceSession, status:'completed'}},
    {experienceId,stationId}),/inesperada/);
});

test('Staff chama FIFO do servidor e preserva chave antes da operação', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage=memory(), ops=[];
  const client={
    async get(path) {return path.endsWith('/stations')?stations():queue();},
    async post(path,body,opts) {ops.push({path,body,opts});
      assert.equal(storage.map.get(userId).key,key);
      return called();},
  };
  const coordinator=createStaffOperationsCoordinator({isCurrent:()=>true,client,storage,createKey:()=>key});
  const result=await coordinator.callNext(context,experienceId,stationId);
  assert.equal(result.kind,'confirmed');
  assert.equal(result.result.id,sessionId);
  assert.equal(ops[0].opts.headers['Idempotency-Key'],key);
  assert.deepEqual(ops[0].body,{});
  assert.equal(storage.map.size,0);
});

test('Staff não chama se estação ocupada ou sem fila', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const store=memory();
  const client={ async get(path){return path.endsWith('/stations') ? stations(sessionId) : queue();},
    async post() { assert.fail('Não enviar chamada'); } };
  const result=await createStaffOperationsCoordinator({isCurrent:()=>true,client,storage:store,createKey:()=>key})
    .callNext(context,experienceId,stationId);
  assert.equal(result.kind,'blocked');
  assert.equal(store.map.size,0);
});

test('timeout preserva chave e bloqueia repetição sem garantia de retenção', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage=memory(), keys=[];
  let calls=0;
  const client={ async get(path){return path.endsWith('/stations')?stations():queue();},
    async post(path,body,opts){keys.push(opts.headers['Idempotency-Key']);calls++;
      if(calls===1){const e=new Error('timeout');e.isTimeout=true;throw e;}return called();} };
  const manager=createStaffOperationsCoordinator({isCurrent:()=>true,client,storage,createKey:()=>key});
  const first=await manager.callNext(context,experienceId,stationId);
  assert.equal(first.kind,'uncertain');
  assert.equal(storage.map.get(userId).key,key);
  const second=await manager.callNext(context,experienceId,stationId);
  assert.equal(second.kind,'pending_reconciliation');
  assert.deepEqual(keys,[key]);
  assert.equal(storage.map.size,1);
});

test('conclusão exige chamada da mesma estação e confirma o resultado real', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage=memory();
  const client={ async get(){return stations(sessionId);},
    async post(path,body,opts){assert.match(path, /\/complete$/);
      assert.equal(storage.map.get(userId).key,key);
      assert.deepEqual(body,{});
      return completed(); } };
  const res=await createStaffOperationsCoordinator({isCurrent:()=>true,client,storage,createKey:()=>key})
    .complete(context,sessionId,stationId);
  assert.equal(res.kind,'confirmed');
  assert.equal(res.result.closeReason,'completed');
});

test('intent Staff pendente bloqueia outra mutação', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const store=memory();
  await store.set({userId,eventId,sessionId:context.sessionId,kind:'call',experienceId,stationId,serviceSessionId:null,key});
  const client={async post(){assert.fail('não enviar');}, async get(){assert.fail('não ler');}};
  const manager=createStaffOperationsCoordinator({isCurrent:()=>true,client,storage:store,createKey:()=>key});
  const res=await manager.complete(context,sessionId,stationId);
  assert.equal(res.kind,'pending_other');
  assert.equal(store.map.size,1);
});

test('troca de sessão entre leitura e mutação bloqueia POST', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage=memory();
  let current=true;
  const client={async get(path){current=false;return path.endsWith('/stations')?stations():queue();},
    async post(){assert.fail('POST depois de troca de sessão');}};
  const result=createStaffOperationsCoordinator({isCurrent:()=>true,client,storage,createKey:()=>key,isCurrent:()=>current})
    .callNext(context,experienceId,stationId);
  assert.equal((await result).kind, 'stale');
  assert.equal(storage.map.size,0);
});

test('conclusão após timeout conserva a chave e aguarda reconciliação', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage = memory();
  let attempts=0;
  const client={
    async get(){return stations(sessionId);},
    async post(path,body,opts){assert.equal(opts.headers['Idempotency-Key'],key);
      attempts++;if(attempts===1)throw new Error('rede');return completed();},
  };
  const manager=createStaffOperationsCoordinator({isCurrent:()=>true,client,storage,createKey:()=>key});
  assert.equal((await manager.complete(context,sessionId,stationId)).kind,'uncertain');
  assert.equal(storage.map.get(userId).key,key);
  assert.equal((await manager.complete(context,sessionId,stationId)).kind,'pending_reconciliation');
  assert.equal(attempts,1);
  assert.equal(storage.map.size,1);
});

test('ausência preserva o resultado real de reinserção ou encerramento', async () => {
  const { parseAbsentSession } = await service;
  const base = { serviceSession: { id: sessionId, status: 'absent' },
    previousQueueEntry: { id: entryId, status: 'closed', closeReason: 'absent' } };
  const without = parseAbsentSession({ ...base, requeued: false, newQueueEntry: null }, sessionId);
  assert.equal(without.requeued, false);
  const withQueue = parseAbsentSession({ ...base, requeued: true,
    newQueueEntry: { id: '6692c3ea-3335-4807-a1db-c97e83643d5b', status: 'waiting', queueOrder: '90071992547409931234', position: 2 } }, sessionId);
  assert.equal(withQueue.newQueueEntry.position, 2);
  for (const order of ['', '0', '-1', '01', '1.5']) assert.throws(() => parseAbsentSession({ ...base, requeued: true,
    newQueueEntry: { id: '6692c3ea-3335-4807-a1db-c97e83643d5b', status: 'waiting', queueOrder: order, position: 1 } }, sessionId), /inesperada/);
  assert.throws(() => parseAbsentSession({ ...base, requeued: true,
    newQueueEntry: { id: entryId, status: 'waiting', queueOrder: '1', position: 1 } }, sessionId), /inesperada/);
  assert.throws(() => parseAbsentSession({ ...base, requeued: false,
    newQueueEntry: { id: entryId } }, sessionId), /inesperada/);
});

test('ausência após resultado desconhecido preserva a intenção sem reenviar', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage = memory(), keys = [];
  const client = { async get() { return stations(sessionId); }, async post(path, body, options) {
    assert.match(path, /\/absent$/); assert.deepEqual(body, {});
    keys.push(options.headers['Idempotency-Key']);
    if (keys.length === 1) throw new Error('rede');
    return { serviceSession: { id: sessionId, status: 'absent' },
      previousQueueEntry: { id: entryId, status: 'closed', closeReason: 'absent' },
      requeued: false, newQueueEntry: null };
  } };
  const manager = createStaffOperationsCoordinator({isCurrent:()=>true, client, storage, createKey: () => key });
  assert.equal((await manager.absent(context, sessionId, stationId)).kind, 'uncertain');
  assert.equal((await manager.absent(context, sessionId, stationId)).kind, 'pending_reconciliation');
  assert.deepEqual(keys, [key]);
});

test('armazenamento seguro reserva antes do POST e mantém a intenção após reinício', async () => {
  const { createStaffIntentStorage } = loadModule('services/staffIntentStorage.js', (name) => {
    if (name === 'react-native') return { Platform: { OS: 'web' } };
    if (name === 'expo-secure-store') return {};
    return require(name);
  }).exports;
  const values = new Map();
  const secureStore = { async getItemAsync(k) { return values.get(k) ?? null; },
    async setItemAsync(k, v) { values.set(k, v); }, async deleteItemAsync(k) { values.delete(k); } };
  const first = createStaffIntentStorage({ platformOS: 'android', secureStore });
  const second = createStaffIntentStorage({ platformOS: 'android', secureStore });
  const intent = { ...context, stationId, experienceId, serviceSessionId: null, kind: 'call', key, phase: 'reserved' };
  const reservations = await Promise.all([first.reserve(intent), second.reserve(intent)]);
  assert.equal(reservations.filter((x) => x.created).length, 1);
  assert.deepEqual(structuredClone(await second.get(userId)), intent);
  const web = createStaffIntentStorage({ platformOS: 'web', secureStore });
  await assert.rejects(web.reserve(intent), /indisponível/);
});

test('conflitos definitivos e falhas ambíguas são classificados separadamente', async () => {
  const { classifyStaffOperationError } = await service;
  for (const code of ['QUEUE_EMPTY', 'STATION_UNAVAILABLE', 'STATION_HAS_PENDING_CALL',
    'SERVICE_NOT_PENDING', 'EVENT_OPERATION_ENDED'])
    assert.equal(classifyStaffOperationError({ status: 409, code }).kind, 'rejected');
  for (const status of [400, 401, 403, 404])
    assert.equal(classifyStaffOperationError({ status }).kind, 'rejected');
  for (const code of ['IDEMPOTENCY_IN_PROGRESS', 'IDEMPOTENCY_REQUEST_CONFLICT'])
    assert.equal(classifyStaffOperationError({ status: 409, code }).kind, 'pending_reconciliation');
  assert.equal(classifyStaffOperationError({ isTimeout: true }).kind, 'uncertain');
  assert.equal(classifyStaffOperationError({ status: 500 }).kind, 'uncertain');
  assert.equal(classifyStaffOperationError(new Error('resposta inválida')).kind, 'uncertain');
});

test('troca de sessão, evento ou estação não reapresenta uma intenção anterior', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage = memory();
  await storage.set({ ...context, stationId, experienceId, serviceSessionId: null, kind: 'call', key });
  const manager = createStaffOperationsCoordinator({ isCurrent: () => true, client: {}, storage, createKey: () => key });
  assert.equal((await manager.pending({ ...context, stationId })).kind, 'pending_reconciliation');
  assert.equal((await manager.pending({ ...context, stationId, sessionId: '10000000-0000-4000-8000-000000000002' })).kind, 'pending_other');
  assert.equal((await manager.pending({ ...context, stationId, eventId: '10000000-0000-4000-8000-000000000003' })).kind, 'pending_other');
  assert.equal((await manager.pending({ ...context, stationId: '10000000-0000-4000-8000-000000000004' })).kind, 'pending_other');
  assert.equal((await manager.pending({ ...context, stationId, userId: '10000000-0000-4000-8000-000000000005' })).kind, 'none');
});

test('resposta atrasada após logout não confirma nem remove intenção', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage = memory(); let current = true, resolvePost, started;
  const entered = new Promise((resolve) => { started = resolve; });
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); },
    post() { started(); return new Promise((resolve) => { resolvePost = resolve; }); } };
  const manager = createStaffOperationsCoordinator({ client, storage, createKey: () => key, isCurrent: () => current });
  const result = manager.callNext(context, experienceId, stationId);
  await entered; current = false; resolvePost(called());
  assert.equal((await result).kind, 'stale');
  assert.equal(storage.map.get(userId).key, key);
  assert.equal(storage.receipts.get(userId).outcome.result.id, sessionId);
});

test('conflito conhecido rejeita a primeira tentativa e libera a reserva', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage = memory();
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); },
    async post() { throw Object.assign(new Error('fila vazia'), { status: 409, code: 'QUEUE_EMPTY' }); } };
  const manager = createStaffOperationsCoordinator({ client, storage, createKey: () => key, isCurrent: () => true });
  assert.deepEqual(await manager.callNext(context, experienceId, stationId),
    { kind: 'rejected', status: 409, code: 'QUEUE_EMPTY', receiptId: key });
  assert.equal(storage.map.size, 0);
});

test('chamadas simultâneas em estações distintas não compartilham resultado nem chave', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage = memory(); let resolvePost, started;
  const entered = new Promise((resolve) => { started = resolve; });
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); },
    post() { started(); return new Promise((resolve) => { resolvePost = resolve; }); } };
  const manager = createStaffOperationsCoordinator({ client, storage, createKey: () => key, isCurrent: () => true });
  const first = manager.callNext(context, experienceId, stationId);
  await entered;
  const second = await manager.callNext(context, experienceId, '10000000-0000-4000-8000-000000000004');
  assert.equal(second.kind, 'busy');
  resolvePost(called());
  assert.equal((await first).kind, 'confirmed');
});

test('falha ao reservar impede o POST e mudança de estação descarta resposta atrasada', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage = memory();
  storage.reserve = async () => { throw new Error('armazenamento indisponível'); };
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); },
    async post() { assert.fail('não enviar sem persistência'); } };
  const manager = createStaffOperationsCoordinator({ client, storage, createKey: () => key, isCurrent: () => true });
  await assert.rejects(manager.callNext(context, experienceId, stationId), /armazenamento/);

  const otherStorage = memory(); let selected = stationId, resolvePost, entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const otherClient = { ...client, post() { entered(); return new Promise((resolve) => { resolvePost = resolve; }); } };
  const other = createStaffOperationsCoordinator({ client: otherClient, storage: otherStorage, createKey: () => key,
    isCurrent: (_context, intent) => !intent || intent.stationId === selected });
  const result = other.callNext(context, experienceId, stationId);
  await started; selected = '10000000-0000-4000-8000-000000000004'; resolvePost(called());
  assert.equal((await result).kind, 'stale');
  assert.equal(otherStorage.map.get(userId).key, key);
});

for (const afterDelete of [false, true]) {
  test(`confirmação sobrevive à falha de limpeza ${afterDelete ? 'após' : 'antes da'} exclusão`, async () => {
    const { createStaffOperationsCoordinator } = await service;
    const storage = memory(), originalClear = storage.clear.bind(storage);
    storage.clear = async (...args) => { if (afterDelete) await originalClear(...args); throw new Error('falha na limpeza'); };
    const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); },
      async post() { return called(); } };
    const manager = createStaffOperationsCoordinator({ client, storage, createKey: () => key, isCurrent: () => true });
    const result = await manager.callNext(context, experienceId, stationId);
    assert.equal(result.kind, 'confirmed_cleanup_pending');
    assert.equal(result.result.id, sessionId);
    assert.equal(storage.receipts.get(userId).outcome.result.id, sessionId);
    assert.equal((await manager.callNext(context, experienceId, stationId)).kind, 'terminal_pending');
    storage.clear = originalClear;
    assert.equal((await manager.cleanupTerminal({ ...context, stationId }, key)).kind, 'terminal_pending');
    assert.equal((await manager.acknowledgeTerminal({ ...context, stationId, serviceSessionId: sessionId }, key)).kind, 'acknowledged');
  });
}

test('falha ao persistir recibo mantém despacho bloqueado sem negar sucesso conhecido', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage = memory(); storage.recordTerminal = async () => { throw new Error('falha de gravação'); };
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); }, async post() { return called(); } };
  const manager = createStaffOperationsCoordinator({ client, storage, createKey: () => key, isCurrent: () => true });
  assert.equal((await manager.callNext(context, experienceId, stationId)).kind, 'confirmed_cleanup_pending');
  assert.equal(storage.map.get(userId).phase, 'dispatching');
  assert.equal((await manager.callNext(context, experienceId, stationId)).kind, 'pending_reconciliation');
});

test('recibo gravado antes da falha pode ser recuperado sem reenviar', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage = memory(), original = storage.recordTerminal.bind(storage); let posts = 0;
  storage.recordTerminal = async (...args) => { await original(...args); throw new Error('gravação incerta'); };
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); },
    async post() { posts += 1; return called(); } };
  const make = () => createStaffOperationsCoordinator({ client, storage, createKey: () => key, isCurrent: () => true });
  assert.equal((await make().callNext(context, experienceId, stationId)).kind, 'confirmed_cleanup_pending');
  const restarted = make();
  const pending = await restarted.pending({ ...context, stationId });
  assert.equal(pending.kind, 'terminal_pending'); assert.equal(pending.outcome.result.id, sessionId);
  assert.equal((await restarted.cleanupTerminal({ ...context, stationId }, key)).kind, 'terminal_pending');
  assert.equal(posts, 1);
});

test('mudança depois da reserva cancela somente fase reservada e não envia POST', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage = memory(), original = storage.reserve.bind(storage); let current = true;
  storage.reserve = async (...args) => { const result = await original(...args); current = false; return result; };
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); }, async post() { assert.fail('POST proibido'); } };
  const manager = createStaffOperationsCoordinator({ client, storage, createKey: () => key, isCurrent: () => current });
  assert.equal((await manager.callNext(context, experienceId, stationId)).kind, 'stale');
  assert.equal(storage.map.size, 0);
});

test('falha ambígua na transição para envio não permite POST nem descarta intenção', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage = memory(), original = storage.dispatch.bind(storage);
  storage.dispatch = async (...args) => { await original(...args); throw new Error('gravação incerta'); };
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); }, async post() { assert.fail('POST proibido'); } };
  const manager = createStaffOperationsCoordinator({ client, storage, createKey: () => key, isCurrent: () => true });
  assert.equal((await manager.callNext(context, experienceId, stationId)).kind, 'storage_error');
  assert.equal(storage.map.get(userId).phase, 'dispatching');
  assert.equal((await manager.cancelReserved({ ...context, stationId })).kind, 'blocked');
});

test('logout durante falha de limpeza rejeitada retorna contexto obsoleto e preserva recibo', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage = memory(); let current = true, release, entered;
  const started = new Promise((resolve) => { entered = resolve; });
  storage.clear = () => { entered(); return new Promise((_, reject) => { release = reject; }); };
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); },
    async post() { throw Object.assign(new Error('vazia'), { status: 409, code: 'QUEUE_EMPTY' }); } };
  const manager = createStaffOperationsCoordinator({ client, storage, createKey: () => key, isCurrent: () => current });
  const result = manager.callNext(context, experienceId, stationId);
  await started; current = false; release(new Error('erro'));
  assert.equal((await result).kind, 'stale');
  assert.equal(storage.receipts.get(userId).outcome.code, 'QUEUE_EMPTY');
});

test('logout durante falha de persistência do recibo mantém o despacho para reconciliação', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage = memory(); let current = true, release, entered;
  const started = new Promise((resolve) => { entered = resolve; });
  storage.recordTerminal = () => { entered(); return new Promise((_, reject) => { release = reject; }); };
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); }, async post() { return called(); } };
  const manager = createStaffOperationsCoordinator({ client, storage, createKey: () => key, isCurrent: () => current });
  const result = manager.callNext(context, experienceId, stationId);
  await started; current = false; release(new Error('erro'));
  assert.equal((await result).kind, 'stale');
  assert.equal(storage.map.get(userId).phase, 'dispatching');
});

test('nova instância recupera fases e recibo após falha posterior à exclusão', async () => {
  const { createStaffIntentStorage } = loadModule('services/staffIntentStorage.js', (name) => {
    if (name === 'react-native') return { Platform: { OS: 'web' } };
    if (name === 'expo-secure-store') return {};
    return require(name);
  }).exports;
  const values = new Map(); let failAfterDelete = false;
  const secureStore = { async getItemAsync(k) { return values.get(k) ?? null; },
    async setItemAsync(k, v) { values.set(k, v); }, async deleteItemAsync(k) {
      values.delete(k); if (failAfterDelete) throw new Error('exclusão incerta');
    } };
  const open = () => createStaffIntentStorage({ platformOS: 'android', secureStore });
  let store = open();
  const intent = { ...context, stationId, experienceId, serviceSessionId: null, kind: 'call', key, phase: 'reserved' };
  await store.reserve(intent);
  store = open(); assert.equal((await store.get(userId)).phase, 'reserved');
  await store.dispatch(userId, key);
  store = open(); assert.equal((await store.get(userId)).phase, 'dispatching');
  assert.equal(await store.cancelReserved(userId, key), false);
  await store.recordTerminal(userId, key, { kind: 'confirmed', result: { id: sessionId, queueEntryId: entryId,
    experienceId, stationId, stationLabel: 'Estação 01', status: 'pending' } });
  failAfterDelete = true;
  await assert.rejects(store.clear(userId, key), /incerta/);
  store = open(); assert.equal((await store.get(userId)).phase, 'terminal');
  assert.equal((await store.reserve(intent)).created, false);
  failAfterDelete = false;
  await store.clear(userId, key);
  assert.equal((await store.acknowledge(userId, key, intent)).kind, 'acknowledged');
  assert.equal(await store.get(userId), null);
});

test('coordenadores concorrentes não enviam duas intenções pela mesma conta', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage = memory(); let resolvePost, entered, posts = 0;
  const started = new Promise((resolve) => { entered = resolve; });
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); },
    post() { posts += 1; entered(); return new Promise((resolve) => { resolvePost = resolve; }); } };
  const make = () => createStaffOperationsCoordinator({ client, storage, createKey: () => key, isCurrent: () => true });
  const first = make().callNext(context, experienceId, stationId);
  await started;
  const second = await make().callNext(context, experienceId, stationId);
  assert.equal(second.kind, 'pending_reconciliation'); assert.equal(posts, 1);
  resolvePost(called()); assert.equal((await first).kind, 'confirmed');
});

for (const field of ['userId', 'sessionId', 'eventId', 'stationId']) {
  test(`mudança de ${field} durante limpeza impede publicação do resultado antigo`, async () => {
    const { createStaffOperationsCoordinator } = await service;
    const storage = memory(); let live = { ...context, stationId }, release, entered;
    const started = new Promise((resolve) => { entered = resolve; });
    storage.clear = () => { entered(); return new Promise((_, reject) => { release = reject; }); };
    const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); }, async post() { return called(); } };
    const isCurrent = (current, intent) => ['userId', 'sessionId', 'eventId'].every((name) => current[name] === live[name]) &&
      (!intent || intent.stationId === live.stationId);
    const manager = createStaffOperationsCoordinator({ client, storage, createKey: () => key, isCurrent });
    const result = manager.callNext(context, experienceId, stationId);
    await started; live = { ...live, [field]: '10000000-0000-4000-8000-000000000009' }; release(new Error('erro'));
    assert.equal((await result).kind, 'stale');
    assert.equal(storage.receipts.get(userId).outcome.result.id, sessionId);
  });
}

function secureStaffRig(values = new Map()) {
  const { createStaffIntentStorage } = loadModule('services/staffIntentStorage.js', (name) => {
    if (name === 'react-native') return { Platform: { OS: 'web' } };
    if (name === 'expo-secure-store') return {};
    return require(name);
  }).exports;
  const fault = { deleteMode: null, readFails: false, readAckFails: false, writeAckMode: null,
    writeCompletedMode: null, deleteReceipt: null };
  const secureStore = {
    async getItemAsync(k) {
      if (fault.readAckFails && k.endsWith('.ack')) throw new Error('leitura ack');
      if (fault.readFails && k.endsWith('.receipt')) throw new Error('leitura');
      return values.get(k) ?? null;
    },
    async setItemAsync(k, v) {
      if (k.endsWith('.ack') && fault.writeAckMode === 'before') throw new Error('gravação');
      const completed = k.endsWith('.ack') && JSON.parse(v).status === 'completed';
      if (completed && fault.writeCompletedMode === 'before') throw new Error('gravação completed');
      values.set(k, v);
      if (k.endsWith('.ack') && fault.writeAckMode === 'after') throw new Error('gravação');
      if (completed && fault.writeCompletedMode === 'after') throw new Error('gravação completed');
    },
    async deleteItemAsync(k) {
      if (k.endsWith('.receipt') && fault.deleteReceipt) await fault.deleteReceipt();
      if (k.endsWith('.receipt') && fault.deleteMode === 'before') throw new Error('exclusão');
      values.delete(k);
      if (k.endsWith('.receipt') && ['after', 'after_read'].includes(fault.deleteMode)) {
        if (fault.deleteMode === 'after_read') fault.readFails = true;
        throw new Error('exclusão');
      }
    },
  };
  return { storage: createStaffIntentStorage({ platformOS: 'android', secureStore }), values, fault };
}

for (const mode of ['before', 'after']) {
  test(`falha de marcador ${mode} da gravação não libera operação`, async () => {
    const { createStaffOperationsCoordinator } = await service;
    const { storage, fault } = secureStaffRig();
    const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); }, async post() { return called(); } };
    const manager = createStaffOperationsCoordinator({ client, storage, isCurrent: () => true, createKey: () => key });
    const scope = { ...context, stationId, serviceSessionId: sessionId };
    await manager.callNext(context, experienceId, stationId);
    fault.writeAckMode = mode;
    assert.equal((await manager.acknowledgeTerminal(scope, key)).kind, 'storage_error');
    assert.equal((await manager.pending(scope)).receiptId, key);
    assert.equal((await manager.callNext(context, experienceId, stationId)).kind, 'terminal_pending');
    fault.writeAckMode = null;
    assert.equal((await manager.acknowledgeTerminal(scope, key)).kind, 'acknowledged');
  });
}

test('reconhecimento de A não remove o recibo posterior B', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const { storage } = secureStaffRig(); let index = 0;
  const keyB = '50000000-0000-4000-8000-000000000002';
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); }, async post() { return called(); } };
  const manager = createStaffOperationsCoordinator({ client, storage, isCurrent: () => true, createKey: () => index++ ? keyB : key });
  const scope = { ...context, stationId, serviceSessionId: sessionId };
  const first = await manager.callNext(context, experienceId, stationId);
  assert.equal(first.receiptId, key);
  assert.equal((await manager.acknowledgeTerminal(scope, key)).kind, 'acknowledged');
  assert.equal((await manager.acknowledgeTerminal(scope, key)).kind, 'receipt_absent');
  const second = await manager.callNext(context, experienceId, stationId);
  assert.equal(second.receiptId, keyB);
  assert.equal((await manager.acknowledgeTerminal(scope, key)).kind, 'receipt_changed');
  const pending = await manager.pending(scope);
  assert.equal(pending.receiptId, keyB);
  assert.equal((await manager.acknowledgeTerminal({ ...scope, serviceSessionId: '10000000-0000-4000-8000-000000000009' }, keyB)).kind, 'blocked');
  assert.equal((await manager.pending(scope)).receiptId, keyB);
});

for (const mode of ['before', 'after', 'after_read']) {
  test(`reconhecimento com exclusão ${mode} preserva bloqueio até verificar o mesmo recibo`, async () => {
    const { createStaffOperationsCoordinator } = await service;
    const { storage, fault } = secureStaffRig();
    const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); }, async post() { return called(); } };
    const make = () => createStaffOperationsCoordinator({ client, storage, isCurrent: () => true, createKey: () => key });
    const first = make(); const scope = { ...context, stationId, serviceSessionId: sessionId };
    assert.equal((await first.callNext(context, experienceId, stationId)).receiptId, key);
    fault.deleteMode = mode;
    const result = await first.acknowledgeTerminal(scope, key);
    assert.equal(result.kind, mode === 'before' ? 'delete_failed' : mode === 'after' ? 'receipt_absent' : 'acknowledgement_uncertain');
    fault.readFails = false;
    const restarted = make();
    assert.equal((await restarted.pending(scope)).receiptId, key);
    assert.equal((await restarted.callNext(context, experienceId, stationId)).kind, 'terminal_pending');
    fault.deleteMode = null;
    assert.equal((await restarted.acknowledgeTerminal(scope, key)).kind, 'acknowledged');
    assert.equal((await restarted.acknowledgeTerminal(scope, key)).kind, 'receipt_absent');
  });
}

test('dois coordenadores reconhecem apenas o mesmo recibo uma vez', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const { storage } = secureStaffRig();
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); }, async post() { return called(); } };
  const make = () => createStaffOperationsCoordinator({ client, storage, isCurrent: () => true, createKey: () => key });
  const first = make(), second = make(), scope = { ...context, stationId, serviceSessionId: sessionId };
  await first.callNext(context, experienceId, stationId);
  const results = await Promise.all([first.acknowledgeTerminal(scope, key), second.acknowledgeTerminal(scope, key)]);
  assert.equal(results.filter((item) => item.kind === 'acknowledged').length, 1);
  assert.ok(results.every((item) => ['acknowledged', 'receipt_absent', 'already_acknowledged'].includes(item.kind)));
});

test('recibo de outro contexto não pode ser reconhecido', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const { storage } = secureStaffRig();
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); }, async post() { return called(); } };
  const manager = createStaffOperationsCoordinator({ client, storage, isCurrent: () => true, createKey: () => key });
  const scope = { ...context, stationId, serviceSessionId: sessionId };
  await manager.callNext(context, experienceId, stationId);
  for (const field of ['sessionId', 'eventId', 'stationId', 'serviceSessionId']) {
    assert.equal((await manager.acknowledgeTerminal({ ...scope, [field]: '10000000-0000-4000-8000-000000000009' }, key)).kind, 'blocked');
  }
  assert.equal((await manager.acknowledgeTerminal({ ...scope, userId: '10000000-0000-4000-8000-000000000009' }, key)).kind, 'receipt_absent');
  assert.equal((await manager.pending(scope)).receiptId, key);
});

test('reserva concorrente com exclusão incerta aguarda e mantém recibo protegido', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const { storage, fault } = secureStaffRig(); let posts = 0, release, entered;
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); },
    async post() { posts += 1; return called(); } };
  const make = () => createStaffOperationsCoordinator({ client, storage, isCurrent: () => true, createKey: () => key });
  const first = make(), second = make(), scope = { ...context, stationId, serviceSessionId: sessionId };
  await first.callNext(context, experienceId, stationId);
  const original = storage.acknowledge.bind(storage);
  const started = new Promise((resolve) => { entered = resolve; });
  storage.acknowledge = async (...args) => { entered(); await new Promise((resolve) => { release = resolve; }); return original(...args); };
  const acknowledgement = first.acknowledgeTerminal(scope, key);
  await started; fault.deleteMode = 'after';
  const competing = second.callNext(context, experienceId, stationId);
  release();
  assert.equal((await acknowledgement).kind, 'receipt_absent');
  assert.equal((await competing).kind, 'terminal_pending');
  assert.equal(posts, 1);
});

for (const changed of ['userId', 'sessionId', 'eventId', 'stationId', 'serviceSessionId']) {
  test(`mudança de ${changed} durante falha de reconhecimento retorna stale`, async () => {
    const { createStaffOperationsCoordinator } = await service;
    const storage = memory(); let live = { ...context, stationId, serviceSessionId: sessionId }, entered, release;
    const started = new Promise((resolve) => { entered = resolve; });
    const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); }, async post() { return called(); } };
    const isCurrent = (current, scope) => ['userId', 'sessionId', 'eventId'].every((field) => current[field] === live[field]) &&
      (!scope?.stationId || scope.stationId === live.stationId) &&
      (!scope?.outcome?.result?.id || scope.outcome.result.id === live.serviceSessionId);
    const manager = createStaffOperationsCoordinator({ client, storage, isCurrent, createKey: () => key });
    await manager.callNext(context, experienceId, stationId);
    storage.acknowledge = () => { entered(); return new Promise((_, reject) => { release = reject; }); };
    const result = manager.acknowledgeTerminal({ ...live }, key);
    await started; live = { ...live, [changed]: '10000000-0000-4000-8000-000000000009' }; release(new Error('erro'));
    assert.equal((await result).kind, 'stale');
    assert.equal(storage.receipts.get(userId).key, key);
  });
}

test('logout durante erro no reconhecimento retorna stale e mantém recibo original', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage = memory(); let current = true, entered, release;
  const started = new Promise((resolve) => { entered = resolve; });
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); }, async post() { return called(); } };
  const manager = createStaffOperationsCoordinator({ client, storage, isCurrent: () => current, createKey: () => key });
  await manager.callNext(context, experienceId, stationId);
  storage.acknowledge = () => { entered(); return new Promise((_, reject) => { release = reject; }); };
  const result = manager.acknowledgeTerminal({ ...context, stationId, serviceSessionId: sessionId }, key);
  await started; current = false; release(new Error('armazenamento'));
  assert.equal((await result).kind, 'stale');
  assert.equal(storage.receipts.get(userId).key, key);
});

test('falha de leitura de .ack bloqueia POST e preserva recibo posterior', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const { storage, values, fault } = secureStaffRig();
  const keyB = '50000000-0000-4000-8000-000000000002';
  let index = 0, posts = 0;
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); },
    async post() { posts += 1; return called(); } };
  const manager = createStaffOperationsCoordinator({ client, storage, isCurrent: () => true,
    createKey: () => index++ ? keyB : key });
  const scope = { ...context, stationId, serviceSessionId: sessionId };
  await manager.callNext(context, experienceId, stationId);
  assert.equal((await manager.acknowledgeTerminal(scope, key)).kind, 'acknowledged');
  assert.equal((await manager.callNext(context, experienceId, stationId)).receiptId, keyB);
  const receiptKey = `arenago.staff.operation.${userId}.receipt`;
  const receiptBefore = values.get(receiptKey);
  fault.readAckFails = true;
  await assert.rejects(storage.get(userId), /leitura ack/);
  await assert.rejects(manager.callNext(context, experienceId, stationId), /leitura ack/);
  assert.equal((await manager.acknowledgeTerminal(scope, key)).kind, 'acknowledgement_uncertain');
  assert.equal(posts, 2);
  assert.equal(values.get(receiptKey), receiptBefore);
  fault.readAckFails = false;
  assert.equal((await manager.pending(scope)).receiptId, keyB);
  assert.equal((await manager.acknowledgeTerminal(scope, key)).kind, 'receipt_changed');
  assert.equal((await manager.pending(scope)).outcome.result.id, sessionId);
});

test('falha de leitura de .ack não libera intenção com resultado desconhecido', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const { storage, fault } = secureStaffRig();
  let posts = 0;
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); },
    async post() { posts += 1; throw Object.assign(new Error('rede'), { isNetworkError: true }); } };
  const manager = createStaffOperationsCoordinator({ client, storage, isCurrent: () => true, createKey: () => key });
  assert.equal((await manager.callNext(context, experienceId, stationId)).kind, 'uncertain');
  fault.readAckFails = true;
  await assert.rejects(manager.callNext(context, experienceId, stationId), /leitura ack/);
  assert.equal(posts, 1);
  fault.readAckFails = false;
  assert.equal((await manager.pending({ ...context, stationId })).kind, 'pending_reconciliation');
});

for (const mode of ['before', 'after']) {
  test(`falha ${mode} de persistir completed preserva o estado efetivamente gravado`, async () => {
    const { createStaffOperationsCoordinator } = await service;
    const { storage, values, fault } = secureStaffRig();
    const keyB = '50000000-0000-4000-8000-000000000002';
    let index = 0, posts = 0;
    const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); },
      async post() { posts += 1; return called(); } };
    const manager = createStaffOperationsCoordinator({ client, storage, isCurrent: () => true,
      createKey: () => index++ ? keyB : key });
    const scope = { ...context, stationId, serviceSessionId: sessionId };
    assert.equal((await manager.callNext(context, experienceId, stationId)).kind, 'confirmed');
    fault.writeCompletedMode = mode;
    assert.equal((await manager.acknowledgeTerminal(scope, key)).kind, 'acknowledgement_uncertain');
    const marker = JSON.parse(values.get(`arenago.staff.operation.${userId}.ack`));
    assert.equal(marker.status, mode === 'before' ? 'pending' : 'completed');
    assert.equal(marker.receipt.outcome.kind, 'confirmed');
    assert.equal(marker.receipt.outcome.result.id, sessionId);
    const saved = await storage.get(userId);
    if (mode === 'before') {
      assert.equal(saved.key, key);
      assert.equal(saved.acknowledgementPending, true);
      assert.equal((await manager.callNext(context, experienceId, stationId)).kind, 'terminal_pending');
      assert.equal(posts, 1);
      fault.writeCompletedMode = null;
      assert.equal((await manager.acknowledgeTerminal(scope, key)).kind, 'acknowledged');
    } else {
      assert.equal(saved, null);
      fault.writeCompletedMode = null;
      assert.equal((await manager.acknowledgeTerminal(scope, key)).kind, 'receipt_absent');
    }
    assert.equal((await manager.callNext(context, experienceId, stationId)).receiptId, keyB);
    assert.equal((await manager.acknowledgeTerminal(scope, key)).kind, 'receipt_changed');
    assert.equal((await manager.pending(scope)).receiptId, keyB);
    assert.equal(posts, 2);
  });
}

test('novo adaptador recupera marcador pendente somente dos dados persistidos', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const original = secureStaffRig(); let posts = 0;
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); },
    async post() { posts += 1; return called(); } };
  const make = (storage) => createStaffOperationsCoordinator({ client, storage, isCurrent: () => true, createKey: () => key });
  const scope = { ...context, stationId, serviceSessionId: sessionId };
  const first = make(original.storage);
  await first.callNext(context, experienceId, stationId);
  original.fault.deleteMode = 'after';
  assert.equal((await first.acknowledgeTerminal(scope, key)).kind, 'receipt_absent');
  const restored = secureStaffRig(new Map(original.values));
  const second = make(restored.storage);
  const pending = await second.pending(scope);
  assert.equal(pending.receiptId, key);
  assert.equal(pending.outcome.kind, 'confirmed');
  assert.equal((await second.callNext(context, experienceId, stationId)).kind, 'terminal_pending');
  assert.equal(posts, 1);
  assert.equal((await second.acknowledgeTerminal(scope, key)).kind, 'acknowledged');
});

test('exclusão SecureStore pendente serializa reconhecimento e reserva entre coordenadores', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const { storage, fault } = secureStaffRig();
  const keyB = '50000000-0000-4000-8000-000000000002';
  let posts = 0, current = true, entered, release;
  const enteredDelete = new Promise((resolve) => { entered = resolve; });
  const client = { async get(path) { return path.endsWith('/stations') ? stations() : queue(); },
    async post() { posts += 1; return called(); } };
  const first = createStaffOperationsCoordinator({ client, storage, isCurrent: () => current, createKey: () => key });
  const second = createStaffOperationsCoordinator({ client, storage, isCurrent: () => true, createKey: () => keyB });
  const scope = { ...context, stationId, serviceSessionId: sessionId };
  await first.callNext(context, experienceId, stationId);
  fault.deleteReceipt = () => { entered(); return new Promise((_, reject) => { release = reject; }); };
  const acknowledgement = first.acknowledgeTerminal(scope, key);
  await enteredDelete;
  const duplicate = first.acknowledgeTerminal(scope, key);
  const reservation = storage.reserve({ ...context, stationId, experienceId, serviceSessionId: null,
    kind: 'call', key: keyB, phase: 'reserved' });
  const operation = second.callNext(context, experienceId, stationId);
  current = false;
  release(new Error('exclusão interrompida'));
  assert.equal((await acknowledgement).kind, 'stale');
  assert.equal((await duplicate).kind, 'stale');
  assert.equal((await reservation).created, false);
  assert.equal((await operation).kind, 'terminal_pending');
  assert.equal(posts, 1);
  fault.deleteReceipt = null;
  current = true;
  assert.equal((await first.acknowledgeTerminal(scope, key)).kind, 'acknowledged');
  assert.equal((await second.callNext(context, experienceId, stationId)).receiptId, keyB);
  assert.equal((await first.acknowledgeTerminal(scope, key)).kind, 'receipt_changed');
  assert.equal((await second.pending(scope)).receiptId, keyB);
  assert.equal(posts, 2);
});
