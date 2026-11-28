/**
 * Textos da tela real da Arena (PARTICIPANTE-02A). Somente apresentação: os números vêm
 * sempre do servidor (já validados em `arenaQueueService`) e nada aqui é calculado ou inventado.
 */

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

/** "0 pessoas aguardando", "1 pessoa aguardando", "2 pessoas aguardando". */
export function formatWaitingCount(count) {
  if (!isCount(count)) return null;
  return `${count} ${count === 1 ? 'pessoa' : 'pessoas'} aguardando`;
}

/** Posição ordinal recebida do servidor ("1º", "12º"); nunca estimada. */
export function formatQueuePosition(position) {
  if (!Number.isSafeInteger(position) || position < 1) return null;
  return `${position}º`;
}

/** "1 experiência", "3 experiências". */
export function formatExperienceCount(count) {
  if (!isCount(count)) return null;
  return `${count} ${count === 1 ? 'experiência' : 'experiências'}`;
}
