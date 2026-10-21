/**
 * Situação das avaliações das participações (aba Eventos).
 *
 * A elegibilidade e o prazo NÃO são calculados aqui: vêm prontos na projeção
 * `participation.evaluation = { eligible, submitted, pending }`, como no
 * histórico proposto em docs (GET /participations/history), em que o backend
 * deriva esses valores e nunca envia `pending: true` depois do prazo de 30 dias.
 * A nota e o comentário ficam em registros separados, ligados pelo
 * `participationId` (no máximo uma avaliação por participação, D08).
 */

export const EVALUATION_SITUATIONS = Object.freeze({
  PENDING: 'pending',
  EVALUATED: 'evaluated',
  EXPIRED: 'expired',
  NOT_FINISHED: 'not_finished',
  NOT_ELIGIBLE: 'not_eligible',
  INVALID: 'invalid',
  UNAVAILABLE: 'unavailable',
});

const ONGOING_STATUSES = ['waiting', 'active'];
const TERMINAL_STATUSES = ['finished', 'canceled'];

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function ownString(value, key) {
  return isObject(value) && hasOwn(value, key) && typeof value[key] === 'string' && value[key] !== ''
    ? value[key]
    : null;
}

function ownBoolean(value, key) {
  return isObject(value) && hasOwn(value, key) && typeof value[key] === 'boolean' ? value[key] : null;
}

/**
 * Situação da avaliação de uma participação, lida dos dados recebidos.
 *
 * - `waiting`/`active`: ainda não finalizada, nunca pendente.
 * - finalizada sem projeção de avaliação: informação indisponível.
 * - projeção incompleta ou contraditória: inválida (não se presume nada).
 * - `submitted`: avaliada; `pending`: pendente; elegível sem envio e sem
 *   pendência: prazo de primeira avaliação encerrado; não elegível: sem avaliação.
 *
 * @param {object} participation
 * @returns {string} um dos valores de EVALUATION_SITUATIONS
 */
export function getEvaluationSituation(participation) {
  if (!ownString(participation, 'id')) {
    return EVALUATION_SITUATIONS.UNAVAILABLE;
  }

  const status = ownString(participation, 'status');
  if (ONGOING_STATUSES.includes(status)) {
    return EVALUATION_SITUATIONS.NOT_FINISHED;
  }
  if (!TERMINAL_STATUSES.includes(status) || !hasOwn(participation, 'evaluation') || !isObject(participation.evaluation)) {
    return EVALUATION_SITUATIONS.UNAVAILABLE;
  }

  const eligible = ownBoolean(participation.evaluation, 'eligible');
  const submitted = ownBoolean(participation.evaluation, 'submitted');
  const pending = ownBoolean(participation.evaluation, 'pending');
  const incomplete = eligible === null || submitted === null || pending === null;

  if (
    incomplete
    || (!eligible && (submitted || pending))
    || (submitted && pending)
    || (status === 'canceled' && eligible)
  ) {
    return EVALUATION_SITUATIONS.INVALID;
  }

  if (submitted) {
    return EVALUATION_SITUATIONS.EVALUATED;
  }
  if (pending) {
    return EVALUATION_SITUATIONS.PENDING;
  }
  return eligible ? EVALUATION_SITUATIONS.EXPIRED : EVALUATION_SITUATIONS.NOT_ELIGIBLE;
}

/**
 * Avaliação registrada para a participação, encontrada pelo `participationId`.
 * Registros sem `participationId` próprio são ignorados; mais de um registro
 * para a mesma participação, ou nota fora de 1 a 5, tornam o dado inválido.
 * Comentário vazio ou ausente é tratado como ausente (null), sem inventar texto.
 *
 * @param {Array<object>} evaluations
 * @param {string} participationId
 * @returns {{ rating: number, comment: string|null }|null} null quando não há
 *   avaliação válida para exibir
 */
export function findEvaluationByParticipationId(evaluations, participationId) {
  if (!Array.isArray(evaluations) || typeof participationId !== 'string' || participationId === '') {
    return null;
  }

  const matches = evaluations.filter((evaluation) => ownString(evaluation, 'participationId') === participationId);
  if (matches.length !== 1) {
    return null;
  }

  const [evaluation] = matches;
  const rating = hasOwn(evaluation, 'rating') ? evaluation.rating : null;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return null;
  }

  const comment = ownString(evaluation, 'comment');
  return { rating, comment: comment && comment.trim() !== '' ? comment : null };
}

/**
 * Participações com avaliação pendente, na ordem recebida e sem repetir o
 * mesmo `participationId`. Participações distintas do mesmo evento continuam
 * separadas, pois cada uma tem seu próprio ID.
 *
 * @param {Array<object>} participations
 * @returns {Array<object>}
 */
export function getPendingEvaluationParticipations(participations) {
  if (!Array.isArray(participations)) {
    return [];
  }

  const seen = new Set();
  return participations.filter((participation) => {
    if (getEvaluationSituation(participation) !== EVALUATION_SITUATIONS.PENDING || seen.has(participation.id)) {
      return false;
    }
    seen.add(participation.id);
    return true;
  });
}
