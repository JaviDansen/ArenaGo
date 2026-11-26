import { randomBytes } from "node:crypto";
import { devNull } from "node:os";
import { selectIntegrationSuite } from "./integration-inventory";

export const integrationDestination = {
  address: "127.0.0.1",
  port: 55432,
  database: "arenago_events_test",
  role: "arenago",
} as const;

const urlKeys = ["DATABASE_URL", "DATABASE_DIRECT_URL", "EVENTS_TEST_DATABASE_URL"] as const;
const ttlKeys = [
  "ADMIN_IDEMPOTENCY_TTL_SECONDS",
  "EVALUATION_IDEMPOTENCY_TTL_SECONDS",
  "PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS",
  "STAFF_IDEMPOTENCY_TTL_SECONDS",
] as const;
const authKeys = ["JWT_SECRET", "JWT_TEMP_SECRET", "TOTP_ENCRYPTION_KEY", "TOTP_RECOVERY_HMAC_KEY"] as const;
export const windowsObserverVariableGroups = {
  installation: ['ProgramFiles','ProgramFiles(x86)','ProgramW6432','CommonProgramFiles','CommonProgramFiles(x86)','CommonProgramW6432'],
  profile: ['USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','PUBLIC','ALLUSERSPROFILE'],
  temporary: ['TEMP','TMP'],
  identity: ['USERNAME','USERDOMAIN','USERDOMAIN_ROAMINGPROFILE','LOGONSERVER','COMPUTERNAME','SESSIONNAME','OS','PROCESSOR_ARCHITECTURE','PROCESSOR_ARCHITEW6432','ComSpec'],
} as const;
const systemKeys = new Map([
  "PATH", "SystemRoot", "ComSpec", "TEMP", "TMP", "TMPDIR",
  ...(process.platform === "win32" ? ["USERPROFILE"] : ["HOME"]),
  ...(process.platform === 'win32' ? ['ProgramData','WINDIR','SYSTEMDRIVE', ...Object.values(windowsObserverVariableGroups).flat()] : []),
].map(name => [name.toUpperCase(), name]));
const environmentKeys = new Set([
  "NODE_ENV", "DOTENV_CONFIG_PATH", "EVENT_CLOSURE_JOB_TEST_ENABLED",
  ...urlKeys, ...ttlKeys, ...authKeys,
]);

export function integrationBlocked(reason: string): Error {
  return new Error("[SEGURANÇA BLOQUEADA] " + reason);
}

export const campaignDiagnosticStages = ['credentials','configuration','revision','reference','connection-attestation','connection',
  'sql-identity','lock-acquisition','lock-verification','lock-close','journal-admission','journal-save','journal-finish',
  'preflight','postflight','worker-launch','worker-bootstrap','worker-environment','ipc-wait','ipc-authorize','ipc-started',
  'worker-install','worker-connection','worker-sql-identity','runner','runner-summary','reconciliation','resources','worker-stop',
  'campaign','worker-exit','ipc-protocol'] as const;
export type CampaignDiagnosticStage = typeof campaignDiagnosticStages[number];
export type CampaignFailure = Readonly<{ stage: CampaignDiagnosticStage; code: string; exitCode?: number; signal?: string }>;
export class CampaignDiagnosticError extends Error {
  constructor(readonly diagnostic: CampaignFailure) {
    super(`[SEGURANÇA BLOQUEADA] campaign-stage=${diagnostic.stage}; code=${diagnostic.code}.`);
  }
}
export function campaignFailure(stage: CampaignDiagnosticStage, error: unknown): CampaignFailure {
  if (error instanceof CampaignDiagnosticError) return error.diagnostic;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  // Fixed OS/SQLSTATE codes only; never copy message/detail/hint/cause/query/URI/stack.
  const allowed = ['28P01','28000','3D000','42501','53300','57P01','57P02','57P03','08001','08006',
    'ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOENT','EACCES','EPERM','EPIPE','ERR_IPC_CHANNEL_CLOSED'];
  return { stage, code: typeof code === 'string' && allowed.includes(code) ? code : 'unavailable' };
}
export async function campaignStep<T>(stage: CampaignDiagnosticStage, work: () => T | Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) { throw new CampaignDiagnosticError(campaignFailure(stage, error)); }
}

