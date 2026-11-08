/**
 * Porta de leitura para a Arena interna: verifica a participação CORRENTE na API
 * antes de consultar experiências/fila. Não escreve no backend e não renderiza telas.
 *
 * Os estados terminais não aparecem em GET /participations/current: use histórico
 * e avaliações para visualizar uma participação finalizada.
 */
import { fetchArenaState } from './arenaQueueService.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId = (value) => typeof value === 'string' && UUID.test(value);

function contextValid({ eventId, participationId } = {}) {
  if (!validId(eventId) || !validId(participationId)) {
    throw new Error('Identificadores de Arena inválidos.');
  }
}

/**
 * Resultados intencionais: active, no_current_participation,
 * external_waiting, different_current_participation.
 * Nunca transforma ausência em um status terminal presumido.
 */
export function classifyCurrentArenaParticipation(response, context) {
  contextValid(context);
  if (!response || typeof response !== 'object' || Array.isArray(response)
      || !Object.prototype.hasOwnProperty.call(response, 'participation')) {
    throw new Error('Resposta de participação corrente inválida.');
  }

  const current = response.participation;
  if (current === null) {
    return { kind: 'no_current_participation', participation: null, state: null };
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)
      || !validId(current.id) || !validId(current.eventId)
      || !['waiting', 'active'].includes(current.status)) {
    throw new Error('Participação corrente inválida.');
  }

  const participation = { id: current.id, eventId: current.eventId, status: current.status };
  if (current.id !== context.participationId || current.eventId !== context.eventId) {
    return { kind: 'different_current_participation', participation, state: null };
  }
  if (current.status === 'waiting') {
    return { kind: 'external_waiting', participation, state: null };
  }
  return { kind: 'active', participation, state: null };
}

/**
 * Só consulta o catálogo e a fila interna depois de confirmar participação ativa
 * E correspondente ao evento esperado. O backend ainda é a autoridade final.
 *
 * isCurrent permite impedir uma resposta tardia após logout/troca de sessão.
 * HTTP 404 após um GET current ativo é propagado: pode ser rota ausente,
 * mudança concorrente de estado ou problema de autorização, não presumimos causa.
 */
export async function fetchArenaStateIfActive(client, context, { isCurrent = () => true } = {}) {
  contextValid(context);
  if (!client || typeof client.get !== 'function' || typeof isCurrent !== 'function') {
    throw new Error('Cliente ou proteção de sessão inválida.');
  }
  const assertSession = () => {
    if (!isCurrent()) throw new Error('Sessão alterada. Descarte esta leitura da Arena.');
  };
  assertSession();
  const current = await client.get('/participations/current', { auth: true });
  assertSession();
  const gate = classifyCurrentArenaParticipation(current, context);
  if (gate.kind !== 'active') return gate;
  const state = await fetchArenaState(client, context);
  assertSession();
  return { ...gate, state };
}
