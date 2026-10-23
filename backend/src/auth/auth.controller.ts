import {
  Body,
  Controller,
  Get,
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
  validateDto,
} from "./auth.dto";
import { AuthService } from "./auth.service";
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
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<AuthSessionResponseDto> {
    const dto = validateDto(registerSchema, body);
    return this.authService.register(dto, extractClientMetadata(req));
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<LoginResponseDto> {
    const dto = validateDto(loginSchema, body);
    return this.authService.login(dto, extractClientMetadata(req));
  }

  @Post("refresh")
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
}
