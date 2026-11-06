import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import {
  loginSchema,
  refreshSchema,
  registerSchema,
  twoFactorVerifySchema,
  validateDto,
} from "./auth.dto";
import { AuthService } from "./auth.service";
import { EmailVerificationHttpService } from "./email-verification-http.service";
import { emailVerificationConfirmSchema, emailVerificationRequestSchema } from "./email-verification.dto";
import type {
  AuthenticatedPrincipal,
  AuthSessionResponseDto,
  LoginResponseDto,
  LogoutResponseDto,
  PublicUserDto,
  RefreshResponseDto,
} from "./auth.types";
import { extractClientMetadata } from "./client-metadata.util";
import { CurrentUser, RequireSessionAuth } from "./current-user.decorator";
import type { AuthenticatedRequest } from "./session-auth.guard";

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(EmailVerificationHttpService) private readonly emailVerification: EmailVerificationHttpService,
  ) {}

  @Post("register")
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<AuthSessionResponseDto> {
    const dto = validateDto(registerSchema, body);
    return this.authService.register(dto, extractClientMetadata(req));
  }

  @Post("login")
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<LoginResponseDto> {
    const dto = validateDto(loginSchema, body);
    return this.authService.login(dto, extractClientMetadata(req));
  }

  @Post("2fa/verify")
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  @HttpCode(HttpStatus.OK)
  async verifyTwoFactor(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<AuthSessionResponseDto> {
    const dto = validateDto(twoFactorVerifySchema, body);
    return this.authService.verifyTwoFactor(dto, extractClientMetadata(req));
  }

  @Post("refresh")
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: unknown): Promise<RefreshResponseDto> {
    const dto = validateDto(refreshSchema, body);
    return this.authService.refresh(dto);
  }

  @Get("me")
  @RequireSessionAuth()
  @HttpCode(HttpStatus.OK)
  getMe(@CurrentUser() principal: AuthenticatedPrincipal): PublicUserDto {
    return this.authService.getMe(principal);
  }

  @Post("logout")
  @RequireSessionAuth()
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<LogoutResponseDto> {
    return this.authService.logout(principal);
  }

  @Post("verify-email/request")
  @RequireSessionAuth()
  @HttpCode(HttpStatus.ACCEPTED)
  requestEmailVerification(@CurrentUser() principal: AuthenticatedPrincipal, @Body() body: unknown) {
    if (body !== undefined) validateDto(emailVerificationRequestSchema, body);
    return this.emailVerification.request(principal.userId);
  }

  @Post("verify-email/confirm")
  @HttpCode(HttpStatus.OK)
  confirmEmailVerification(@Body() body: unknown) {
    const dto = validateDto(emailVerificationConfirmSchema, body);
    return this.emailVerification.confirm(dto.token);
  }
}
