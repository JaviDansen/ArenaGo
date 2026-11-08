/** Erro de domínio lançado quando um código de ingresso viola a regra C-10. */
export class EventAccessCodeValidationError extends Error {
  constructor() {
    super("O código do evento deve ter de 4 a 64 caracteres ASCII alfanuméricos, com hífens apenas entre grupos.");
    this.name = "EventAccessCodeValidationError";
  }
}

/**
 * Valida e converte um código de ingresso para a forma canônica usada no backend.
 *
 * @param accessCode Código informado para consulta ou, futuramente, criação de evento.
 * @returns Código ASCII em maiúsculas, sem whitespace externo.
 * @throws EventAccessCodeValidationError Se o tamanho, alfabeto ou posição dos hífens for inválido.
 * @remarks A validação ASCII ocorre antes de `toUpperCase()` para impedir expansões Unicode
 * como `ß` → `SS`. Criação e consulta devem compartilhar esta função para usar uma só chave.
 */
export function normalizeEventAccessCode(accessCode: string): string {
  const trimmed = accessCode.trim();

  if (trimmed.length < 4 || trimmed.length > 64) {
    throw new EventAccessCodeValidationError();
  }

  // O padrão permite grupos ASCII alfanuméricos separados por um único hífen.
  if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(trimmed)) {
    throw new EventAccessCodeValidationError();
  }

  return trimmed.toUpperCase();
}
