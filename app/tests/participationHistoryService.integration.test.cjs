const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const service = import(pathToFileURL(path.join(__dirname, '..', 'services', 'participationHistoryService.js')).href);

const ID = 'c79b25f1-b171-487f-9fee-a24d184054b5';
const EVENT_ID = 'e10da075-c6cb-4fd6-ba97-7b52403ebff8';
const EVAL_ID = '886c0487-5710-427a-a6ba-a5b1d2b01d72';
const historyItem = {
  participationId: ID,
  event: { id: EVENT_ID, name: 'ArenaGo - Teste Imediato' },
  status: 'finished',
  joinedAt: '2026-11-07T21:20:39.940000Z',
  arenaEnteredAt: '2026-11-07T21:20:39.940000Z',
  finishedAt: '2026-11-07T21:27:36.097197Z',
  finishReason: 'voluntary',
  completedServicesCount: 1,
  evaluation: { eligible: true, submitted: true, pending: false },
};

test('historico real preserva ID, status e avaliacao', async () => {
  const { parseHistoryResponse, toParticipationCardItem } = await service;
  const result = parseHistoryResponse({ items: [historyItem], nextCursor: null });
  assert.equal(result.items.length, 1);
  const card = toParticipationCardItem(result.items[0]);
  assert.equal(card.id, ID);
  assert.equal(card.event.name, 'ArenaGo - Teste Imediato');
  assert.equal(card.evaluation.submitted, true);
  assert.equal(card.exitedAt, historyItem.finishedAt);
});

test('leitura autenticada usa cursor codificado e nao escreve', async () => {
  const { fetchParticipationHistory } = await service;
  const calls = [];
  const client = { get(path, options) {
    calls.push([path, options]);
    return Promise.resolve({ items: [historyItem], nextCursor: null });
  } };
  await fetchParticipationHistory(client, { limit: 10, cursor: 'a+/=bc' });
  assert.deepEqual(calls, [['/participations/history?limit=10&cursor=a%2B%2F%3Dbc', { auth: true }]]);
});

test('nao aceita historico malformado nem cria dados ficticios', async () => {
  const { parseHistoryResponse } = await service;
  assert.throws(() => parseHistoryResponse({ items: [{}], nextCursor: null }), /inválido/);
  assert.throws(() => parseHistoryResponse({ items: [historyItem], nextCursor: undefined }), /inválido/);
  assert.deepEqual(parseHistoryResponse({ items: [], nextCursor: null }).items, []);
});

test('paginacao remove repeticoes por ID, sem misturar participacoes', async () => {
  const { mergeHistoryItems } = await service;
  const next = { ...historyItem, participationId: '00000000-0000-4000-8000-000000000001' };
  const result = mergeHistoryItems([historyItem], [historyItem, next]);
  assert.deepEqual(result.map(p => p.participationId), [ID, next.participationId]);
});

test('consulta avaliacao autentica e valida participacao', async () => {
  const { fetchParticipationEvaluation } = await service;
  const client = { get(path, options) {
    assert.equal(path, `/participations/${ID}/evaluation`);
    assert.deepEqual(options, { auth: true });
    return Promise.resolve({ evaluation: { id: EVAL_ID, participationId: ID, rating: 5, comment: null } });
  } };
  const answer = await fetchParticipationEvaluation(client, ID);
  assert.equal(answer.rating, 5);
  await assert.rejects(() => fetchParticipationEvaluation(client, 'invalid'), /inválido/);
});


test('horarios PostgreSQL com seis casas permitem calcular permanencia', async () => {
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  const utils = await import(pathToFileURL(path.join(__dirname, '..', 'utils', 'participation.js')).href);
  const card = { enteredAt: '2026-11-07T21:20:39.940000Z', exitedAt: '2026-11-07T21:27:36.097197Z' };
  assert.equal(utils.getStayDurationInMinutes(card), 7);
});

test('avaliação após saída usa elegibilidade e encontra o item real mesmo em outra página', async () => {
  const { fetchPendingEvaluationHistoryItem } = await service;
  const pendingItem = { ...historyItem, evaluation: { eligible: true, submitted: false, pending: true } };
  const calls = [];
  const client = { async get(path, options) {
    calls.push([path, options]);
    if (path.endsWith('/evaluation-eligibility')) return { participationId: ID, eligible: true, submitted: false, pending: true };
    if (path === '/participations/history?limit=50') return { items: [], nextCursor: 'page+2' };
    return { items: [pendingItem], nextCursor: null };
  } };
  assert.equal(await fetchPendingEvaluationHistoryItem(client, ID), pendingItem);
  assert.deepEqual(calls.map(call => call[0]), [
    `/participations/${ID}/evaluation-eligibility`, '/participations/history?limit=50',
    '/participations/history?limit=50&cursor=page%2B2',
  ]);
  assert.ok(calls.every(call => call[1].auth === true));
});

