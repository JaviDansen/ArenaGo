const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const service = import(pathToFileURL(path.join(__dirname, '..', 'services', 'staffOperationsService.js')).href);
const userId = '20000000-0000-4000-8000-000000000001';
const eventId = 'e10da075-c6cb-4fd6-ba97-7b52403ebff8';
const experienceId = '63c7bb39-618d-4859-a851-f0ef7cbeaa6b';
const stationId = '892e9f40-d56a-464b-a6d4-aac44cbbb1fd';
const entryId = '6692c3ea-3335-4807-a1db-c97e83643d5a';
const sessionId = 'd87bacf1-4e38-4528-9f5a-f02afe4df39b';
const key = '50000000-0000-4000-8000-000000000001';
const context = { userId, eventId };
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
  const map = new Map(), actions=[];
  return { map, actions,
    async get(user) { actions.push('get'); return map.get(user) ?? null; },
    async set(intent) { actions.push('set'); map.set(intent.userId, intent); },
    async clear(user, expected) { actions.push('clear'); if(map.get(user)?.key===expected) map.delete(user); },
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
  const coordinator=createStaffOperationsCoordinator({client,storage,createKey:()=>key});
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
  const result=await createStaffOperationsCoordinator({client,storage:store,createKey:()=>key})
    .callNext(context,experienceId,stationId);
  assert.equal(result.kind,'blocked');
  assert.equal(store.map.size,0);
});

test('timeout preserva chave para replay, nunca cria segunda chamada', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage=memory(), keys=[];
  let calls=0;
  const client={ async get(path){return path.endsWith('/stations')?stations():queue();},
    async post(path,body,opts){keys.push(opts.headers['Idempotency-Key']);calls++;
      if(calls===1){const e=new Error('timeout');e.isTimeout=true;throw e;}return called();} };
  const manager=createStaffOperationsCoordinator({client,storage,createKey:()=>key});
  const first=await manager.callNext(context,experienceId,stationId);
  assert.equal(first.kind,'unconfirmed');
  assert.equal(storage.map.get(userId).key,key);
  const second=await manager.callNext(context,experienceId,stationId);
  assert.equal(second.kind,'confirmed');
  assert.deepEqual(keys,[key,key]);
  assert.equal(storage.map.size,0);
});

test('conclusão exige chamada da mesma estação e confirma o resultado real', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage=memory();
  const client={ async get(){return stations(sessionId);},
    async post(path,body,opts){assert.match(path, /\/complete$/);
      assert.equal(storage.map.get(userId).key,key);
      assert.deepEqual(body,{});
      return completed(); } };
  const res=await createStaffOperationsCoordinator({client,storage,createKey:()=>key})
    .complete(context,sessionId,stationId);
  assert.equal(res.kind,'confirmed');
  assert.equal(res.result.closeReason,'completed');
});

test('intent Staff pendente bloqueia outra mutação', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const store=memory();
  await store.set({userId,eventId,kind:'call',experienceId,stationId,serviceSessionId:null,key});
  const client={async post(){assert.fail('não enviar');}, async get(){assert.fail('não ler');}};
  const manager=createStaffOperationsCoordinator({client,storage:store,createKey:()=>key});
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
  const result=createStaffOperationsCoordinator({client,storage,createKey:()=>key,isCurrent:()=>current})
    .callNext(context,experienceId,stationId);
  await assert.rejects(result,/Sessão alterada/);
  assert.equal(storage.map.size,0);
});

test('conclusão após timeout usa a mesma chave até confirmar', async () => {
  const { createStaffOperationsCoordinator } = await service;
  const storage = memory();
  let attempts=0;
  const client={
    async get(){return stations(sessionId);},
    async post(path,body,opts){assert.equal(opts.headers['Idempotency-Key'],key);
      attempts++;if(attempts===1)throw new Error('rede');return completed();},
  };
  const manager=createStaffOperationsCoordinator({client,storage,createKey:()=>key});
  assert.equal((await manager.complete(context,sessionId,stationId)).kind,'unconfirmed');
  assert.equal(storage.map.get(userId).key,key);
  assert.equal((await manager.complete(context,sessionId,stationId)).kind,'confirmed');
  assert.equal(attempts,2);
  assert.equal(storage.map.size,0);
});
