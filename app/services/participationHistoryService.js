/** Leitura do histórico real do ArenaGo. Não cria ou altera participações. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS = new Set(['waiting', 'active', 'finished', 'canceled']);

function validInstant(value) {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

export function validateHistoryItem(item) {
  return Boolean(
    item && typeof item === 'object' && !Array.isArray(item)
    && UUID.test(item.participationId)
    && item.event && UUID.test(item.event.id)
    && typeof item.event.name === 'string'
    && item.event.name.trim().length > 0
    && STATUS.has(item.status)
    && typeof item.joinedAt === 'string' && validInstant(item.joinedAt)
    && validInstant(item.arenaEnteredAt)
    && validInstant(item.finishedAt)
    && Number.isSafeInteger(item.completedServicesCount)
    && item.completedServicesCount >= 0
    && item.evaluation && typeof item.evaluation.eligible === 'boolean'
    && typeof item.evaluation.submitted === 'boolean'
    && typeof item.evaluation.pending === 'boolean'
  );
}

export function parseHistoryResponse(body) {
  if (!body || !Array.isArray(body.items)
      || !(body.nextCursor === null || (typeof body.nextCursor === 'string' && body.nextCursor.length > 0))
      || !body.items.every(validateHistoryItem)) {
    throw new Error('O servidor retornou um histórico de participações inválido.');
  }
  const seen = new Set();
  const items = body.items.filter(item => {
    if (seen.has(item.participationId)) return false;
    seen.add(item.participationId);
    return true;
  });
  return { items, nextCursor: body.nextCursor };
}

export function mergeHistoryItems(previous, incoming) {
  const unique = new Map();
  for (const item of [...previous, ...incoming]) {
    if (!unique.has(item.participationId)) unique.set(item.participationId, item);
  }
  return Array.from(unique.values());
}

export function toParticipationCardItem(item) {
  return {
    ...item,
    id: item.participationId,
    enteredAt: item.arenaEnteredAt ?? item.joinedAt,
    exitedAt: item.finishedAt,
  };
}

export async function fetchParticipationHistory(client, { limit = 20, cursor = null } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('Limite do histórico inválido.');
  }
  const query = `?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  return parseHistoryResponse(await client.get(`/participations/history${query}`, { auth: true }));
}

export async function fetchParticipationEvaluation(client, participationId) {
  if (!UUID.test(participationId)) throw new Error('Identificador de participação inválido.');
  const body = await client.get(`/participations/${participationId}/evaluation`, { auth: true });
  const evaluation = body?.evaluation;
  if (!evaluation || evaluation.participationId !== participationId || !UUID.test(evaluation.id)
      || !Number.isInteger(evaluation.rating) || evaluation.rating < 1 || evaluation.rating > 5
      || !(evaluation.comment === null || typeof evaluation.comment === 'string')) {
    throw new Error('O servidor retornou uma avaliação inválida.');
  }
  return evaluation;
}
