/**
 * Utilitários de exibição das participações (Minhas Participações).
 */

/**
 * Formata a data de uma participação como DD/MM/AAAA, a partir da data de
 * entrada (ISO 8601). Usa a própria data registrada, sem conversão de fuso.
 *
 * @param {string} isoDate
 * @returns {string|null} null quando a data não é válida
 */
export function formatParticipationDate(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') {
    return null;
  }
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/**
 * Tempo de permanência em minutos, calculado SOMENTE a partir da entrada e
 * da saída registradas. Sem saída registrada (ou com datas inválidas) não há
 * permanência válida: retorna null, sem estimar um valor.
 *
 * @param {{ enteredAt?: string|null, exitedAt?: string|null }} participation
 * @returns {number|null}
 */
export function getStayDurationInMinutes(participation) {
  const enteredAt = Date.parse(participation?.enteredAt ?? '');
  const exitedAt = Date.parse(participation?.exitedAt ?? '');

  if (Number.isNaN(enteredAt) || Number.isNaN(exitedAt) || exitedAt <= enteredAt) {
    return null;
  }
  return Math.round((exitedAt - enteredAt) / 60000);
}

/**
 * Formata minutos como "1h 42min", "45min" ou "2h".
 *
 * @param {number|null} minutes
 * @returns {string|null} null quando não há valor válido
 */
export function formatStayDuration(minutes) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) {
    return `${remainingMinutes}min`;
  }
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}min`;
}
