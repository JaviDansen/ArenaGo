import { assertSafeTestDatabase } from "./test-db-guard";

const names = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"] as const;

/** Validação pura da conexão desta fixture, antes de instanciar qualquer Pool. */
export function assertParticipationsReadTestDatabaseUrls(env: Record<string, string | undefined>): string {
  const urls = names.map((name) => {
    const value = assertSafeTestDatabase(env[name]);
    const parsed = new URL(value);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55432"
      || parsed.pathname !== "/arenago_events_test" || !parsed.username || !parsed.password
      || value.includes("?") || value.includes("#")) {
      throw new Error(`${name}: conexão local explícita sem parâmetros ou fragmentos obrigatória.`);
    }
    return value;
  });
  if (urls.some((value) => value !== urls[0])) {
    throw new Error("DATABASE_URL, DATABASE_DIRECT_URL e EVENTS_TEST_DATABASE_URL devem ser idênticas.");
  }
  return urls[0];
}
