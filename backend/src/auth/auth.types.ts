export type UserRoleName = "participante" | "staff" | "admin";

export interface AuthenticatedPrincipal {
  userId: string;
  sessionId: string;
  name: string;
  email: string;
  emailVerified: boolean;
  roles: UserRoleName[];
  staffEventIds: string[];
  hasCompletedQuestionnaire: boolean;
  admin2faVerifiedAt: Date | null;
}

export interface PublicUserDto {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  roles: UserRoleName[];
  hasCompletedQuestionnaire: boolean;
}

export interface AuthSessionResponseDto {
  user: PublicUserDto;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AdminTwoFactorChallengeResponseDto {
  requires2FA: true;
  isTotpConfigured: boolean;
  tempToken: string;
  message: string;
}

export type LoginResponseDto = AuthSessionResponseDto | AdminTwoFactorChallengeResponseDto;

export interface RefreshResponseDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LogoutResponseDto {
  message: string;
}

export interface ClientMetadata {
  ipAddress?: string | null;
  userAgent?: string | null;
}
