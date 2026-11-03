/** Configuração técnica explícita; não implementa retenção nem expurgo. */
export function parseOperationIdempotencyTtl(raw: string | undefined, variable: string): number {
  const value = raw?.trim();
  const seconds = Number(value);
  if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(seconds) || seconds <= 0
    || !Number.isSafeInteger(seconds * 1000) || !Number.isFinite(new Date(Date.now() + seconds * 1000).getTime())) {
    throw new Error(`${variable} é obrigatório e deve conter um inteiro positivo compatível com Date.`);
  }
  return seconds * 1000;
}
