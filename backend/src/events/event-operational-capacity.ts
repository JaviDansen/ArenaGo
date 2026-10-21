/** Resultado consolidado da existência dos recursos operacionais mínimos do evento. */
export interface EventOperationalCapacityResult {
  hasAuthorizedStaff: boolean;
  hasAvailableStation: boolean;
  hasOperationalCapacity: boolean;
}

/**
 * Combina os dois critérios mínimos aprovados em C-05/C-14.
 *
 * @param hasAuthorizedStaff Indica concessão Staff vigente, com conta ativa e e-mail verificado.
 * @param hasAvailableStation Indica estação disponível em alguma experiência do evento.
 * @returns Os critérios individuais e se ambos estão satisfeitos.
 * @remarks Não avalia horários, prontidão completa, filas ou status, nem autoriza ingresso.
 */
export function buildEventOperationalCapacityResult(
  hasAuthorizedStaff: boolean,
  hasAvailableStation: boolean,
): EventOperationalCapacityResult {
  return {
    hasAuthorizedStaff,
    hasAvailableStation,
    hasOperationalCapacity: hasAuthorizedStaff && hasAvailableStation,
  };
}
