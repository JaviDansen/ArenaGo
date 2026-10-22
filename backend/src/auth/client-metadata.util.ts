import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import type { ClientMetadata } from "./auth.types";

export interface ClientMetadataSource extends IncomingMessage {
  ip?: string;
}

/**
 * Sanitiza e valida um endereço IP (IPv4 ou IPv6), removendo o prefixo IPv4-mapped
 * (`::ffff:`) quando aplicável e rejeitando qualquer valor que não seja um IP válido.
 */
export function sanitizeIpAddress(ip?: string | null): string | null {
  if (!ip || typeof ip !== "string") return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;

  const clean = trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
  if (isIP(clean) !== 0) {
    return clean;
  }
  if (isIP(trimmed) !== 0) {
    return trimmed;
  }
  return null;
}

export function sanitizeUserAgent(ua?: string | null): string | null {
  if (!ua || typeof ua !== "string") return null;
  const trimmed = ua.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 255) : null;
}

/**
 * Extrai metadados do cliente de forma segura:
 * - Nunca lê diretamente cabeçalhos arbitrários como `X-Forwarded-For`, `X-Real-IP`,
 *   `CF-Connecting-IP` ou `Forwarded` enviados pelo cliente (prevenindo spoofing de IP
 *   para burlar o rate limit de login/cadastro).
 * - Utiliza apenas `req.socket.remoteAddress` (endereço real do socket TCP) ou `req.ip`
 *   resolvido pelo adaptador HTTP quando `trust proxy` estiver explicitamente configurado
 *   de forma segura no servidor.
 */
export function extractClientMetadata(req: ClientMetadataSource): ClientMetadata {
  const userAgentHeader = req.headers?.["user-agent"];
  const userAgent = sanitizeUserAgent(
    typeof userAgentHeader === "string" ? userAgentHeader : null,
  );

  // Prioriza o endereço validado pela camada HTTP (`req.ip` com trust proxy desligado por padrão)
  // ou o endereço direto do socket TCP (`req.socket.remoteAddress`), ignorando headers X-Forwarded-For crus.
  const rawIp = req.ip ?? req.socket?.remoteAddress ?? null;
  const ipAddress = sanitizeIpAddress(rawIp);

  return {
    ipAddress,
    userAgent,
  };
}
