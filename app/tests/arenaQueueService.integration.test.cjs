const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const service = import(pathToFileURL(path.join(__dirname, '..', 'services', 'arenaQueueService.js')).href);
const userId = '20000000-0000-4000-8000-000000000001';
const eventId = 'e10da075-c6cb-4fd6-ba97-7b52403ebff8';
const participationId = 'c79b25f1-b171-487f-9fee-a24d184054b5';
const experienceId = '63c7bb39-618d-4859-a851-f0ef7cbeaa6b';
const entryId = '6692c3ea-3335-4807-a1db-c97e83643d5a';
const key = '30000000-0000-4000-8000-000000000001';
const context = { userId, eventId, participationId };
const catalog = () => ({eventId, acceptingNewQueueEntries: true,
  experiences: [{id: experienceId, name: 'Experiência Fluxo Completo', waitingCount: 1,
    acceptingNewQueueEntries: true, stations: []}]});
const queue = (entry = null) => ({ participationId, currentQueueEntry: entry });
const waiting = () => ({ id: entryId, experienceId, experienceName:'Experiência Fluxo Completo',
  status:'waiting', position:1, queueOrder:'1', serviceSession:null});
function memory() {
  const values = new Map();
  const actions = [];
  return { values, actions,
    async get(user) { actions.push('get'); return values.get(user) ?? null; },
    async set(intent) { actions.push('set'); values.set(intent.userId, intent); },
    async clear(user, expectedKey) {
      actions.push('clear'); if (values.get(user)?.key === expectedKey) values.delete(user);
    },
  };
}

test('leitura: usa endpoints autenticados e preserva fila real', async () => {
  const { fetchArenaState } = await service;
  const paths = [];
  const client = { async get(path, opts) {
    paths.push([path, opts]);
    return path.endsWith('/queue') ? queue(waiting()) : catalog();
  } };
  const result = await fetchArenaState(client, context);
  assert.equal(result.currentQueueEntry.position, 1);
  assert.equal(result.currentQueueEntry.status, 'waiting');
  assert.equal(result.experiences[0].name, 'Experiência Fluxo Completo');
  assert.deepEqual(paths, [
    [`/events/${eventId}/experiences`, {auth: true}],
    [`/participations/${participationId}/queue`, {auth: true}],
  ]);
});

test('leitura: chamada real informa estação e impede posição simulada', async () => {
  const { parseArenaQueue } = await service;
  const called = {...waiting(), status:'called', position:null, serviceSession: {
    id:'d87bacf1-4e38-4528-9f5a-f02afe4df39b', status:'pending', station: {
      id:'892e9f40-d56a-464b-a6d4-aac44cbbb1fd', label:'Estação Real' }}};
  const parsed = parseArenaQueue(queue(called), participationId);
  assert.equal(parsed.status, 'called');
  assert.equal(parsed.position, null);
  assert.equal(parsed.stationLabel, 'Estação Real');
});

test('rejeita estado malformado, não inventa posições ou experiências', async () => {
  const { parseArenaQueue, parseArenaExperiences } = await service;
  assert.throws(() => parseArenaQueue(queue({...waiting(), position:0}), participationId), /inválid/);
  assert.throws(() => parseArenaExperiences({...catalog(), experiences:[{id: experienceId}]}, eventId), /inválid/);
});

test('entrada real: persiste chave antes do POST e reconcilia pelo GET', async () => {
  const { createArenaQueueCoordinator } = await service;
  const storage = memory();
  let entry = null;
  const log = [];
  const client = {
    async get(path) { log.push('GET'); return path.endsWith('/queue') ? queue(entry) : catalog(); },
    async post(path, body, opts) {
      log.push('POST'); assert.equal(storage.values.get(userId)?.key, key);
      assert.equal(path, `/participations/${participationId}/queue-entries`);
      assert.deepEqual(body, {experienceId});
      assert.equal(opts.headers['Idempotency-Key'], key);
      entry = waiting();
      return { queueEntryId: entryId }; // Formato possivelmente diferente, reconciliação via GET.
    },
  };
  const coordinator = createArenaQueueCoordinator({ client, storage, createKey: () => key });
  const result = await coordinator.join(context, experienceId);
  assert.equal(result.kind, 'confirmed');
  assert.equal(result.state.currentQueueEntry.id, entryId);
  assert.equal(storage.values.size, 0);
  assert.ok(log.indexOf('POST') > log.indexOf('GET'));
  assert.ok(storage.actions.indexOf('set') < storage.actions.indexOf('clear'));
});

test('não faz POST se a fila já está ativa', async () => {
  const { createArenaQueueCoordinator } = await service;
  const client = {
    async get(path) { return path.endsWith('/queue') ? queue(waiting()) : catalog(); },
    async post() { assert.fail('POST não esperado'); },
  };
  const result = await createArenaQueueCoordinator({client, storage:memory(),createKey:()=>key}).join(context, experienceId);
  assert.equal(result.kind, 'already');
});

test('timeout mantém intenção persistida e retry usa a mesma chave', async () => {
  const { createArenaQueueCoordinator } = await service;
  const storage = memory();
  const keys = [];
  let callCount = 0;
  let entry = null;
  const client = {
    async get(path) {return path.endsWith('/queue') ? queue(entry) : catalog();},
    async post(path, body, options) {
      keys.push(options.headers['Idempotency-Key']);
      callCount++;
      if (callCount === 1) {const error=new Error('timeout'); error.isTimeout=true; throw error;}
      entry = waiting();
      return {};
    },
  };
  const manager = createArenaQueueCoordinator({client,storage,createKey:()=>key});
  const first = await manager.join(context,experienceId);
  assert.equal(first.kind, 'unconfirmed');
  assert.equal(storage.values.get(userId).key,key);
  const second = await manager.join(context,experienceId);
  assert.equal(second.kind, 'confirmed');
  assert.deepEqual(keys,[key,key]);
  assert.equal(storage.values.size,0);
});

test('intenção pendente de outra experiência bloqueia segunda operação', async () => {
  const { createArenaQueueCoordinator } = await service;
  const storage = memory();
  await storage.set({ userId, participationId, experienceId,
    key });
  const other='40000000-0000-4000-8000-000000000001';
  const client={
    async get(path) {return path.endsWith('/queue') ? queue() : {...catalog(),
      experiences:[...catalog().experiences,{id:other,name:'Outra',waitingCount:0,acceptingNewQueueEntries:true}]};},
    async post(){assert.fail('Não enviar outra operação');},
  };
  const result=await createArenaQueueCoordinator({client,storage,createKey:()=>other}).join(context,other);
  assert.equal(result.kind,'pending_other');
  assert.equal(storage.values.get(userId).key,key);
});

test('sessão alterada impede POST após leituras', async () => {
  const { createArenaQueueCoordinator } = await service;
  const storage=memory();
  let alive=true;
  const client={ async get(path){alive=false;return path.endsWith('/queue')?queue():catalog();},
    async post(){assert.fail('POST após troca de sessão');} };
  const manager=createArenaQueueCoordinator({client,storage,createKey:()=>key,isCurrent:()=>alive});
  await assert.rejects(manager.join(context,experienceId),/sessão foi alterada/);
  assert.equal(storage.values.size,0);
});
