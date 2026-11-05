import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { LoginRateLimiterService } from "./login-rate-limiter.service";
import { RegistrationRateLimiterService } from "./registration-rate-limiter.service";
import { SessionAuthGuard } from "./session-auth.guard";
import { EmailVerificationPolicy } from "./email-verification.policy";
import { EmailVerificationService } from "./email-verification.service";
import { EMAIL_DELIVERY, readEmailVerificationConfig, RESEND_TRANSPORT, resendFetchTransport, ResendEmailVerificationMailer } from "./email-verification-mailer";
import { EmailVerificationHttpService } from "./email-verification-http.service";

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    EmailVerificationPolicy,
    EmailVerificationService,
    EmailVerificationHttpService,
    { provide: "EMAIL_VERIFICATION_CONFIG", useFactory: () => {
      if (!process.env.RESEND_API_KEY && !process.env.RESEND_FROM && !process.env.EMAIL_VERIFICATION_CONFIRMATION_URL) return null;
      return readEmailVerificationConfig();
    } },
    { provide: RESEND_TRANSPORT, useValue: resendFetchTransport },
    { provide: EMAIL_DELIVERY, useClass: ResendEmailVerificationMailer },
    AuthService,
    LoginRateLimiterService,
    RegistrationRateLimiterService,
    SessionAuthGuard,
  ],
  exports: [
    EmailVerificationService,
    AuthService,
    LoginRateLimiterService,
    RegistrationRateLimiterService,
    SessionAuthGuard,
  ],
})
export class AuthModule {}
