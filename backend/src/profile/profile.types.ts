export interface ProfileUserDto {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  roles: string[];
  hasCompletedQuestionnaire: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfileResponseDto {
  message: string;
  user: ProfileUserDto;
}