test('não abre avaliação enviada, não elegível, expirada ou inconsistente no histórico', async () => {
  const { fetchPendingEvaluationHistoryItem } = await service;
  for (const evaluation of [
    { eligible: true, submitted: true, pending: false },
    { eligible: false, submitted: false, pending: false },
    { eligible: true, submitted: false, pending: false },
  ]) {
    let calls = 0;
    const client = { async get() { calls += 1; return { participationId: ID, ...evaluation }; } };
    assert.equal(await fetchPendingEvaluationHistoryItem(client, ID), null);
    assert.equal(calls, 1);
  }
  const client = { async get(path) {
    if (path.endsWith('/evaluation-eligibility')) return { participationId: ID, eligible: true, submitted: false, pending: true };
    return { items: [historyItem], nextCursor: null };
  } };
  assert.equal(await fetchPendingEvaluationHistoryItem(client, ID), null);
});

test('falhas, cursores repetidos e troca de sessão não geram item de avaliação', async () => {
  const { fetchPendingEvaluationHistoryItem } = await service;
  const eligibility = { participationId: ID, eligible: true, submitted: false, pending: true };
  await assert.rejects(() => fetchPendingEvaluationHistoryItem({ get: async () => { throw new Error('rede'); } }, ID), /rede/);
  await assert.rejects(() => fetchPendingEvaluationHistoryItem({ get: async path => {
    if (path.endsWith('/evaluation-eligibility')) return eligibility;
    throw new Error('histórico indisponível');
  } }, ID), /histórico indisponível/);
  await assert.rejects(() => fetchPendingEvaluationHistoryItem({ get: async () => ({ ...eligibility, participationId: EVENT_ID }) }, ID), /elegibilidade inválida/);
  await assert.rejects(() => fetchPendingEvaluationHistoryItem({ get: async path => path.endsWith('/evaluation-eligibility')
    ? eligibility : { items: [], nextCursor: 'same' } }, ID), /cursor/);
  let current = true;
  let calls = 0;
  const client = { async get() { calls += 1; current = false; return eligibility; } };
  assert.equal(await fetchPendingEvaluationHistoryItem(client, ID, { isCurrent: () => current }), null);
  assert.equal(calls, 1);
});

const recentItem = { ...historyItem, finishReason: 'automatic_operational_deadline',
  evaluation: { eligible: true, submitted: false, pending: true } };
const returnState = { recentFinalization: { participationId: ID, eventId: EVENT_ID,
  finishReason: recentItem.finishReason, finishedAt: recentItem.finishedAt }, pendingEvaluationParticipationIds: [ID] };

test('retomada correlaciona finalização e pendência, revalida elegibilidade e pagina histórico', async () => {
  const { fetchReturnEvaluationHistoryItem } = await service;
  const calls = [];
  const client = { async get(path, options) {
    assert.equal(options.auth, true); calls.push(path);
    if (path.endsWith('/evaluation-eligibility')) return { participationId: ID, ...recentItem.evaluation };
    if (path.endsWith('limit=50')) return { items: [{ ...historyItem, participationId: EVAL_ID }], nextCursor: 'next' };
    return { items: [recentItem], nextCursor: null };
  } };
  // A primeira página representa outra participação; não escolher a primeira pendência.
  assert.equal(await fetchReturnEvaluationHistoryItem(client, returnState), recentItem);
  assert.equal(calls.length, 3);
});

test('retomada não escolhe avaliação antiga nem consulta sem finalização recente', async () => {
  const { fetchReturnEvaluationHistoryItem } = await service;
  const client = { get() { assert.fail('Não deve buscar outra pendência.'); } };
  assert.equal(await fetchReturnEvaluationHistoryItem(client, { recentFinalization: null, pendingEvaluationParticipationIds: [ID] }), null);
  assert.equal(await fetchReturnEvaluationHistoryItem(client, { ...returnState, pendingEvaluationParticipationIds: [EVAL_ID] }), null);
});

test('retomada recusa finalização inválida e histórico de outro evento, instante ou motivo', async () => {
  const { fetchReturnEvaluationHistoryItem } = await service;
  for (const recentFinalization of [false, {}, { ...returnState.recentFinalization, finishReason: 'voluntary' },
    { ...returnState.recentFinalization, finishedAt: 'invalid' }]) {
    await assert.rejects(() => fetchReturnEvaluationHistoryItem({}, { ...returnState, recentFinalization }), /inválida/);
  }
  for (const item of [
    { ...recentItem, event: { id: EVAL_ID, name: 'Outro evento' } },
    { ...recentItem, finishedAt: '2026-11-07T21:28:00.000000Z' },
    { ...recentItem, finishReason: 'voluntary' }, { ...recentItem, completedServicesCount: 0 },
  ]) {
    const client = { get: async path => path.endsWith('/evaluation-eligibility')
      ? { participationId: ID, ...recentItem.evaluation } : { items: [item], nextCursor: null } };
    await assert.rejects(() => fetchReturnEvaluationHistoryItem(client, returnState), /não confirmou/);
  }
});

test('retomada respeita ausência de conclusão, envio anterior e prazo expirado no servidor', async () => {
  const { fetchReturnEvaluationHistoryItem } = await service;
  for (const evaluation of [
    { eligible: false, submitted: false, pending: false },
    { eligible: true, submitted: true, pending: false },
    { eligible: true, submitted: false, pending: false },
  ]) {
    let calls = 0;
    assert.equal(await fetchReturnEvaluationHistoryItem({ get: async () => {
      calls += 1; return { participationId: ID, ...evaluation };
    } }, returnState), null);
    assert.equal(calls, 1);
  }
});
