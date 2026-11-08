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
