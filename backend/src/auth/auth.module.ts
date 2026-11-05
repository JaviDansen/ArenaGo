import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { LoginRateLimiterService } from "./login-rate-limiter.service";
import { RegistrationRateLimiterService } from "./registration-rate-limiter.service";
import { SessionAuthGuard } from "./session-auth.guard";
import { EmailVerificationPolicy } from "./email-verification.policy";
import { EmailVerificationService } from "./email-verification.service";

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    EmailVerificationPolicy,
    EmailVerificationService,
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
