import { execFile, execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import { executePilotCampaign } from "./campaign-orchestrator";
import { fileCampaignJournal } from "./campaign-journal";
import { superviseCampaignChild } from "./campaign-process";
import { campaignSpawnEnvironment, windowsObserverEnvironment } from "./campaign-child-protocol";
import { loadIndependentReference, readTerminalPassword } from "./read-postgres-preparation";
import { integrationBlocked, windowsObserverVariableGroups, campaignStep, campaignFailure, CampaignDiagnosticError } from "./integration-environment";
import { attestIntegrationIdentity, type IntegrationPreflightPoolFactory } from "./integration-db-guard";
import type { WindowsPostgresIdentity } from "./integration-preparation";

const exec = promisify(execFile);
const executionId = randomUUID();
let mainInvocations = 0;
let pilotInvocations = 0;
let currentCampaign: string | undefined;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
function trace(event: string, campaignId?: string, worker?: { runId: string; pid: number; ppid: number; invocations: number },
  diagnostic?: CampaignDiagnosticError['diagnostic']) {
  if (campaignId && uuid.test(campaignId)) currentCampaign = campaignId;
  // Fixed fields only. Never print arguments, environment, URLs or exception text.
  try { process.stderr.write('[INFRA_PILOT_TRACE] ' + JSON.stringify({ event, executionId,
    pid: process.pid, ppid: process.ppid, campaignId: currentCampaign ?? null,
    mainInvocations, pilotInvocations, ...(worker ? { worker } : {}),
    ...(diagnostic ? { diagnostic: { stage: diagnostic.stage, code: diagnostic.code } } : {}) }) + '\n'); }
  catch { /* tracing cannot alter authorization or cleanup */ }
}
type CheckStage = 'entry' | 'observer-environment' | 'windows-observer' | 'windows-json' | 'windows-fingerprint'
  | 'journal-observer' | 'journal-json' | 'journal-continuity' | 'reference-authority';
class PilotCheckError extends Error {}
export function pilotCheckDiagnostic(stage: CheckStage, error: unknown): string {
  const e = error && typeof error === 'object' ? error as { code?: unknown; killed?: unknown; stderr?: unknown } : {};
  // Never emit driver/child messages, arguments, environment, stack or raw streams.
  // Windows process status is a DWORD, not a Unix 8-bit exit status.
  const code = typeof e.code === 'number' && Number.isInteger(e.code) && e.code >= -2147483648 && e.code <= 4294967295 ? String(e.code)
    : typeof e.code === 'string' && ['ENOENT','EACCES','EPERM','EINVAL','UNKNOWN','ERR_INVALID_ARG_VALUE','ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(e.code) ? e.code : 'unavailable';
  const observer = typeof e.stderr === 'string' ? /\[INFRA_OBSERVER:(paths|listener|processes|data|fingerprint|recheck|domain)\]/u.exec(e.stderr)?.[1] : undefined;
  const detail = typeof e.stderr === 'string' ? /\[INFRA_DOMAIN:(identity|elevation|arguments|path|volume|reparse|acl-read|owner|rights|inheritance|children|fsutil|file-id|cim|approval-read|approval-json|approval-path|approval-id|approval-sid|serialization):(authority|reference|approval|domain-record|journal|child)\]/u.exec(e.stderr) : null;
  return `[SEGURANÇA BLOQUEADA] check-stage=${stage}; code=${code}; timeout=${e.killed === true}; observer=${observer ?? 'unavailable'}${detail ? `; domain-stage=${detail[1]}; area=${detail[2]}` : ''}.`;
}
async function checkStep<T>(stage: CheckStage, work: () => T | Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) { throw new PilotCheckError(pilotCheckDiagnostic(stage, error)); }
}
/** Shared verbatim by the operational probe and supervisor; no SQL or credential input. */
export function pilotWindowsObserverInvocation(bin: string, data: string, groups?: readonly (keyof typeof windowsObserverVariableGroups)[]) {
  const env = windowsObserverEnvironment(process.env, groups);
  return {
    file: join(env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    args: ['-NoProfile', '-NonInteractive', '-File', join(__dirname, 'inspect-postgres-windows.ps1'),
      '-ExpectedBinDirectory', bin, '-ExpectedDataDirectory', data],
    options: { windowsHide: true, timeout: 30_000, maxBuffer: 32_768, encoding: 'utf8' as const, env },
  };
}
export function pilotJournalObserverInvocation() {
  const env = windowsObserverEnvironment(process.env);
  if (!env.ProgramData) throw integrationBlocked('ProgramData ausente.');
  return {
    file: join(env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    args: ['-NoProfile', '-NonInteractive', '-File', join(__dirname, 'inspect-pilot-domain.ps1'),
      '-Directory', join(env.ProgramData, 'ArenaGO/integration/127.0.0.1-55432-arenago_events_test'),
      '-Authority', join(env.ProgramData, 'ArenaGO/integration-authority')],
    options: { windowsHide: true, timeout: 30_000, maxBuffer: 32_768, encoding: 'utf8' as const, env },
  };
}
const ids: Record<string, string[]> = {
  D06: ["admin-external-queue-http"], D09: ["admin-close-http"],
  both: ["admin-external-queue-http", "admin-close-http"],
};

async function main() {
  mainInvocations++;
  trace('executor-main-enter');
  const [action, bin, data, fingerprint, ...extra] = process.argv.slice(2);
  if (process.platform !== "win32" || process.env.NODE_ENV !== "test" || !process.env.ProgramData || !process.env.SystemRoot || extra.length
      || !(action === "check" || Object.hasOwn(ids, action))
      || !bin || !data || !/^[a-f0-9]{64}$/u.test(fingerprint ?? "")
      || Object.keys(process.env).some(key => /^(PG|NODE_OPTIONS$|NODE_PATH$|NODE_DEBUG|NODE_PG_FORCE_NATIVE$)/iu.test(key))) {
    throw new PilotCheckError(pilotCheckDiagnostic('entry', undefined));
  }
  const programData = process.env.ProgramData;
  const directory = join(programData, "ArenaGO/integration/127.0.0.1-55432-arenago_events_test");
  const authority = join(programData, "ArenaGO/integration-authority");
  let identity: WindowsPostgresIdentity | undefined;
  let domain: string | undefined;
  async function observe() {
    const windowsCall = await checkStep('observer-environment', () => pilotWindowsObserverInvocation(bin, data));
    const output = await checkStep('windows-observer', () => exec(windowsCall.file, windowsCall.args, windowsCall.options));
    const operational = await checkStep('windows-json', () => JSON.parse(output.stdout) as WindowsPostgresIdentity);
    await checkStep('windows-fingerprint', () => {
      if (!operational || operational.instanceSha256 !== fingerprint || (identity && JSON.stringify(operational) !== JSON.stringify(identity))) throw new Error();
    });
    identity = operational;
    const journalCall = await checkStep('observer-environment', () => pilotJournalObserverInvocation());
    const currentDomain = (await checkStep('journal-observer', () => exec(journalCall.file, journalCall.args, journalCall.options))).stdout.trim();
    await checkStep('journal-json', () => {
      const value: unknown = JSON.parse(currentDomain);
      if (!value || typeof value !== 'object' || !('path' in value) || value.path !== directory
          || !('directoryId' in value) || typeof value.directoryId !== 'string' || !/^[a-f0-9]+:0x[a-f0-9]{16,32}$/iu.test(value.directoryId)
          || !('operatorSid' in value) || typeof value.operatorSid !== 'string' || !/^S-1-5-21-(\d+-){3}\d+$/u.test(value.operatorSid)) throw new Error();
    });
    await checkStep('journal-continuity', () => { if (domain && currentDomain !== domain) throw new Error(); });
    domain = currentDomain;
  }
  await observe();
  const reference = await checkStep('reference-authority', () => loadIndependentReference(programData, identity!));
  if (action === "check") {
    console.log("Windows, autoridade e domínio do piloto conferidos. Nenhuma conexão SQL aberta.");
    return;
  }
  const password = await campaignStep('credentials', () => readTerminalPassword(process.stdin, message => { process.stderr.write(message); }));
  const url = "postgresql://arenago:" + password + "@127.0.0.1:55432/arenago_events_test";
  const pg = { connectionString: url, ssl: false as const, connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000, query_timeout: 6_000, application_name: "arenago-pilot-supervisor" };
  async function connect(config: object = {}) {
    await campaignStep('connection-attestation', observe);
    const client = await campaignStep('configuration', () => new Client({ ...pg, ...config }));
    client.on("error", () => {});
    try { await client.connect(); return client; }
    catch (error) {
      await client.end().catch(error => { console.error(new CampaignDiagnosticError(campaignFailure('lock-close', error)).message); });
      throw new CampaignDiagnosticError(campaignFailure('connection', error));
    }
  }
  let continuity: string | undefined;
  let supervisorPid: number | undefined;
  const readPool: IntegrationPreflightPoolFactory = config => {
    let client: Client | undefined;
    return {
      async connect() {
        client = await connect(config);
        return {
          async query(sql) {
            if (sql.startsWith("BEGIN ")) {
              const opened = await client!.query(sql);
              const session = (await client!.query(`SELECT current_setting('transaction_read_only') AS ro,
                current_setting('transaction_isolation') AS isolation,
                current_setting('search_path') AS path, current_setting('TimeZone') AS zone,
                current_setting('session_replication_role') AS replication`)).rows[0];
              if (session.ro !== "on" || session.isolation !== "repeatable read" || session.path !== "pg_catalog"
                  || session.zone !== "UTC" || session.replication !== "origin") {
                throw integrationBlocked("Sessão de preflight incompatível.");
              }
              const others = await client!.query(`SELECT 1 FROM pg_catalog.pg_stat_activity
                WHERE datname=current_database() AND pid<>pg_backend_pid() AND pid<>$1`, [supervisorPid]);
              if (others.rowCount) throw integrationBlocked("Outro escritor ou conexão presente na janela piloto.");
              return opened;
            }
            if (sql === "ROLLBACK") {
              const rows = (await client!.query(`SELECT
                (SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM public.games g) AS games,
                (SELECT jsonb_agg(to_jsonb(q) ORDER BY id) FROM public.questionnaire_versions q) AS questionnaires`)).rows;
              const digest = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
              if (continuity && continuity !== digest) throw integrationBlocked("Continuidade do baseline divergente.");
              continuity = digest;
            }
            return client!.query(sql);
          },
          release() { /* this private session is closed by end, also after failed ROLLBACK */ },
        };
      },
      async end() { await client?.end(); },
    };
  };
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  const revision = await campaignStep('revision', () => ({
    branch: execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  }));
  pilotInvocations++;
  trace('execute-pilot-call');
  const result = await campaignStep('campaign', () => executePilotCampaign({
    mode: "real", selection: { suites: ids[action] }, connectionString: url,
    parentEnvironment: process.env, revision, signal: controller.signal, timeoutMs: 300_000, trace,
  }, {
    reference: {
      approval: () => ({ source: "protected-programdata", sha256: reference.sha256, kind: "homologated" }),
      readApprovedSource: async () => { await observe(); return readFile(join(authority, "reference-v2.json")); },
    },
    async openLockConnection() {
      const client = await connect();
      try { supervisorPid = (await campaignStep('sql-identity', () => client.query("SELECT pg_backend_pid() AS pid"))).rows[0].pid; }
      catch (error) { await client.end(); throw error; }
      return {
        query: sql => client.query(sql),
        close: () => campaignStep('lock-close', () => client.end()),
        onDisconnect(listener) {
          client.on("error", listener);
          client.on("end", listener);
          return () => { client.off("error", listener); client.off("end", listener); };
        },
      };
    },
    createReadPool: readPool,
    journal: {
      async claim(record) {
        await observe();
        const handle = await campaignStep('journal-admission', () => fileCampaignJournal(directory).claim(record));
        return {
          async save(next) { await campaignStep('connection-attestation', observe); await campaignStep('journal-save', () => handle.save(next)); },
          async finish() { await campaignStep('connection-attestation', observe); await campaignStep('journal-finish', () => handle.finish()); },
        };
      },
    },
    launch(suite, env, request) {
      const child = spawn(process.execPath, ["--require", join(__dirname, "pilot-loader.cjs"),
        join(__dirname, "pilot-worker.ts"), suite, request.campaignId, request.referenceSha256, bin, data, fingerprint], {
        cwd: resolve(__dirname, "../.."), env: campaignSpawnEnvironment(env),
        windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      child.once('close', () => trace('worker-close', request.campaignId));
      return superviseCampaignChild(child, { campaignId: request.campaignId,
        trace: (event, worker) => trace(event, request.campaignId, worker) });
    },
    async resourcesReleased() {
      await observe();
      const client = await connect();
      try {
        await campaignStep('sql-identity', () => attestIntegrationIdentity(client, 180006));
        const r = await client.query(`SELECT
          NOT EXISTS (SELECT FROM pg_catalog.pg_stat_activity
            WHERE datname=current_database() AND pid<>pg_backend_pid() AND pid<>$1) AS clear,
          NOT EXISTS (SELECT FROM pg_catalog.pg_prepared_xacts WHERE database=current_database()) AS prepared_clear`, [supervisorPid]);
        return r.rows[0]?.clear === true && r.rows[0]?.prepared_clear === true;
      } finally { await client.end(); }
    },
  }));
  console.log(JSON.stringify(result));
  trace('executor-result', result.id);
  process.exitCode = result.phase === "clean" ? 0 : result.terminalPersistence === 'failed' ? 2 : 1;
}
if (require.main === module) { trace('executor-entry'); process.once('exit', () => trace('executor-process-exit')); void main().catch((error: unknown) => {
  trace('executor-catch', undefined, undefined, error instanceof CampaignDiagnosticError ? error.diagnostic : undefined);
  console.error(error instanceof PilotCheckError || error instanceof CampaignDiagnosticError ? error.message
    : "[SEGURANÇA BLOQUEADA] Piloto inconclusivo. Preserve journal e marcador para revisão manual.");
  process.exitCode = 2;
}); }
