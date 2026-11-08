import assert from "node:assert/strict";
import { test } from "node:test";

interface QueryCall {
  sql: string;
  params: unknown[];
}

interface MockQueryRow {
  id?: string;
  version?: string;
  activated_at?: string | null;
  is_curated?: boolean;
}

interface MockQueryResult {
  rowCount: number;
  rows: MockQueryRow[];
}

function createMockPool(options?: {
  failReadF1?: boolean;
  failCleanupF1?: boolean;
  failReadF2?: boolean;
  failCleanupApexF2?: boolean;
  failCleanupCustomF2?: boolean;
  initialActivatedAt?: string | null;
  initialVersions?: { id: string; version: string; activated_at: string | null }[];
  initialCurated?: boolean;
}) {
  const calls: QueryCall[] = [];

  const pool = {
    calls,
    query: async (sql: string, params: unknown[] = []): Promise<MockQueryResult> => {
      calls.push({ sql: sql.trim(), params });

      if (sql.includes("SELECT id, version, activated_at::text AS activated_at FROM questionnaire_versions")) {
        if (options?.failReadF1) {
          throw new Error("Simulated F1 initial read failure");
        }
        if (options?.initialVersions) {
          return { rowCount: options.initialVersions.length, rows: options.initialVersions };
        }
        return {
          rowCount: 1,
          rows: [{ id: "version-id", version: "1.0.0", activated_at: options?.initialActivatedAt ?? null }],
        };
      }

      if (sql.includes("UPDATE questionnaire_versions AS qv")) {
        if (options?.failCleanupF1) {
          throw new Error("Simulated F1 cleanup restore failure");
        }
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes("SELECT is_curated FROM games WHERE lower(btrim(name))")) {
        if (options?.failReadF2) {
          throw new Error("Simulated F2 initial read failure");
        }
        return {
          rowCount: 1,
          rows: [{ is_curated: options?.initialCurated ?? false }],
        };
      }

      if (sql.includes("UPDATE games SET is_curated = $1")) {
        if (options?.failCleanupApexF2) {
          throw new Error("Simulated F2 Apex cleanup failure");
        }
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes("DELETE FROM games WHERE id = $1")) {
        if (options?.failCleanupCustomF2) {
          throw new Error("Simulated F2 Custom game cleanup failure");
        }
        return { rowCount: 1, rows: [] };
      }

      return { rowCount: 1, rows: [] };
    },
  };

  return pool;
}

