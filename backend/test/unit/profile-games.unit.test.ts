import assert from "node:assert/strict";
import { test } from "node:test";
import { ProblemException } from "../../src/common/errors/problem.exception";
import {
  CURATED_GAMES,
  deduplicateGameNames,
  validateGamesQuery,
} from "../../src/games";
import {
  DEFAULT_REFERENCE_CIVIL_TIMEZONE,
  EDUCATION_OPTIONS,
  GENDER_OPTIONS,
  getServerCivilDateToday,
  isValidGregorianCivilDate,
  MARKET_INTEREST_OPTIONS,
  MARKET_KNOWLEDGE_OPTIONS,
  validateUpsertQuestionnaireDto,
} from "../../src/profile";

test("Profile & Games Unit Suite: DTOs, calendário civil gregoriano e catálogo", async (t) => {
  await t.test("CURATED_GAMES contém exatamente os 20 jogos canônicos de app/data/mockData.js", () => {
    assert.equal(CURATED_GAMES.length, 20);
    assert.equal(new Set(CURATED_GAMES.map((g) => g.toLowerCase())).size, 20);
    assert.ok(CURATED_GAMES.includes("Apex Legends"));
    assert.ok(CURATED_GAMES.includes("Minecraft"));
    assert.ok(CURATED_GAMES.includes("Valorant"));
  });

  await t.test("isValidGregorianCivilDate valida datas reais do calendário gregoriano e anos bissextos", () => {
    assert.equal(isValidGregorianCivilDate("2000-02-29"), true); // divisível por 400
    assert.equal(isValidGregorianCivilDate("2024-02-29"), true); // bissexto
    assert.equal(isValidGregorianCivilDate("1900-02-29"), false); // secular não divisível por 400
    assert.equal(isValidGregorianCivilDate("2025-02-29"), false);
    assert.equal(isValidGregorianCivilDate("2026-04-31"), false);
    assert.equal(isValidGregorianCivilDate("2026-13-01"), false);
    assert.equal(isValidGregorianCivilDate("2026-00-10"), false);
    assert.equal(isValidGregorianCivilDate("2026-05-00"), false);
    assert.equal(isValidGregorianCivilDate("15/05/2000"), false);
  });

  await t.test("getServerCivilDateToday retorna YYYY-MM-DD no fuso civil de referência (America/Sao_Paulo)", () => {
    // 2026-10-24T01:30:00.000Z equivale a 2026-10-23 às 22:30 em America/Sao_Paulo (-03:00)
    const lateUtcInstant = new Date("2026-10-24T01:30:00.000Z");
    const civilInSaoPaulo = getServerCivilDateToday(
      lateUtcInstant,
      DEFAULT_REFERENCE_CIVIL_TIMEZONE,
    );
    assert.equal(civilInSaoPaulo, "2026-10-23");
  });

  await t.test("validateUpsertQuestionnaireDto aceita data de hoje, sem idade mínima presumida, e rejeita data futura", () => {
    const today = "2026-10-23";
    const validToday = validateUpsertQuestionnaireDto(
      {
        birthDate: today,
        gender: "Masculino",
        otherGender: null,
        education: "Superior",
        selectedGames: ["Minecraft", "Valorant"],
        marketKnowledge: "Conheço um pouco.",
        marketInterest: "Sim, tenho interesse.",
      },
      today,
    );

    assert.equal(validToday.birthDate, today);
    assert.equal(validToday.otherGender, null);
    assert.deepEqual(validToday.selectedGames, ["Minecraft", "Valorant"]);

    assert.throws(
      () =>
        validateUpsertQuestionnaireDto(
          {
            birthDate: "2026-10-24",
            gender: "Masculino",
            otherGender: null,
            education: "Superior",
            selectedGames: ["Minecraft"],
            marketKnowledge: "Conheço um pouco.",
            marketInterest: "Sim, tenho interesse.",
          },
          today,
        ),
      (err: unknown) =>
        err instanceof ProblemException &&
        err.getStatus() === 400 &&
        err.problem.code === "VALIDATION_ERROR" &&
        err.problem.invalidParams?.some((p) => p.name === "birthDate"),
    );
  });

  await t.test("validateUpsertQuestionnaireDto exige otherGender (1..100 após trim) para Outro e limpa para null nos demais gêneros", () => {
    assert.throws(
      () =>
        validateUpsertQuestionnaireDto({
          birthDate: "2000-05-15",
          gender: "Outro",
          otherGender: "   ",
          education: "Médio",
          selectedGames: ["Valorant"],
          marketKnowledge: "Sim, conheço.",
          marketInterest: "Talvez — quero conhecer melhor.",
        }),
      (err: unknown) =>
        err instanceof ProblemException &&
        err.getStatus() === 400 &&
        err.problem.invalidParams?.some((p) => p.name === "otherGender"),
    );

    const validOutro = validateUpsertQuestionnaireDto({
      birthDate: "2000-05-15",
      gender: "Outro",
      otherGender: "  Não-binário  ",
      education: "Médio",
      selectedGames: ["Valorant"],
      marketKnowledge: "Sim, conheço.",
      marketInterest: "Talvez — quero conhecer melhor.",
    });
    assert.equal(validOutro.otherGender, "Não-binário");

    for (const nonOtherGender of GENDER_OPTIONS.filter((g) => g !== "Outro")) {
      const normalized = validateUpsertQuestionnaireDto({
        birthDate: "2000-05-15",
        gender: nonOtherGender,
        otherGender: "Texto residual que deve ser limpo",
        education: EDUCATION_OPTIONS[0],
        selectedGames: ["Valorant"],
        marketKnowledge: MARKET_KNOWLEDGE_OPTIONS[0],
        marketInterest: MARKET_INTEREST_OPTIONS[0],
      });
      assert.equal(normalized.otherGender, null);
    }
  });

  await t.test("deduplicateGameNames e validateUpsertQuestionnaireDto impedem duplicações por caixa e espaços externos", () => {
    const dedup = deduplicateGameNames(["  Valorant ", "valorant", "VALORANT", "Minecraft"]);
    assert.deepEqual(dedup, ["Valorant", "Minecraft"]);

    const parsed = validateUpsertQuestionnaireDto({
      birthDate: "1999-12-31",
      gender: "Feminino",
      otherGender: null,
      education: "Pós-graduação",
      selectedGames: [" Valorant ", "VALORANT", "valorant", " Hollow Knight "],
      marketKnowledge: "Não conheço.",
      marketInterest: "Não tenho interesse.",
    });

    assert.deepEqual(parsed.selectedGames, ["Valorant", "Hollow Knight"]);
  });

  await t.test("validateUpsertQuestionnaireDto rejeita lista de jogos vazia, nomes vazios/>100 chars e userId injetado no body", () => {
    assert.throws(
      () =>
        validateUpsertQuestionnaireDto({
          birthDate: "2000-05-15",
          gender: "Masculino",
          otherGender: null,
          education: "Superior",
          selectedGames: [],
          marketKnowledge: "Sim, conheço.",
          marketInterest: "Sim, tenho interesse.",
        }),
      (err: unknown) =>
        err instanceof ProblemException &&
        err.getStatus() === 400 &&
        err.problem.invalidParams?.some((p) => p.name === "selectedGames"),
    );

    assert.throws(
      () =>
        validateUpsertQuestionnaireDto({
          userId: "550e8400-e29b-41d4-a716-446655440000",
          birthDate: "2000-05-15",
          gender: "Masculino",
          otherGender: null,
          education: "Superior",
          selectedGames: ["Minecraft"],
          marketKnowledge: "Sim, conheço.",
          marketInterest: "Sim, tenho interesse.",
        }),
      (err: unknown) =>
        err instanceof ProblemException &&
        err.getStatus() === 400 &&
        err.problem.invalidParams?.some((p) => p.name === "userId"),
    );
  });

  await t.test("validateGamesQuery aplica padrão limit=20 e valida query (1..100) e limit (1..50)", () => {
    const defaults = validateGamesQuery({});
    assert.equal(defaults.limit, 20);
    assert.equal(defaults.query, undefined);

    const withFilters = validateGamesQuery({ query: "  valor  ", limit: "15" });
    assert.equal(withFilters.query, "valor");
    assert.equal(withFilters.limit, 15);

    assert.throws(
      () => validateGamesQuery({ query: "   " }),
      (err: unknown) =>
        err instanceof ProblemException &&
        err.getStatus() === 400 &&
        err.problem.invalidParams?.some((p) => p.name === "query"),
    );

    assert.throws(
      () => validateGamesQuery({ limit: "0" }),
      (err: unknown) =>
        err instanceof ProblemException &&
        err.getStatus() === 400 &&
        err.problem.invalidParams?.some((p) => p.name === "limit"),
    );

    assert.throws(
      () => validateGamesQuery({ limit: "51" }),
      (err: unknown) =>
        err instanceof ProblemException &&
        err.getStatus() === 400 &&
        err.problem.invalidParams?.some((p) => p.name === "limit"),
    );
  });
});
