import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Pool, PoolClient } from "pg";
import { AppModule } from "../../src/app.module";
import {
  LoginRateLimiterService,
  RegistrationRateLimiterService,
} from "../../src/auth";
import { runDatabaseSeed } from "../../src/database/seed";
import { CURATED_GAMES, GamesService } from "../../src/games";
import {
  getReferenceCivilTimezone,
  ProfileQuestionnaireService,
} from "../../src/profile";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL local descartável é obrigatório para os testes de integração.",
  );
}

let app: INestApplication;
let baseUrl: string;
let pool: Pool;
let loginRateLimiter: LoginRateLimiterService;
let registrationRateLimiter: RegistrationRateLimiterService;

function resetRateLimiters(): void {
  loginRateLimiter?.clearAll();
  registrationRateLimiter?.clearAll();
}

before(async () => {
  pool = new Pool({ connectionString, max: 12 });
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  loginRateLimiter = app.get(LoginRateLimiterService);
  registrationRateLimiter = app.get(RegistrationRateLimiterService);
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
});

after(async () => {
  if (app) {
    await app.close();
  }
  if (pool) {
    await pool.end();
  }
});

interface HttpResult<T = Record<string, unknown>> {
  status: number;
  headers: Headers;
  body: T;
}

async function apiRequest<T = Record<string, unknown>>(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    token?: string;
    headers?: Record<string, string>;
  },
): Promise<HttpResult<T>> {
  const headers: Record<string, string> = {
    ...(options?.body !== undefined
      ? { "Content-Type": "application/json" }
      : {}),
    ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options?.headers ?? {}),
  };

  const response = await fetch(`${baseUrl}${path}`, {
    method: options?.method ?? "GET",
    headers,
    body:
      options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const body = (await response.json()) as T;
  return {
    status: response.status,
    headers: response.headers,
    body,
  };
}

async function registerTestParticipant(label: string): Promise<{
  userId: string;
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
}> {
  resetRateLimiters();
  const suffix = randomUUID().slice(0, 8);
  const email = `${label.toLowerCase()}.${suffix}@arenago.test`;
  const password = `S3nha!Segura#${suffix}`;

  const res = await apiRequest<{
    user: { id: string; email: string; hasCompletedQuestionnaire: boolean };
    accessToken: string;
    refreshToken: string;
  }>("/auth/register", {
    method: "POST",
    body: {
      name: `Participante ${label}`,
      email,
      password,
    },
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.user.hasCompletedQuestionnaire, false);

  return {
    userId: res.body.user.id,
    email: res.body.user.email,
    password,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
  };
}

function addDaysToCivilDate(civilIso: string, deltaDays: number): string {
  const [y, m, d] = civilIso.split("-").map(Number);
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  utcNoon.setUTCDate(utcNoon.getUTCDate() + deltaDays);
  const year = String(utcNoon.getUTCFullYear()).padStart(4, "0");
  const month = String(utcNoon.getUTCMonth() + 1).padStart(2, "0");
  const day = String(utcNoon.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

test("K03 Profile Questionnaire & Games Catalog — Integração HTTP + PostgreSQL Real", async (t) => {
  // ===========================================================================
  // 1. GET de usuário sem questionário retorna 200, com hasCompleted=false
  // ===========================================================================
  await t.test("1. GET /profile/questionnaire de usuário sem questionário retorna 200 com hasCompleted=false", async () => {
    const user = await registerTestParticipant("sem-questionario");

    const res = await apiRequest<{
      hasCompleted: boolean;
      aboutYou: unknown;
      yourGames: unknown[];
      gamesMarket: unknown;
      completedAt: unknown;
    }>("/profile/questionnaire", {
      token: user.accessToken,
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      hasCompleted: false,
      aboutYou: null,
      yourGames: [],
      gamesMarket: null,
      completedAt: null,
    });
  });

  // ===========================================================================
  // 2. GET e PUT rejeitam requisições sem autenticação
  // ===========================================================================
  await t.test("2. GET e PUT /profile/questionnaire rejeitam requisições sem autenticação ou com token inválido (401)", async () => {
    const getUnauth = await apiRequest<{ code: string }>("/profile/questionnaire");
    assert.equal(getUnauth.status, 401);
    assert.equal(getUnauth.body.code, "MISSING_ACCESS_TOKEN");

    const putUnauth = await apiRequest<{ code: string }>("/profile/questionnaire", {
      method: "PUT",
      body: {
        birthDate: "2000-05-15",
        gender: "Masculino",
        otherGender: null,
        education: "Superior",
        selectedGames: ["Minecraft"],
        marketKnowledge: "Conheço um pouco.",
        marketInterest: "Sim, tenho interesse.",
      },
    });
    assert.equal(putUnauth.status, 401);
    assert.equal(putUnauth.body.code, "MISSING_ACCESS_TOKEN");

    const putBadToken = await apiRequest<{ code: string }>("/profile/questionnaire", {
      method: "PUT",
      token: "token.invalido.forjado",
      body: {
        birthDate: "2000-05-15",
        gender: "Masculino",
        otherGender: null,
        education: "Superior",
        selectedGames: ["Minecraft"],
        marketKnowledge: "Conheço um pouco.",
        marketInterest: "Sim, tenho interesse.",
      },
    });
    assert.equal(putBadToken.status, 401);
  });

  // ===========================================================================
  // 3, 4, 5 e 6. PUT válido grava respostas e jogos; GET retorna dados persistidos;
  // /auth/me e novo login reconhecem hasCompletedQuestionnaire=true
  // ===========================================================================
  await t.test("3, 4, 5 e 6. PUT válido persiste perfil e jogos, GET retorna dados exatos, e /auth/me + novo login retornam hasCompletedQuestionnaire=true", async () => {
    const user = await registerTestParticipant("fluxo-completo");

    const putRes = await apiRequest<{
      message: string;
      hasCompleted: boolean;
      updatedAt: string;
    }>("/profile/questionnaire", {
      method: "PUT",
      token: user.accessToken,
      body: {
        birthDate: "2000-05-15",
        gender: "Masculino",
        otherGender: null,
        education: "Superior",
        selectedGames: ["Valorant", "Minecraft"],
        marketKnowledge: "Conheço um pouco.",
        marketInterest: "Sim, tenho interesse.",
      },
    });

    assert.equal(putRes.status, 200);
    assert.equal(putRes.body.message, "Questionário salvo com sucesso.");
    assert.equal(putRes.body.hasCompleted, true);
    assert.ok(!Number.isNaN(Date.parse(putRes.body.updatedAt)));

    // Verificar persistência direta no PostgreSQL (profiles, questionnaire_versions, user_games)
    const dbProfile = await pool.query<{
      birth_date: string;
      gender: string;
      other_gender: string | null;
      education: string;
      market_knowledge: string;
      market_interest: string;
      version: string;
      activated_at: Date | null;
    }>(
      `SELECT
         p.birth_date::text AS birth_date,
         p.gender,
         p.other_gender,
         p.education,
         p.market_knowledge,
         p.market_interest,
         qv.version,
         qv.activated_at
       FROM profiles p
       INNER JOIN questionnaire_versions qv ON qv.id = p.questionnaire_version_id
       WHERE p.user_id = $1`,
      [user.userId],
    );
    assert.equal(dbProfile.rowCount, 1);
    assert.equal(dbProfile.rows[0].birth_date, "2000-05-15");
    assert.equal(dbProfile.rows[0].gender, "Masculino");
    assert.equal(dbProfile.rows[0].other_gender, null);
    assert.equal(dbProfile.rows[0].education, "Superior");
    assert.equal(dbProfile.rows[0].market_knowledge, "Conheço um pouco.");
    assert.equal(dbProfile.rows[0].market_interest, "Sim, tenho interesse.");
    assert.ok(dbProfile.rows[0].activated_at !== null);

    // 4. GET após PUT retorna exatamente os dados persistidos
    const getRes = await apiRequest<{
      hasCompleted: boolean;
      aboutYou: {
        birthDate: string;
        gender: string;
        otherGender: string | null;
        education: string;
      };
      yourGames: string[];
      gamesMarket: {
        marketKnowledge: string;
        marketInterest: string;
      };
      completedAt: string;
    }>("/profile/questionnaire", {
      token: user.accessToken,
    });

    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.hasCompleted, true);
    assert.deepEqual(getRes.body.aboutYou, {
      birthDate: "2000-05-15",
      gender: "Masculino",
      otherGender: null,
      education: "Superior",
    });
    assert.deepEqual(getRes.body.yourGames, ["Minecraft", "Valorant"]);
    assert.deepEqual(getRes.body.gamesMarket, {
      marketKnowledge: "Conheço um pouco.",
      marketInterest: "Sim, tenho interesse.",
    });
    assert.ok(!Number.isNaN(Date.parse(getRes.body.completedAt)));

    // 5. GET /auth/me reconhece o questionário concluído na mesma sessão
    const meRes = await apiRequest<{
      id: string;
      hasCompletedQuestionnaire: boolean;
    }>("/auth/me", {
      token: user.accessToken,
    });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.id, user.userId);
    assert.equal(meRes.body.hasCompletedQuestionnaire, true);

    // 6. Um novo login reconhece o perfil completo
    resetRateLimiters();
    const loginRes = await apiRequest<{
      user: { id: string; hasCompletedQuestionnaire: boolean };
      accessToken: string;
    }>("/auth/login", {
      method: "POST",
      body: {
        email: user.email,
        password: user.password,
      },
    });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.body.user.id, user.userId);
    assert.equal(loginRes.body.user.hasCompletedQuestionnaire, true);
  });

  // ===========================================================================
  // 7. Envio com campos inválidos não altera o banco
  // ===========================================================================
  await t.test("7. PUT com campos inválidos retorna 400 (RFC 7807) e não altera o banco de dados", async () => {
    const user = await registerTestParticipant("campos-invalidos");

    const invalidPayloads = [
      {
        birthDate: "2025-02-29", // data inexistente
        gender: "Masculino",
        otherGender: null,
        education: "Superior",
        selectedGames: ["Minecraft"],
        marketKnowledge: "Conheço um pouco.",
        marketInterest: "Sim, tenho interesse.",
      },
      {
        birthDate: "2000-05-15",
        gender: "Inexistente",
        otherGender: null,
        education: "Superior",
        selectedGames: ["Minecraft"],
        marketKnowledge: "Conheço um pouco.",
        marketInterest: "Sim, tenho interesse.",
      },
      {
        birthDate: "2000-05-15",
        gender: "Masculino",
        otherGender: null,
        education: "Doutorado Inventado",
        selectedGames: ["Minecraft"],
        marketKnowledge: "Conheço um pouco.",
        marketInterest: "Sim, tenho interesse.",
      },
      {
        birthDate: "2000-05-15",
        gender: "Masculino",
        otherGender: null,
        education: "Superior",
        selectedGames: [],
        marketKnowledge: "Conheço um pouco.",
        marketInterest: "Sim, tenho interesse.",
      },
      {
        birthDate: "2000-05-15",
        gender: "Masculino",
        otherGender: null,
        education: "Superior",
        selectedGames: ["   "],
        marketKnowledge: "Conheço um pouco.",
        marketInterest: "Sim, tenho interesse.",
      },
      {
        birthDate: "2000-05-15",
        gender: "Masculino",
        otherGender: null,
        education: "Superior",
        selectedGames: ["Minecraft"],
        marketKnowledge: "Opção Inválida",
        marketInterest: "Sim, tenho interesse.",
      },
    ];

    for (const badBody of invalidPayloads) {
      const res = await apiRequest<{
        status: number;
        code: string;
        invalidParams?: Array<{ name: string; reason: string }>;
      }>("/profile/questionnaire", {
        method: "PUT",
        token: user.accessToken,
        body: badBody,
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, "VALIDATION_ERROR");
      assert.ok(Array.isArray(res.body.invalidParams));
    }

    const dbProfileCount = await pool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM profiles WHERE user_id = $1",
      [user.userId],
    );
    const dbUserGamesCount = await pool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM user_games WHERE user_id = $1",
      [user.userId],
    );
    assert.equal(dbProfileCount.rows[0].count, 0);
    assert.equal(dbUserGamesCount.rows[0].count, 0);
  });

  // ===========================================================================
  // 8. Falha durante a gravação provoca rollback completo
  // ===========================================================================
  await t.test("8. Falha durante a gravação em transação provoca rollback completo de profiles, games e user_games", async () => {
    const user = await registerTestParticipant("rollback-atomico");
    const customGameShouldRollback = `Jogo Rollback ${randomUUID().slice(0, 8)}`;

    // Instanciar serviço com um GamesService que insere o jogo na transação e falha na etapa final
    const baseGamesService = app.get(GamesService);
    const failingGamesService = {
      resolveOrCreateGamesInTransaction: async (
        client: PoolClient,
        gameNames: string[],
        createdByUserId: string,
        now: Date,
      ) => {
        await baseGamesService.resolveOrCreateGamesInTransaction(
          client,
          gameNames,
          createdByUserId,
          now,
        );
        throw new Error("Simulated mid-transaction failure after inserting profile and custom game");
      },
    } as unknown as GamesService;

    const serviceWithFailure = new ProfileQuestionnaireService(
      pool,
      failingGamesService,
    );

    await assert.rejects(
      () =>
        serviceWithFailure.saveQuestionnaire(user.userId, {
          birthDate: "1998-03-21",
          gender: "Feminino",
          otherGender: null,
          education: "Superior",
          selectedGames: [customGameShouldRollback],
          marketKnowledge: "Sim, conheço.",
          marketInterest: "Sim, tenho interesse.",
        }),
      /Simulated mid-transaction failure/,
    );

    // Confirmar rollback completo no PostgreSQL
    const profileCheck = await pool.query(
      "SELECT 1 FROM profiles WHERE user_id = $1",
      [user.userId],
    );
    const gameCheck = await pool.query(
      "SELECT 1 FROM games WHERE lower(btrim(name)) = lower(btrim($1))",
      [customGameShouldRollback],
    );
    const userGamesCheck = await pool.query(
      "SELECT 1 FROM user_games WHERE user_id = $1",
      [user.userId],
    );

    assert.equal(profileCheck.rowCount, 0, "profiles deve sofrer rollback");
    assert.equal(gameCheck.rowCount, 0, "novo jogo em games deve sofrer rollback");
    assert.equal(userGamesCheck.rowCount, 0, "user_games deve sofrer rollback");
  });

  // ===========================================================================
  // 9. Data de hoje é aceita; data futura é rejeitada
  // ===========================================================================
  await t.test("9. Data de nascimento igual a hoje é aceita e data futura é rejeitada no calendário civil do servidor", async () => {
    const user = await registerTestParticipant("data-hoje-futura");
    const dbClock = await pool.query<{ today_civil: string }>(
      "SELECT (clock_timestamp() AT TIME ZONE $1)::date::text AS today_civil",
      [getReferenceCivilTimezone()],
    );
    const todayCivil = dbClock.rows[0].today_civil;
    const tomorrowCivil = addDaysToCivilDate(todayCivil, 1);

    const futureRes = await apiRequest<{
      code: string;
      invalidParams?: Array<{ name: string }>;
    }>("/profile/questionnaire", {
      method: "PUT",
      token: user.accessToken,
      body: {
        birthDate: tomorrowCivil,
        gender: "Prefiro não informar",
        otherGender: null,
        education: "Fundamental",
        selectedGames: ["Roblox"],
        marketKnowledge: "Não conheço.",
        marketInterest: "Talvez — quero conhecer melhor.",
      },
    });
    assert.equal(futureRes.status, 400);
    assert.equal(futureRes.body.code, "VALIDATION_ERROR");
    assert.ok(futureRes.body.invalidParams?.some((p) => p.name === "birthDate"));

    const todayRes = await apiRequest<{ hasCompleted: boolean }>(
      "/profile/questionnaire",
      {
        method: "PUT",
        token: user.accessToken,
        body: {
          birthDate: todayCivil,
          gender: "Prefiro não informar",
          otherGender: null,
          education: "Fundamental",
          selectedGames: ["Roblox"],
          marketKnowledge: "Não conheço.",
          marketInterest: "Talvez — quero conhecer melhor.",
        },
      },
    );
    assert.equal(todayRes.status, 200);
    assert.equal(todayRes.body.hasCompleted, true);

    const getRes = await apiRequest<{
      aboutYou: { birthDate: string };
    }>("/profile/questionnaire", {
      token: user.accessToken,
    });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.aboutYou.birthDate, todayCivil);
  });

  // ===========================================================================
  // 10. Gênero Outro exige especificação válida; outros gêneros limpam otherGender
  // ===========================================================================
  await t.test("10. Gênero Outro exige especificação válida e a troca para outro gênero limpa otherGender para null", async () => {
    const user = await registerTestParticipant("genero-outro");

    const missingOtherRes = await apiRequest<{
      code: string;
      invalidParams?: Array<{ name: string }>;
    }>("/profile/questionnaire", {
      method: "PUT",
      token: user.accessToken,
      body: {
        birthDate: "2001-09-10",
        gender: "Outro",
        otherGender: "   ",
        education: "Médio",
        selectedGames: ["Fortnite"],
        marketKnowledge: "Conheço um pouco.",
        marketInterest: "Sim, tenho interesse.",
      },
    });
    assert.equal(missingOtherRes.status, 400);
    assert.ok(
      missingOtherRes.body.invalidParams?.some((p) => p.name === "otherGender"),
    );

    const saveOutroRes = await apiRequest("/profile/questionnaire", {
      method: "PUT",
      token: user.accessToken,
      body: {
        birthDate: "2001-09-10",
        gender: "Outro",
        otherGender: "  Agênero  ",
        education: "Médio",
        selectedGames: ["Fortnite"],
        marketKnowledge: "Conheço um pouco.",
        marketInterest: "Sim, tenho interesse.",
      },
    });
    assert.equal(saveOutroRes.status, 200);

    const getOutro = await apiRequest<{
      aboutYou: { gender: string; otherGender: string | null };
    }>("/profile/questionnaire", {
      token: user.accessToken,
    });
    assert.equal(getOutro.body.aboutYou.gender, "Outro");
    assert.equal(getOutro.body.aboutYou.otherGender, "Agênero");

    // Atualizar para Feminino enviando texto residual em otherGender: deve limpar para null
    const switchGenderRes = await apiRequest("/profile/questionnaire", {
      method: "PUT",
      token: user.accessToken,
      body: {
        birthDate: "2001-09-10",
        gender: "Feminino",
        otherGender: "Agênero",
        education: "Médio",
        selectedGames: ["Fortnite"],
        marketKnowledge: "Conheço um pouco.",
        marketInterest: "Sim, tenho interesse.",
      },
    });
    assert.equal(switchGenderRes.status, 200);

    const getAfterSwitch = await apiRequest<{
      aboutYou: { gender: string; otherGender: string | null };
    }>("/profile/questionnaire", {
      token: user.accessToken,
    });
    assert.equal(getAfterSwitch.body.aboutYou.gender, "Feminino");
    assert.equal(getAfterSwitch.body.aboutYou.otherGender, null);
  });

  // ===========================================================================
  // 11. Jogos duplicados por capitalização e espaços não geram duplicações
  // ===========================================================================
  await t.test("11. Jogos duplicados por capitalização e espaços preservam o nome canônico e geram um único vínculo", async () => {
    const user = await registerTestParticipant("dedup-jogos");
    const customCanonical = `Chrono Trigger ${randomUUID().slice(0, 6)}`;

    const putRes = await apiRequest("/profile/questionnaire", {
      method: "PUT",
      token: user.accessToken,
      body: {
        birthDate: "1995-07-12",
        gender: "Masculino",
        otherGender: null,
        education: "Pós-graduação",
        selectedGames: [
          "  valorant  ",
          "VALORANT",
          "Valorant",
          `  ${customCanonical}  `,
          customCanonical.toUpperCase(),
          customCanonical.toLowerCase(),
        ],
        marketKnowledge: "Sim, conheço.",
        marketInterest: "Sim, tenho interesse.",
      },
    });
    assert.equal(putRes.status, 200);

    const getRes = await apiRequest<{ yourGames: string[] }>(
      "/profile/questionnaire",
      { token: user.accessToken },
    );
    assert.equal(getRes.status, 200);
    // "Valorant" preserva a grafia canônica curada e o custom preserva a primeira grafia informada
    assert.deepEqual(getRes.body.yourGames, [customCanonical, "Valorant"]);

    const customDbCount = await pool.query<{ count: number; name: string }>(
      `SELECT COUNT(*)::int AS count, MIN(name) AS name
       FROM games
       WHERE lower(btrim(name)) = lower(btrim($1))`,
      [customCanonical],
    );
    assert.equal(customDbCount.rows[0].count, 1);
    assert.equal(customDbCount.rows[0].name, customCanonical);
  });

  // ===========================================================================
  // 12. Duas contas criando simultaneamente o mesmo jogo produzem um único registro canônico
  // ===========================================================================
  await t.test("12. Duas contas criando simultaneamente o mesmo jogo personalizado produzem um único registro canônico", async () => {
    const [userA, userB] = await Promise.all([
      registerTestParticipant("concorrente-jogo-a"),
      registerTestParticipant("concorrente-jogo-b"),
    ]);

    const uniqueSuffix = randomUUID().slice(0, 8);
    const spellingA = `Outer Wilds ${uniqueSuffix}`;
    const spellingB = `  OUTER WILDS ${uniqueSuffix.toUpperCase()}  `;

    const [resA, resB] = await Promise.all([
      apiRequest("/profile/questionnaire", {
        method: "PUT",
        token: userA.accessToken,
        body: {
          birthDate: "1997-04-01",
          gender: "Feminino",
          otherGender: null,
          education: "Superior",
          selectedGames: [spellingA, "Valorant"],
          marketKnowledge: "Sim, conheço.",
          marketInterest: "Sim, tenho interesse.",
        },
      }),
      apiRequest("/profile/questionnaire", {
        method: "PUT",
        token: userB.accessToken,
        body: {
          birthDate: "1999-08-20",
          gender: "Masculino",
          otherGender: null,
          education: "Superior",
          selectedGames: [spellingB, "valorant"],
          marketKnowledge: "Conheço um pouco.",
          marketInterest: "Talvez — quero conhecer melhor.",
        },
      }),
    ]);

    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);

    const gameRows = await pool.query<{ id: string; name: string }>(
      `SELECT id, name
       FROM games
       WHERE lower(btrim(name)) = lower(btrim($1))`,
      [spellingA],
    );
    assert.equal(
      gameRows.rowCount,
      1,
      "Deve existir apenas um registro canônico em games",
    );
    const canonicalName = gameRows.rows[0].name;

    const [getA, getB] = await Promise.all([
      apiRequest<{ yourGames: string[] }>("/profile/questionnaire", {
        token: userA.accessToken,
      }),
      apiRequest<{ yourGames: string[] }>("/profile/questionnaire", {
        token: userB.accessToken,
      }),
    ]);

    assert.deepEqual(getA.body.yourGames, [canonicalName, "Valorant"]);
    assert.deepEqual(getB.body.yourGames, [canonicalName, "Valorant"]);
  });

  // ===========================================================================
  // 13. Atualizar o questionário substitui os jogos do usuário sem afetar outros usuários
  // ===========================================================================
  await t.test("13. Atualizar o questionário substitui os jogos do usuário sem afetar outros usuários", async () => {
    const [user1, user2] = await Promise.all([
      registerTestParticipant("substituir-jogos-1"),
      registerTestParticipant("substituir-jogos-2"),
    ]);

    const sharedCustomGame = `Stardew Valley ${randomUUID().slice(0, 6)}`;

    await apiRequest("/profile/questionnaire", {
      method: "PUT",
      token: user1.accessToken,
      body: {
        birthDate: "2002-01-10",
        gender: "Feminino",
        otherGender: null,
        education: "Superior",
        selectedGames: ["Minecraft", sharedCustomGame],
        marketKnowledge: "Sim, conheço.",
        marketInterest: "Sim, tenho interesse.",
      },
    });

    await apiRequest("/profile/questionnaire", {
      method: "PUT",
      token: user2.accessToken,
      body: {
        birthDate: "2003-06-18",
        gender: "Masculino",
        otherGender: null,
        education: "Médio",
        selectedGames: ["Minecraft", sharedCustomGame, "Fortnite"],
        marketKnowledge: "Conheço um pouco.",
        marketInterest: "Não tenho interesse.",
      },
    });

    // User 1 atualiza sua seleção para apenas ["Elden Ring"]
    const updateRes = await apiRequest("/profile/questionnaire", {
      method: "PUT",
      token: user1.accessToken,
      body: {
        birthDate: "2002-01-10",
        gender: "Feminino",
        otherGender: null,
        education: "Pós-graduação",
        selectedGames: ["Elden Ring"],
        marketKnowledge: "Sim, conheço.",
        marketInterest: "Sim, tenho interesse.",
      },
    });
    assert.equal(updateRes.status, 200);

    const [get1, get2] = await Promise.all([
      apiRequest<{ yourGames: string[]; aboutYou: { education: string } }>(
        "/profile/questionnaire",
        { token: user1.accessToken },
      ),
      apiRequest<{ yourGames: string[] }>("/profile/questionnaire", {
        token: user2.accessToken,
      }),
    ]);

    assert.deepEqual(get1.body.yourGames, ["Elden Ring"]);
    assert.equal(get1.body.aboutYou.education, "Pós-graduação");
    assert.deepEqual(get2.body.yourGames, [
      "Fortnite",
      "Minecraft",
      sharedCustomGame,
    ]);
  });

  // ===========================================================================
  // 14 e 15. Catálogo GET /games filtra, respeita limite, ordena com estabilidade,
  // e o seed dos 20 jogos é idempotente sem duplicações
  // ===========================================================================
  await t.test("14 e 15. Seed dos 20 jogos é idempotente e GET /games filtra, respeita limite e não expõe dados privados", async () => {
    // Executar o seed duas vezes seguidas
    const firstSeed = await runDatabaseSeed(pool);
    const secondSeed = await runDatabaseSeed(pool);

    assert.equal(firstSeed.games.totalCurated, 20);
    assert.equal(secondSeed.games.totalCurated, 20);
    assert.equal(
      secondSeed.games.insertedCount,
      0,
      "Reexecução do seed não deve inserir duplicatas",
    );

    // Consulta padrão (limit=20): primeiros 20 são os 20 jogos curados em ordem alfabética
    const defaultCatalog = await apiRequest<{
      games: Array<Record<string, unknown>>;
      total: number;
    }>("/games");
    assert.equal(defaultCatalog.status, 200);
    assert.equal(defaultCatalog.body.games.length, 20);
    assert.ok(defaultCatalog.body.total >= 20);
    assert.deepEqual(
      defaultCatalog.body.games.map((g) => g.name),
      [...CURATED_GAMES],
    );

    // Garantir que nenhuma chave privada (como createdByUserId ou createdAt) é exposta
    for (const item of defaultCatalog.body.games) {
      assert.deepEqual(Object.keys(item).sort(), ["id", "isCurated", "name"]);
    }

    // Consulta com filtro case-insensitive e limite
    const filtered = await apiRequest<{
      games: Array<{ id: string; name: string; isCurated: boolean }>;
      total: number;
    }>("/games?query=VALOR&limit=5");
    assert.equal(filtered.status, 200);
    assert.ok(filtered.body.games.some((g) => g.name === "Valorant" && g.isCurated === true));
    assert.ok(filtered.body.games.length <= 5);

    // Consulta respeitando limit=3
    const limited = await apiRequest<{
      games: Array<{ id: string; name: string; isCurated: boolean }>;
      total: number;
    }>("/games?limit=3");
    assert.equal(limited.status, 200);
    assert.equal(limited.body.games.length, 3);
    assert.ok(limited.body.total >= 20);

    // Filtros inválidos retornam 400
    const badQuery = await apiRequest("/games?query=%20%20%20");
    assert.equal(badQuery.status, 400);

    const badLimit = await apiRequest("/games?limit=0");
    assert.equal(badLimit.status, 400);

    const excessiveLimit = await apiRequest("/games?limit=51");
    assert.equal(excessiveLimit.status, 400);
  });

  // ===========================================================================
  // 16. Atualizações concorrentes do mesmo usuário preservam a integridade do perfil
  // ===========================================================================
  await t.test("16. Atualizações concorrentes do mesmo usuário são serializadas por users FOR UPDATE e preservam integridade", async () => {
    const user = await registerTestParticipant("concorrencia-mesmo-usuario");

    const payloadA = {
      birthDate: "1996-02-14",
      gender: "Masculino",
      otherGender: null,
      education: "Superior",
      selectedGames: ["Apex Legends", "Counter-Strike 2"],
      marketKnowledge: "Sim, conheço.",
      marketInterest: "Sim, tenho interesse.",
    };

    const payloadB = {
      birthDate: "1996-02-14",
      gender: "Outro",
      otherGender: "Não-binário",
      education: "Pós-graduação",
      selectedGames: ["Dota 2", "Elden Ring", "Valorant"],
      marketKnowledge: "Conheço um pouco.",
      marketInterest: "Talvez — quero conhecer melhor.",
    };

    const [resA, resB] = await Promise.all([
      apiRequest("/profile/questionnaire", {
        method: "PUT",
        token: user.accessToken,
        body: payloadA,
      }),
      apiRequest("/profile/questionnaire", {
        method: "PUT",
        token: user.accessToken,
        body: payloadB,
      }),
    ]);

    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);

    const finalGet = await apiRequest<{
      hasCompleted: boolean;
      aboutYou: { gender: string; otherGender: string | null; education: string };
      yourGames: string[];
      gamesMarket: { marketKnowledge: string; marketInterest: string };
    }>("/profile/questionnaire", {
      token: user.accessToken,
    });

    assert.equal(finalGet.status, 200);
    assert.equal(finalGet.body.hasCompleted, true);

    // O estado final deve corresponder integralmente a payloadA OU a payloadB, nunca híbrido
    if (finalGet.body.aboutYou.education === "Superior") {
      assert.equal(finalGet.body.aboutYou.gender, "Masculino");
      assert.equal(finalGet.body.aboutYou.otherGender, null);
      assert.deepEqual(finalGet.body.yourGames, [
        "Apex Legends",
        "Counter-Strike 2",
      ]);
      assert.equal(finalGet.body.gamesMarket.marketKnowledge, "Sim, conheço.");
    } else {
      assert.equal(finalGet.body.aboutYou.education, "Pós-graduação");
      assert.equal(finalGet.body.aboutYou.gender, "Outro");
      assert.equal(finalGet.body.aboutYou.otherGender, "Não-binário");
      assert.deepEqual(finalGet.body.yourGames, [
        "Dota 2",
        "Elden Ring",
        "Valorant",
      ]);
      assert.equal(
        finalGet.body.gamesMarket.marketKnowledge,
        "Conheço um pouco.",
      );
    }
  });

  // ===========================================================================
  // 17. Um usuário não consegue ler ou modificar o questionário de outro
  // ===========================================================================
  await t.test("17. Isolamento entre usuários: um usuário nunca lê ou modifica o questionário de outro", async () => {
    const [victim, attacker] = await Promise.all([
      registerTestParticipant("vitima"),
      registerTestParticipant("atacante"),
    ]);

    await apiRequest("/profile/questionnaire", {
      method: "PUT",
      token: victim.accessToken,
      body: {
        birthDate: "1994-11-05",
        gender: "Feminino",
        otherGender: null,
        education: "Superior",
        selectedGames: ["The Witcher 3"],
        marketKnowledge: "Sim, conheço.",
        marketInterest: "Sim, tenho interesse.",
      },
    });

    // Atacante tenta injetar userId da vítima no body do PUT -> rejeitado (400)
    const spoofAttempt = await apiRequest<{
      code: string;
      invalidParams?: Array<{ name: string }>;
    }>("/profile/questionnaire", {
      method: "PUT",
      token: attacker.accessToken,
      body: {
        userId: victim.userId,
        birthDate: "2005-01-01",
        gender: "Masculino",
        otherGender: null,
        education: "Fundamental",
        selectedGames: ["Roblox"],
        marketKnowledge: "Não conheço.",
        marketInterest: "Não tenho interesse.",
      },
    });
    assert.equal(spoofAttempt.status, 400);
    assert.ok(spoofAttempt.body.invalidParams?.some((p) => p.name === "userId"));

    // Atacante consulta GET /profile/questionnaire -> vê apenas seu próprio estado (hasCompleted=false)
    const attackerGet = await apiRequest<{ hasCompleted: boolean }>(
      "/profile/questionnaire",
      { token: attacker.accessToken },
    );
    assert.equal(attackerGet.status, 200);
    assert.equal(attackerGet.body.hasCompleted, false);

    // Questionário da vítima permanece intacto
    const victimGet = await apiRequest<{
      hasCompleted: boolean;
      yourGames: string[];
    }>("/profile/questionnaire", {
      token: victim.accessToken,
    });
    assert.equal(victimGet.body.hasCompleted, true);
    assert.deepEqual(victimGet.body.yourGames, ["The Witcher 3"]);
  });

  // ===========================================================================
  // 18. Compatibilidade da ordem de locks (users FOR UPDATE -> profiles -> user_games)
  // com snapshots de participações e imutabilidade histórica
  // ===========================================================================
  await t.test("18. Compatibilidade de locks com participation_profile_snapshots: sem snapshot híbrido e sem mutação retroativa", async () => {
    const user = await registerTestParticipant("snapshot-locks");

    // 1. Preencher questionário inicial (v1)
    const initialPut = await apiRequest("/profile/questionnaire", {
      method: "PUT",
      token: user.accessToken,
      body: {
        birthDate: "1999-05-10",
        gender: "Masculino",
        otherGender: null,
        education: "Superior",
        selectedGames: ["Minecraft", "Valorant"],
        marketKnowledge: "Conheço um pouco.",
        marketInterest: "Sim, tenho interesse.",
      },
    });
    assert.equal(initialPut.status, 200);

    // 2. Criar um evento de teste para exercitar a transação canônica de ingresso + snapshot:
    // events FOR UPDATE -> users FOR UPDATE -> profiles/user_games -> participations/participation_profile_snapshots
    const eventId = randomUUID();
    const accessCode = `K03SNAP${randomUUID().slice(0, 6).toUpperCase()}`;
    await pool.query(
      `INSERT INTO events (
         id, name, access_code_normalized, timezone, starts_at, official_ends_at,
         operational_deadline_at, status, external_queue_enabled, external_last_order,
         created_at, updated_at
       )
       VALUES (
         $1, 'Evento Teste Snapshot K03', $2, 'America/Sao_Paulo',
         clock_timestamp() - interval '1 hour',
         clock_timestamp() + interval '2 hours',
         clock_timestamp() + interval '3 hours',
         'open', false, 0, clock_timestamp(), clock_timestamp()
       )`,
      [eventId, accessCode],
    );

    // 3. Simular concorrência real entre:
    //    - Transação A: segura `events FOR UPDATE` -> `users FOR UPDATE` -> lê `profiles` + `user_games` e grava `participation_profile_snapshots`
    //    - Transação B: `PUT /profile/questionnaire` (que adquire `users FOR UPDATE` -> `profiles` -> `user_games`)
    const participationId = randomUUID();
    const joinClient = await pool.connect();
    let concurrentPutPromise!: Promise<HttpResult>;

    try {
      await joinClient.query("BEGIN");
      await joinClient.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [
        eventId,
      ]);
      await joinClient.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
        user.userId,
      ]);

      // Disparar PUT /profile/questionnaire concorrente enquanto joinClient detém `users FOR UPDATE`
      concurrentPutPromise = apiRequest("/profile/questionnaire", {
        method: "PUT",
        token: user.accessToken,
        body: {
          birthDate: "1999-05-10",
          gender: "Masculino",
          otherGender: null,
          education: "Pós-graduação",
          selectedGames: ["Cyberpunk 2077", "Elden Ring"],
          marketKnowledge: "Sim, conheço.",
          marketInterest: "Talvez — quero conhecer melhor.",
        },
      });

      // Pequena pausa para garantir que o PUT concorrente chegou ao PostgreSQL e aguarda o lock `users FOR UPDATE`
      await new Promise((resolve) => setTimeout(resolve, 40));

      const snapshotRead = await joinClient.query<{
        questionnaire_version_id: string;
        education: string;
        market_knowledge: string;
        market_interest: string;
        games: string[];
      }>(
        `SELECT
           p.questionnaire_version_id,
           p.education,
           p.market_knowledge,
           p.market_interest,
           ARRAY(
             SELECT g.name
             FROM user_games ug
             INNER JOIN games g ON g.id = ug.game_id
             WHERE ug.user_id = p.user_id
             ORDER BY lower(btrim(g.name)) ASC, g.name ASC, g.id ASC
           ) AS games
         FROM profiles p
         WHERE p.user_id = $1`,
        [user.userId],
      );

      const snapSource = snapshotRead.rows[0];
      // Como `users FOR UPDATE` bloqueou o PUT concorrente, tanto `profiles` quanto `user_games`
      // ainda refletem o conjunto consistente original (sem estado híbrido!)
      assert.equal(snapSource.education, "Superior");
      assert.deepEqual(snapSource.games, ["Minecraft", "Valorant"]);

      await joinClient.query(
        `INSERT INTO participations (
           id, user_id, event_id, status, joined_at, arena_entered_at
         )
         VALUES ($1, $2, $3, 'active', clock_timestamp(), clock_timestamp())`,
        [participationId, user.userId, eventId],
      );

      await joinClient.query(
        `INSERT INTO participation_profile_snapshots (
           participation_id, questionnaire_version_id, answers, games_snapshot, captured_at
         )
         VALUES ($1, $2, $3::jsonb, $4::jsonb, clock_timestamp())`,
        [
          participationId,
          snapSource.questionnaire_version_id,
          JSON.stringify({
            education: snapSource.education,
            marketKnowledge: snapSource.market_knowledge,
            marketInterest: snapSource.market_interest,
          }),
          JSON.stringify(snapSource.games),
        ],
      );

      await joinClient.query("COMMIT");
    } catch (err) {
      await joinClient.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      joinClient.release();
    }

    // Agora o PUT concorrente prossegue e confirma a atualização do perfil
    const putAfterUnlock = await concurrentPutPromise;
    assert.equal(putAfterUnlock.status, 200);

    // 4. Verificar que o perfil atual mudou, mas o snapshot histórico permanece imutável
    const updatedProfile = await apiRequest<{
      aboutYou: { education: string };
      yourGames: string[];
    }>("/profile/questionnaire", {
      token: user.accessToken,
    });
    assert.equal(updatedProfile.body.aboutYou.education, "Pós-graduação");
    assert.deepEqual(updatedProfile.body.yourGames, [
      "Cyberpunk 2077",
      "Elden Ring",
    ]);

    const historicalSnapshot = await pool.query<{
      answers: { education: string };
      games_snapshot: string[];
    }>(
      `SELECT answers, games_snapshot
       FROM participation_profile_snapshots
       WHERE participation_id = $1`,
      [participationId],
    );
    assert.equal(historicalSnapshot.rowCount, 1);
    assert.equal(historicalSnapshot.rows[0].answers.education, "Superior");
    assert.deepEqual(historicalSnapshot.rows[0].games_snapshot, [
      "Minecraft",
      "Valorant",
    ]);
  });
});
