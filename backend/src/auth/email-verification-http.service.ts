import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ProblemException } from "../common/errors/problem.exception";
import { EmailVerificationService } from "./email-verification.service";
import { EMAIL_DELIVERY } from "./email-verification-mailer";
import type { EmailDelivery } from "./email-verification.types";

@Injectable()
export class EmailVerificationHttpService {
  constructor(
    @Inject(EmailVerificationService) private readonly verification: EmailVerificationService,
    @Inject(EMAIL_DELIVERY) private readonly delivery: EmailDelivery,
  ) {}

  async request(userId: string): Promise<{ message: string }> {
    if (!this.delivery.isAvailable()) throw this.unavailable();
    const issued = await this.verification.issue(userId);
    if (issued.kind === "issued") {
      try { await this.delivery.sendVerification(issued.email, issued.token); }
      catch { throw this.unavailable(); }
    }
    // Mesma resposta para indisponível, já verificado, cooldown e limite, sem enumeração.
    return { message: "Se a conta puder receber uma confirmação, enviaremos as instruções por e-mail." };
  }

  async confirm(token: unknown): Promise<{ verified: boolean }> {
    return { verified: (await this.verification.confirm(token)).kind === "verified" };
  }

  private unavailable(): ProblemException {
    return new ProblemException({ typeSlug: "email-delivery-unavailable", title: "Envio temporariamente indisponível",
      status: HttpStatus.SERVICE_UNAVAILABLE, code: "EMAIL_DELIVERY_UNAVAILABLE",
      detail: "Não foi possível solicitar o envio agora. Aguarde antes de tentar novamente." });
  }
}