function validateUrl(value: string | undefined): string {
  if (!value) throw integrationBlocked("As três URLs PostgreSQL são obrigatórias.");
  // Use the literal authority as well as URL parsing, which normalizes some hosts/ports.
  const { address, port, database, role } = integrationDestination;
  const credentials = /^postgres(?:ql)?:\/\/([^:@/?#\\\s]+):([^:@/?#\\\s]+)@([^/?#\\\s]+)\/([^/?#\\\s]+)$/u.exec(value);
  if (!credentials || value.trim() !== value || credentials[3] !== address + ":" + port || credentials[4] !== database) {
    throw integrationBlocked("URI inválida ou destino PostgreSQL fora da política local.");
  }
  try {
    const uri = new URL(value);
    const username = decodeURIComponent(credentials[1]);
    const password = decodeURIComponent(credentials[2]);
    if (uri.hostname !== address || uri.port !== String(port) || uri.pathname !== "/" + database
        || username !== role || !password.trim() || /[\u0000-\u001f\u007f]/u.test(password)) throw new Error();
  } catch {
    throw integrationBlocked("Role PostgreSQL ou credenciais inválidas.");
  }
  return value;
}

export function validateIntegrationEnvironment(suiteId: string, env: NodeJS.ProcessEnv) {
  const suite = selectIntegrationSuite(suiteId);
  if (env.NODE_ENV !== "test") throw integrationBlocked("NODE_ENV=test é obrigatório.");
  if (env.DOTENV_CONFIG_PATH !== devNull || env.DOTENV_CONFIG_OVERRIDE !== undefined) {
    throw integrationBlocked("Dotenv deve apontar ao dispositivo nulo, sem override.");
  }
  if (env.EVENT_CLOSURE_JOB_TEST_ENABLED !== "false" || suite.scheduler !== "disabled") {
    throw integrationBlocked("Scheduler incompatível com o perfil selecionado.");
  }
  const urls = urlKeys.map(key => validateUrl(env[key]));
  if (urls.some(url => url !== urls[0])) throw integrationBlocked("As três URLs devem ser textualmente idênticas.");

  if (Object.keys(env).some(key => env[key] !== undefined && !environmentKeys.has(key) && ![...systemKeys.values()].includes(key))) {
    throw integrationBlocked("O ambiente contém variáveis fora da lista autorizada.");
  }
  if (ttlKeys.some(key => {
    const value = env[key] ?? "";
    const ms = Number(value) * 1000;
    return !/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(ms) || !Number.isFinite(new Date(Date.now() + ms).getTime());
  })) throw integrationBlocked("Os quatro TTLs devem ser inteiros positivos válidos.");

  const auth = authKeys.map(key => env[key] ?? "");
  const [jwt, temporaryJwt, encryption, recovery] = auth;
  const base64Key = (key: string) => /^[A-Za-z0-9+/]{43}=$/u.test(key) && Buffer.from(key, "base64").toString("base64") === key;
  if (jwt.length < 32 || temporaryJwt.length < 32 || /[\u0000-\u001f\u007f]/u.test(jwt + temporaryJwt)
      || !base64Key(encryption) || !base64Key(recovery) || new Set(auth).size !== auth.length) {
    throw integrationBlocked("Credenciais sintéticas de autenticação inválidas ou repetidas.");
  }
  return { suite, connectionString: urls[0] };
}

export function buildIntegrationEnvironment(suiteId: string, connectionString: string, parent: NodeJS.ProcessEnv) {
  const env: NodeJS.ProcessEnv = Object.create(null);
  for (const [name, value] of Object.entries(parent)) {
    const allowed = systemKeys.get(name.toUpperCase());
    if (allowed && (process.platform === "win32" || name === allowed) && value !== undefined) env[allowed] = value;
  }
  for (const key of urlKeys) env[key] = connectionString;
  for (const key of ttlKeys) env[key] = "60";
  for (const key of authKeys) env[key] = randomBytes(32).toString("base64");
  env.NODE_ENV = "test";
  env.DOTENV_CONFIG_PATH = devNull;
  env.EVENT_CLOSURE_JOB_TEST_ENABLED = "false";
  validateIntegrationEnvironment(suiteId, env);
  return env;
}