test("Robustez do cleanup de testes de integração K03-F", async (t) => {
  /* eslint-disable no-unsafe-finally, preserve-caught-error */
  await t.test("K03-F.1: Nunca tenta restaurar quando a leitura inicial falha", async () => {
    const pool = createMockPool({ failReadF1: true });
    let originalVersions: MockQueryRow[] = [];
    let originalReadSuccess = false;
    let primaryError: unknown = null;

    let caughtError: unknown;
    try {
      try {
        const origRes = await pool.query(
          "SELECT id, version, activated_at::text AS activated_at FROM questionnaire_versions ORDER BY id FOR UPDATE",
        );
        originalVersions = origRes.rows;
        originalReadSuccess = true;
      } catch (err) {
        primaryError = err;
        throw err;
      } finally {
        if (originalReadSuccess) {
          await pool.query(
            "UPDATE questionnaire_versions AS qv SET activated_at = saved.activated_at::timestamptz FROM unnest($1::uuid[], $2::text[]) AS saved(id, activated_at) WHERE qv.id = saved.id",
            [originalVersions.map((version) => version.id), originalVersions.map((version) => version.activated_at)],
          );
        }
      }
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError instanceof Error);
    assert.match(caughtError.message, /Simulated F1 initial read failure/);
    assert.equal(caughtError, primaryError);
    assert.equal(originalReadSuccess, false);
    // Verificar que UPDATE não foi chamado
    const updateCalls = pool.calls.filter((c) =>
      c.sql.includes("UPDATE questionnaire_versions AS qv"),
    );
    assert.equal(updateCalls.length, 0);
  });

  await t.test("K03-F.1: Restaura o timestamp original de cada versão do catálogo", async () => {
    const originalVersions = [
      { id: "version-active", version: "1.0.0", activated_at: "2024-05-10 12:00:00.123456+00" },
      { id: "version-inactive", version: "2.0.0", activated_at: null },
      { id: "version-other-active", version: "3.0.0", activated_at: "2024-05-10 09:00:00.654321-03" },
    ];
    const pool = createMockPool({ initialVersions: originalVersions });
    const snapshot = await pool.query(
      "SELECT id, version, activated_at::text AS activated_at FROM questionnaire_versions ORDER BY id FOR UPDATE",
    );
    await pool.query(
      "UPDATE questionnaire_versions AS qv SET activated_at = saved.activated_at::timestamptz FROM unnest($1::uuid[], $2::text[]) AS saved(id, activated_at) WHERE qv.id = saved.id",
      [snapshot.rows.map((version) => version.id), snapshot.rows.map((version) => version.activated_at)],
    );

    const restore = pool.calls[1];
    assert.ok(restore.sql.includes("UPDATE questionnaire_versions AS qv"));
    assert.match(snapshot.rows[0].activated_at ?? "", /\.123456/);
    assert.match(restore.sql, /saved\.activated_at::timestamptz/);
    assert.match(restore.sql, /\$2::text\[\]/);
    assert.deepEqual(restore.params, [
      originalVersions.map((version) => version.id),
      originalVersions.map((version) => version.activated_at),
    ]);
  });

  await t.test("K03-F.1: Restaura no finally após falha do cenário sem ocultá-la", async () => {
    const originalTimestamp = "2024-05-10 12:00:00.123456+00";
    const pool = createMockPool({ initialActivatedAt: originalTimestamp });
    let originalVersions: MockQueryRow[] = [];
    let caughtError: unknown;
    const primaryError = new Error("Falha do cenário K03-F.1");
    try {
      try {
        originalVersions = (await pool.query(
          "SELECT id, version, activated_at::text AS activated_at FROM questionnaire_versions ORDER BY id FOR UPDATE",
        )).rows;
        throw primaryError;
      } finally {
        if (originalVersions.length) {
          await pool.query(
            "UPDATE questionnaire_versions AS qv SET activated_at = saved.activated_at::timestamptz FROM unnest($1::uuid[], $2::text[]) AS saved(id, activated_at) WHERE qv.id = saved.id",
            [originalVersions.map((version) => version.id), originalVersions.map((version) => version.activated_at)],
          );
        }
      }
    } catch (error) {
      caughtError = error;
    }
    assert.equal(caughtError, primaryError);
    assert.equal(pool.calls.length, 2);
    assert.deepEqual(pool.calls[1].params, [["version-id"], [originalTimestamp]]);
  });

  await t.test("K03-F.1: Preserva falha primária via AggregateError se cleanup falhar", async () => {
    const originalTimestamp = "2024-05-10 12:00:00.123456+00";
    const pool = createMockPool({
      initialActivatedAt: originalTimestamp,
      failCleanupF1: true,
    });
    let originalVersions: MockQueryRow[] = [];
    let originalReadSuccess = false;
    let primaryError: unknown = null;

    let caughtError: unknown;
    try {
      try {
        const origRes = await pool.query(
          "SELECT id, version, activated_at::text AS activated_at FROM questionnaire_versions ORDER BY id FOR UPDATE",
        );
        originalVersions = origRes.rows;
        originalReadSuccess = true;

        // Simular falha durante o corpo do teste
        throw new Error("Primary test failure in K03-F.1");
      } catch (err) {
        primaryError = err;
        throw err;
      } finally {
        if (originalReadSuccess) {
          try {
            await pool.query(
              "UPDATE questionnaire_versions AS qv SET activated_at = saved.activated_at::timestamptz FROM unnest($1::uuid[], $2::text[]) AS saved(id, activated_at) WHERE qv.id = saved.id",
              [originalVersions.map((version) => version.id), originalVersions.map((version) => version.activated_at)],
            );
          } catch (cleanupErr) {
            if (primaryError) {
              throw new AggregateError(
                [primaryError, cleanupErr],
                `Falha na restauração de K03-F.1: ${(cleanupErr as Error)?.message}`,
                { cause: primaryError },
              );
            }
            throw cleanupErr;
          }
        }
      }
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError instanceof AggregateError);
    assert.equal(caughtError.errors.length, 2);
    assert.match((caughtError.errors[0] as Error).message, /Primary test failure/);
    assert.match((caughtError.errors[1] as Error).message, /Simulated F1 cleanup restore failure/);
    assert.equal(caughtError.cause, primaryError);
  });

  await t.test("K03-F.2: Nunca tenta restaurar quando leitura inicial de Apex falha", async () => {
    const pool = createMockPool({ failReadF2: true });
    let originalCurated = true;
    let originalApexReadSuccess = false;
    const customGameInserted = false;
    let primaryError: unknown = null;

    let caughtError: unknown;
    try {
      try {
        const origApex = await pool.query(
          "SELECT is_curated FROM games WHERE lower(btrim(name)) = lower('Apex Legends')",
        );
        originalCurated = origApex.rows[0]?.is_curated ?? true;
        originalApexReadSuccess = true;
      } catch (err) {
        primaryError = err;
        throw err;
      } finally {
        const cleanupErrors: unknown[] = [];
        if (originalApexReadSuccess) {
          try {
            await pool.query(
              "UPDATE games SET is_curated = $1 WHERE lower(btrim(name)) = lower('Apex Legends')",
              [originalCurated],
            );
          } catch (err) {
            cleanupErrors.push(err);
          }
        }
        if (customGameInserted) {
          try {
            await pool.query("DELETE FROM games WHERE id = $1", ["some-id"]);
          } catch (err) {
            cleanupErrors.push(err);
          }
        }
        if (cleanupErrors.length > 0) {
          if (primaryError) {
            throw new AggregateError([primaryError, ...cleanupErrors], "Cleanup failed", { cause: primaryError });
          }
          throw cleanupErrors[0];
        }
      }
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError instanceof Error);
    assert.match(caughtError.message, /Simulated F2 initial read failure/);
    assert.equal(originalApexReadSuccess, false);
    assert.equal(customGameInserted, false);
    assert.equal(
      pool.calls.filter((c) => c.sql.includes("UPDATE games SET is_curated = $1")).length,
      0,
    );
    assert.equal(
      pool.calls.filter((c) => c.sql.includes("DELETE FROM games WHERE id = $1")).length,
      0,
    );
  });

  await t.test("K03-F.2: Executa operações de cleanup de forma independente (falha em reverter Apex não impede DELETE)", async () => {
    const pool = createMockPool({
      initialCurated: false,
      failCleanupApexF2: true, // Falha na Op 1
      failCleanupCustomF2: false, // Op 2 deve ter sucesso
    });
    let originalCurated = true;
    let originalApexReadSuccess = false;
    let customGameInserted = false;
    let primaryError: unknown = null;

    let caughtError: unknown;
    try {
      try {
        const origApex = await pool.query(
          "SELECT is_curated FROM games WHERE lower(btrim(name)) = lower('Apex Legends')",
        );
        originalCurated = origApex.rows[0]?.is_curated ?? true;
        originalApexReadSuccess = true;

        customGameInserted = true;
      } catch (err) {
        primaryError = err;
        throw err;
      } finally {
        const cleanupErrors: unknown[] = [];
        if (originalApexReadSuccess) {
          try {
            await pool.query(
              "UPDATE games SET is_curated = $1 WHERE lower(btrim(name)) = lower('Apex Legends')",
              [originalCurated],
            );
          } catch (err) {
            cleanupErrors.push(err);
          }
        }
        if (customGameInserted) {
          try {
            await pool.query("DELETE FROM games WHERE id = $1", ["promoted-custom-id"]);
          } catch (err) {
            cleanupErrors.push(err);
          }
        }
        if (cleanupErrors.length > 0) {
          if (primaryError) {
            throw new AggregateError([primaryError, ...cleanupErrors], "Cleanup failed", { cause: primaryError });
          }
          if (cleanupErrors.length === 1) {
            throw cleanupErrors[0];
          }
          throw new AggregateError(cleanupErrors, "Multiple cleanup errors");
        }
      }
    } catch (err) {
      caughtError = err;
    }

    // Mesmo com a falha na reversão do Apex, a operação de DELETE foi executada
    const deleteCalls = pool.calls.filter((c) => c.sql.includes("DELETE FROM games WHERE id = $1"));
    assert.equal(deleteCalls.length, 1);
    assert.equal(deleteCalls[0].params[0], "promoted-custom-id");

    // E o erro do Apex foi propagado
    assert.ok(caughtError instanceof Error);
    assert.match(caughtError.message, /Simulated F2 Apex cleanup failure/);
  });

  await t.test("K03-F.2: Agrega múltiplas falhas de cleanup preservando erro primário com cause", async () => {
    const pool = createMockPool({
      initialCurated: false,
      failCleanupApexF2: true,
      failCleanupCustomF2: true,
    });
    let originalCurated = true;
    let originalApexReadSuccess = false;
    let customGameInserted = false;
    let primaryError: unknown = null;

    let caughtError: unknown;
    try {
      try {
        const origApex = await pool.query(
          "SELECT is_curated FROM games WHERE lower(btrim(name)) = lower('Apex Legends')",
        );
        originalCurated = origApex.rows[0]?.is_curated ?? true;
        originalApexReadSuccess = true;

        customGameInserted = true;

        throw new Error("Primary failure in K03-F.2 test body");
      } catch (err) {
        primaryError = err;
        throw err;
      } finally {
        const cleanupErrors: unknown[] = [];
        if (originalApexReadSuccess) {
          try {
            await pool.query(
              "UPDATE games SET is_curated = $1 WHERE lower(btrim(name)) = lower('Apex Legends')",
              [originalCurated],
            );
          } catch (err) {
            cleanupErrors.push(err);
          }
        }
        if (customGameInserted) {
          try {
            await pool.query("DELETE FROM games WHERE id = $1", ["promoted-custom-id"]);
          } catch (err) {
            cleanupErrors.push(err);
          }
        }
        if (cleanupErrors.length > 0) {
          if (primaryError) {
            throw new AggregateError(
              [primaryError, ...cleanupErrors],
              `Falha na restauração de K03-F.2: ${(cleanupErrors[0] as Error)?.message}`,
              { cause: primaryError },
            );
          }
          if (cleanupErrors.length === 1) {
            throw cleanupErrors[0];
          }
          throw new AggregateError(cleanupErrors, "Multiple cleanup errors");
        }
      }
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError instanceof AggregateError);
    assert.equal(caughtError.errors.length, 3);
    assert.match((caughtError.errors[0] as Error).message, /Primary failure in K03-F.2/);
    assert.match((caughtError.errors[1] as Error).message, /Simulated F2 Apex cleanup failure/);
    assert.match((caughtError.errors[2] as Error).message, /Simulated F2 Custom game cleanup failure/);
    assert.equal(caughtError.cause, primaryError);
  });
  /* eslint-enable no-unsafe-finally, preserve-caught-error */
});
