import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { EmailDelivery } from "./email-verification.types";

export const EMAIL_DELIVERY = Symbol("EMAIL_DELIVERY");
export const RESEND_TRANSPORT = Symbol("RESEND_TRANSPORT");

export interface EmailVerificationConfig {
  apiKey: string;
  from: string;
  confirmationUrl: string;
  testRecipient?: string;
}
export type ResendRequest = {
  from: string; to: string[]; subject: string; text: string; html: string;
};
export type ResendTransport = (apiKey: string, payload: ResendRequest, idempotencyKey: string) => Promise<void>;

function requiredEnvironment(name: string, value: string | undefined): string {
  if (!value?.trim()) throw new Error(`Configuração obrigatória ausente: ${name}.`);
  return value.trim();
}

export function readEmailVerificationConfig(env: NodeJS.ProcessEnv = process.env): EmailVerificationConfig {
  const apiKey = requiredEnvironment("RESEND_API_KEY", env.RESEND_API_KEY);
  const from = requiredEnvironment("RESEND_FROM", env.RESEND_FROM ?? "onboarding@resend.dev");
  const confirmationUrl = requiredEnvironment("EMAIL_VERIFICATION_CONFIRMATION_URL", env.EMAIL_VERIFICATION_CONFIRMATION_URL);
  let parsed: URL;
  try { parsed = new URL(confirmationUrl); } catch { throw new Error("EMAIL_VERIFICATION_CONFIRMATION_URL deve ser uma URL absoluta HTTP(S)."); }
  if (!(["https:", "http:"].includes(parsed.protocol)) || (parsed.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))) {
    throw new Error("EMAIL_VERIFICATION_CONFIRMATION_URL deve usar HTTPS (HTTP somente em localhost).");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("EMAIL_VERIFICATION_CONFIRMATION_URL não pode conter credenciais, query ou fragmento.");
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from)) throw new Error("RESEND_FROM deve conter um endereço de e-mail válido.");
  if (from.toLowerCase() === "onboarding@resend.dev" && !env.RESEND_TEST_RECIPIENT?.trim()) {
    throw new Error("RESEND_TEST_RECIPIENT é obrigatório ao usar onboarding@resend.dev.");
  }
  return Object.freeze({ apiKey, from, confirmationUrl: parsed.toString(), testRecipient: env.RESEND_TEST_RECIPIENT?.trim().toLowerCase() });
}

export const resendFetchTransport: ResendTransport = async (apiKey, payload, idempotencyKey) => {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Resend recusou a entrega.");
  const result: unknown = await response.json();
  if (typeof result !== "object" || result === null || !("id" in result) || typeof result.id !== "string") {
    throw new Error("Resend não confirmou a solicitação de entrega.");
  }
};

export function buildConfirmationLink(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

@Injectable()
export class ResendEmailVerificationMailer implements EmailDelivery {
  constructor(
    @Inject(RESEND_TRANSPORT) private readonly transport: ResendTransport,
    @Inject("EMAIL_VERIFICATION_CONFIG") private readonly config: EmailVerificationConfig | null,
  ) {}

  isAvailable(): boolean { return this.config !== null; }

  async sendVerification(email: string, token: string): Promise<void> {
    if (!this.config) throw new Error("Entrega de e-mail indisponível.");
    if (this.config.from.toLowerCase() === "onboarding@resend.dev" && email.toLowerCase() !== this.config.testRecipient) {
      throw new Error("Destinatário fora do modo de teste Resend.");
    }
    const link = buildConfirmationLink(this.config.confirmationUrl, token);
    const htmlLink = escapeHtml(link);
    const payload: ResendRequest = {
      from: this.config.from, to: [email], subject: "Confirme seu e-mail no ArenaGo",
      text: `Para confirmar seu e-mail, acesse: ${link}\n\nO link vence em 24 horas. Se você não solicitou esta mensagem, ignore-a.`,
      html: `<p>Para confirmar seu e-mail no ArenaGo, use o link abaixo:</p><p><a href="${htmlLink}">Confirmar e-mail</a></p><p>O link vence em 24 horas. Se você não solicitou esta mensagem, ignore-a.</p>`,
    };
    const idempotencyKey = createHash("sha256").update(token, "utf8").digest("hex");
    await this.transport(this.config.apiKey, payload, idempotencyKey);
  }
}
