/**
 * Regras da Home do Participante: histórico recente e avaliação pendente.
 * Todos os dados vêm do backend; nada aqui cria ou altera participações.
 */
import { formatInstantParts } from './eventTime.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_PRESENTATION = {
  waiting: { label: 'Aguardando entrada', variant: 'brand' },
  active: { label: 'Em andamento', variant: 'success' },
  finished: { label: 'Encerrada', variant: 'default' },
  canceled: { label: 'Cancelada', variant: 'danger' },
};

export function pendingEvaluationIds(returnState) {
  const ids = returnState?.pendingEvaluationParticipationIds;
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter(id => typeof id === 'string' && UUID.test(id)))];
}

/**
 * Lê a participação mais recente e confirma a pendência indicada pelo servidor.
 * Uma pendência única só é oferecida depois de confirmada por elegibilidade e histórico;
 * várias pendências seguem a política existente (lista na aba Eventos).
 * Falha na confirmação da pendência não esconde o histórico, apenas o card.
 */
export async function loadHomeOverview(client, {
  pendingIds = [], isCurrent = () => true, fetchHistory, fetchPendingItem,
}) {
  const page = await fetchHistory(client, { limit: 1 });
  if (!isCurrent()) return null;
  const recent = page.items[0] ?? null;

  let pending = null;
  if (pendingIds.length === 1) {
    try {
      const item = await fetchPendingItem(client, pendingIds[0], { isCurrent });
      if (!isCurrent()) return null;
      if (item) pending = { kind: 'single', item };
    } catch {
      if (!isCurrent()) return null;
    }
  } else if (pendingIds.length > 1) {
    pending = { kind: 'multiple', count: pendingIds.length };
  }
  return { recent, pending };
}

export function describeRecentParticipation(item) {
  if (!item) return null;
  const when = formatInstantParts(item.arenaEnteredAt ?? item.joinedAt);
  const status = STATUS_PRESENTATION[item.status] ?? { label: 'Situação indisponível', variant: 'default' };
  return {
    participationId: item.participationId,
    eventName: item.event.name,
    date: when?.date ?? null,
    time: when?.time ?? null,
    statusLabel: status.label,
    statusVariant: status.variant,
  };
}

export function describePendingEvaluation(pending, recent) {
  if (!pending) return null;
  if (pending.kind === 'multiple') {
    return {
      kind: 'multiple',
      text: `Você tem ${pending.count} avaliações pendentes. Escolha qual participação deseja avaliar.`,
    };
  }
  const isRecent = recent?.participationId === pending.item.participationId;
  return {
    kind: 'single',
    item: pending.item,
    text: isRecent
      ? 'Você ainda pode avaliar sua participação no último evento.'
      : `Você ainda pode avaliar sua participação em ${pending.item.event.name}.`,
  };
}
