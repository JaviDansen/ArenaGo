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

/** Lê a participação mais recente (primeira página do histórico, ordenada pelo servidor). */
export async function loadRecentParticipation(client, { fetchHistory, isCurrent = () => true }) {
  const page = await fetchHistory(client, { limit: 1 });
  if (!isCurrent()) return undefined;
  return page.items[0] ?? null;
}

/**
 * Estado da avaliação pendente derivável sem nova leitura: 0 ou várias pendências vêm do
 * `return-state` do servidor; uma única precisa ser confirmada (elegibilidade + histórico).
 */
export function initialPendingState(pendingIds) {
  if (pendingIds.length === 0) return { status: 'none', item: null, count: 0, error: null };
  if (pendingIds.length > 1) return { status: 'multiple', item: null, count: pendingIds.length, error: null };
  return { status: 'checking', item: null, count: 1, error: null };
}

/**
 * Confirma a pendência única. `null` do serviço = já enviada, expirada ou inelegível (ausência
 * confirmada). Falhas são propagadas: o chamador não pode tratá-las como ausência.
 */
export async function confirmSinglePending(client, participationId, { fetchPendingItem, isCurrent = () => true }) {
  const item = await fetchPendingItem(client, participationId, { isCurrent });
  if (!isCurrent()) return undefined;
  return item ? { status: 'single', item, count: 1, error: null } : { status: 'none', item: null, count: 0, error: null };
}

export function describeRecentParticipation(item) {
  if (!item) return null;
  // O histórico não traz período/fuso do evento: o horário exibido é o da própria participação.
  const when = formatInstantParts(item.arenaEnteredAt ?? item.joinedAt);
  const timeLabel = item.arenaEnteredAt ? 'Sua entrada na Arena' : 'Seu ingresso';
  const status = STATUS_PRESENTATION[item.status] ?? { label: 'Situação indisponível', variant: 'default' };
  return {
    participationId: item.participationId,
    eventName: item.event.name,
    date: when?.date ?? null,
    time: when?.time ?? null,
    timeLabel,
    statusLabel: status.label,
    statusVariant: status.variant,
  };
}

export function describePendingEvaluation(pending, recent) {
  const status = pending?.status;
  if (status === 'multiple') {
    return {
      kind: 'multiple',
      actionable: true,
      text: `Você tem ${pending.count} avaliações pendentes. Escolha qual participação deseja avaliar.`,
    };
  }
  if (status === 'single' && pending.item) {
    const isRecent = recent?.participationId === pending.item.participationId;
    return {
      kind: 'single',
      actionable: true,
      item: pending.item,
      text: isRecent
        ? 'Você ainda pode avaliar sua participação no último evento.'
        : `Você ainda pode avaliar sua participação em ${pending.item.event.name}.`,
    };
  }
  if (status === 'checking') {
    return { kind: 'checking', actionable: false, text: 'Verificando se há avaliação pendente...' };
  }
  if (status === 'error') {
    return {
      kind: 'error',
      actionable: false,
      text: 'Não foi possível verificar sua avaliação pendente agora.',
    };
  }
  return null;
}
