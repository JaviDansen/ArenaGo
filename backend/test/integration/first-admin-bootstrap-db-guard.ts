const names = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"] as const;

/** Guarda exclusiva da B1; não amplia a allowlist das demais integrações. */
export function assertFirstAdminBootstrapTestDatabaseUrls(env: Record<string, string | undefined>): string {
  if (env.NODE_ENV !== "test") {
    throw new Error("[SEGURANÇA BLOQUEADA] A integração B1 exige NODE_ENV=test.");
  }

  const urls = names.map((name) => {
    const value = env[name];
    if (!value || value.trim() !== value) {
      throw new Error(`[SEGURANÇA BLOQUEADA] ${name} explícita é obrigatória.`);
    }

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`[SEGURANÇA BLOQUEADA] ${name} inválida.`);
    }

    if ((parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:")
      || parsed.hostname !== "127.0.0.1" || parsed.port !== "55432"
      || parsed.pathname !== "/arenago_bootstrap_test" || !parsed.username || !parsed.password
      || value.includes("?") || value.includes("#")) {
      throw new Error(`[SEGURANÇA BLOQUEADA] ${name} exige credenciais explícitas e exatamente 127.0.0.1:55432/arenago_bootstrap_test, sem query ou fragmento.`);
    }
    return value;
  });

  if (urls.some((value) => value !== urls[0])) {
    throw new Error("[SEGURANÇA BLOQUEADA] As três URLs da integração B1 devem ser idênticas.");
  }
  return urls[0];
}
