export const GENDER_OPTIONS = [
  "Feminino",
  "Masculino",
  "Outro",
  "Prefiro não informar",
] as const;

export const EDUCATION_OPTIONS = [
  "Fundamental",
  "Médio",
  "Superior",
  "Pós-graduação",
  "Prefiro não informar",
] as const;

export const MARKET_KNOWLEDGE_OPTIONS = [
  "Sim, conheço.",
  "Conheço um pouco.",
  "Não conheço.",
] as const;

export const MARKET_INTEREST_OPTIONS = [
  "Sim, tenho interesse.",
  "Talvez — quero conhecer melhor.",
  "Não tenho interesse.",
] as const;

export type ProfileGender = (typeof GENDER_OPTIONS)[number];
export type ProfileEducation = (typeof EDUCATION_OPTIONS)[number];
export type ProfileMarketKnowledge = (typeof MARKET_KNOWLEDGE_OPTIONS)[number];
export type ProfileMarketInterest = (typeof MARKET_INTEREST_OPTIONS)[number];

/**
 * Calendário civil de referência do servidor para validação de `birthDate <= hoje` (Seção 14.9 e 14.14).
 * Explicitado como `America/Sao_Paulo` (padrão nacional de operação da primeira versão do ArenaGo, D07),
 * podendo ser sobrescrito via variável de ambiente `ARENAGO_CIVIL_TIMEZONE` caso a revisão de arquitetura
 * defina outro fuso canônico.
 */
export const DEFAULT_REFERENCE_CIVIL_TIMEZONE = "America/Sao_Paulo";

export const DEFAULT_QUESTIONNAIRE_VERSION = "1.0.0";

export const DEFAULT_QUESTIONNAIRE_DEFINITION = {
  version: DEFAULT_QUESTIONNAIRE_VERSION,
  steps: [
    {
      id: "about-you",
      stepNumber: 1,
      fields: {
        birthDate: { type: "civil_date", format: "YYYY-MM-DD", allowToday: true },
        gender: { options: GENDER_OPTIONS },
        otherGender: { requiredWhenGender: "Outro", minLength: 1, maxLength: 100 },
        education: { options: EDUCATION_OPTIONS },
      },
    },
    {
      id: "your-games",
      stepNumber: 2,
      fields: {
        selectedGames: { minItems: 1, itemMinLength: 1, itemMaxLength: 100 },
      },
    },
    {
      id: "games-market",
      stepNumber: 3,
      fields: {
        marketKnowledge: { options: MARKET_KNOWLEDGE_OPTIONS },
        marketInterest: { options: MARKET_INTEREST_OPTIONS },
      },
    },
  ],
} as const;

export interface QuestionnaireAboutYouDto {
  birthDate: string;
  gender: ProfileGender;
  otherGender: string | null;
  education: ProfileEducation;
}

export interface QuestionnaireGamesMarketDto {
  marketKnowledge: ProfileMarketKnowledge;
  marketInterest: ProfileMarketInterest;
}

export interface IncompleteQuestionnaireResponseDto {
  hasCompleted: false;
  aboutYou: null;
  yourGames: [];
  gamesMarket: null;
  completedAt: null;
}

export interface CompletedQuestionnaireResponseDto {
  hasCompleted: true;
  aboutYou: QuestionnaireAboutYouDto;
  yourGames: string[];
  gamesMarket: QuestionnaireGamesMarketDto;
  completedAt: string;
}

export type GetQuestionnaireResponseDto =
  | IncompleteQuestionnaireResponseDto
  | CompletedQuestionnaireResponseDto;

export interface SaveQuestionnaireResponseDto {
  message: string;
  hasCompleted: true;
  updatedAt: string;
}
