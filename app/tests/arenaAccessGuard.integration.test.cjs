const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const gate = import(pathToFileURL(path.join(__dirname, '..', 'services', 'arenaAccessGuard.js')).href);
const eventId = 'e10da075-c6cb-4fd6-ba97-7b52403ebff8';
const participationId = 'c79b25f1-b171-487f-9fee-a24d184054b5';
const experienceId = '63c7bb39-618d-4859-a851-f0ef7cbeaa6b';
const context = { eventId, participationId };
const current = (status = 'active', props = {}) => ({ participation: { id: participationId, eventId, status, ...props } });
const catalog = () => ({ eventId, acceptingNewQueueEntries: false,
  experiences: [{ id: experienceId, name: 'Experiencia Fluxo Completo', waitingCount: 0,
    acceptingNewQueueEntries: false }] });
const queue = () => ({ participationId, currentQueueEntry: null });

test('participação encerrada não consulta experiências ou fila interna', async () => {
  const { fetchArenaStateIfActive } = await gate;
  const calls = [];
  const client = { async get(uri, options) {
    calls.push([uri, options]);
    if (uri !== '/participations/current') throw new Error('GET indevido após finalização');
    return { participation: null };
  } };
  const result = await fetchArenaStateIfActive(client, context);
  assert.deepEqual(result, { kind: 'no_current_participation', participation: null, state: null });
  assert.deepEqual(calls, [['/participations/current', {auth:true}]]);
});

test('fila externa não acessa Arena interna', async () => {
  const { fetchArenaStateIfActive } = await gate;
  const paths = [];
  const result = await fetchArenaStateIfActive({async get(uri) {paths.push(uri);return current('waiting');}}, context);
  assert.equal(result.kind, 'external_waiting');
  assert.equal(result.state, null);
  assert.deepEqual(paths, ['/participations/current']);
});

test('participação corrente de outro evento não vaza catálogo', async () => {
  const { fetchArenaStateIfActive } = await gate;
  let n=0;
  const result = await fetchArenaStateIfActive({async get() {n++; return current('active', {
    eventId:'550e8400-e29b-41d4-a716-446655440101'});}}, context);
  assert.equal(result.kind, 'different_current_participation');
  assert.equal(n, 1);
});

test('participação ativa consulta catálogo e fila autenticados', async () => {
  const { fetchArenaStateIfActive } = await gate;
  const calls=[];
  const client={async get(uri, options) {calls.push([uri, options]);
    if(uri==='/participations/current') return current();
    if(uri===`/events/${eventId}/experiences`)return catalog();
    if(uri===`/participations/${participationId}/queue`)return queue();
    throw new Error('Rota inesperada');
  }};
  const result = await fetchArenaStateIfActive(client,context);
  assert.equal(result.kind,'active');
  assert.equal(result.state.experiences[0].id,experienceId);
  assert.equal(result.state.currentQueueEntry,null);
  assert.deepEqual(calls.map(([uri])=>uri), [
    '/participations/current', `/events/${eventId}/experiences`,
    `/participations/${participationId}/queue`]);
  assert.ok(calls.every(([,opt])=>opt?.auth===true));
});

test('ausência de contrato ou IDs inválidos bloqueiam as leituras', async () => {
  const { fetchArenaStateIfActive, classifyCurrentArenaParticipation } = await gate;
  assert.throws(()=>classifyCurrentArenaParticipation({},context),/inválida/);
  assert.throws(()=>classifyCurrentArenaParticipation({participation:{id:participationId,eventId,status:'finished'}},context),/inválida/);
  const client={async get(){assert.fail('Não consultar com IDs inválidos');}};
  await assert.rejects(fetchArenaStateIfActive(client,{...context,eventId:'errado'}),/inválidos/);
});

test('logout após leitura de participação impede acesso ao catálogo', async () => {
  const { fetchArenaStateIfActive }=await gate;
  let alive=true;
  const paths=[];
  const client={async get(uri){paths.push(uri);alive=false;return current();}};
  await assert.rejects(fetchArenaStateIfActive(client,context,{isCurrent:()=>alive}),/Sessão alterada/);
  assert.deepEqual(paths,['/participations/current']);
});

test('logout durante leitura de catálogo invalida resultado tardio', async () => {
  const { fetchArenaStateIfActive }=await gate;
  let alive=true;
  const client={async get(uri){
    if(uri==='/participations/current')return current();
    if(uri.includes('/experiences')){alive=false;return catalog();}
    return queue();
  }};
  await assert.rejects(fetchArenaStateIfActive(client,context,{isCurrent:()=>alive}),/Sessão alterada/);
});

test('HTTP 404 com participação ativa é propagado, não tratado como encerramento', async () => {
  const { fetchArenaStateIfActive } = await gate;
  const notFound = Object.assign(new Error('404'), { status:404 });
  const client={async get(uri){if(uri==='/participations/current')return current();
    if(uri.includes('/experiences'))throw notFound;
    return queue();}};
  await assert.rejects(fetchArenaStateIfActive(client,context),(e)=>e===notFound);
});

test('somente operações GET são executadas', async () => {
  const { fetchArenaStateIfActive }=await gate;
  const client={async get(uri){return uri==='/participations/current'?current():uri.endsWith('/queue')?queue():catalog();},
    async post(){assert.fail('POST não permitido');}, async patch(){assert.fail('PATCH não permitido');}};
  assert.equal((await fetchArenaStateIfActive(client,context)).kind,'active');
});
