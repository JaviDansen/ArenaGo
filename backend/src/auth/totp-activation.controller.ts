import { Body, Controller, Header, HttpCode, Inject, Post } from "@nestjs/common";
import { z } from "zod";
import { validateDto } from "./auth.dto";
import { TotpActivationService, type ActivationConfirmed } from "./totp-activation.service";

const setupSchema = z.object({
  tempToken: z.string().min(1).max(2048),
  activationToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
// Códigos em texto malformados passam pelo limite transacional, antes de serem recusados.
const confirmSchema = setupSchema.extend({ code: z.string().max(128) }).strict();

@Controller("auth/2fa")
export class TotpActivationController {
  constructor(@Inject(TotpActivationService) private readonly activation: TotpActivationService) {}

  @Post("setup")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  setup(@Body() body: unknown) { return this.activation.setup(validateDto(setupSchema, body)); }

  @Post("confirm")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  confirm(@Body() body: unknown): Promise<ActivationConfirmed> { return this.activation.confirm(validateDto(confirmSchema, body)); }
}
