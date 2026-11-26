import { run } from "node:test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Client, Pool, type PoolConfig } from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runAsCampaignChild, windowsObserverEnvironment } from "./campaign-child-protocol";
import { authorizePilotSuite } from "./pilot-authorization";
import { attestIntegrationIdentity } from "./integration-db-guard";
import { integrationBlocked, campaignStep, campaignFailure, type CampaignDiagnosticStage } from "./integration-environment";
import type { Tally } from "./campaign-journal";
let workerStage: CampaignDiagnosticStage = 'worker-bootstrap';
const workerRunId = randomUUID();
let workerInvocations = 0;
function traceWorker(event: string) {
  const campaignId = process.argv[3];
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(campaignId ?? '') || !process.connected) return;
  try { process.send?.({ type: 'trace', event, campaignId, runId: workerRunId, pid: process.pid, ppid: process.ppid,
    invocations: workerInvocations }, () => {}); }
  catch { /* tracing cannot affect IPC authorization */ }
}
function reportWorker(stage: CampaignDiagnosticStage, error?: unknown) {
  workerStage = stage;
  if (process.connected && process.send) process.send({ type: 'diagnostic', ...campaignFailure(stage, error),
    ...(error !== undefined ? { failure: true } : {}) }, () => {});
}

export function createPilotClient(attestWindows: () => Promise<void>): typeof Client {
  return class PilotClient extends Client {
    connect(): Promise<Client>;
    connect(callback: ((error: Error) => void) | ((error: null, client: Client) => void)): void;
    connect(callback?: ((error: Error) => void) | ((error: null, client: Client) => void)): Promise<Client> | void {
      const opening = (async () => {
        try {
          await attestWindows();
          await super.connect();
          return this;
        } catch (error) {
          reportWorker(workerStage, error);
          await this.end().catch(() => undefined);
          throw integrationBlocked("Conexão física recusada.");
        }
      })();
      if (callback) {
        // pg declares separate success/error callback shapes. Invoke each with its documented arguments.
        void opening.then(client => Reflect.apply(callback, undefined, [null, client]),
          error => Reflect.apply(callback, undefined, [error]));
        return;
      }
      return opening;
    }
  };
}

async function worker() {
  workerInvocations++;
  traceWorker('worker-main-enter');
  reportWorker('worker-environment');
  const [suite, campaignId, referenceSha256, bin, data, fingerprint] = process.argv.slice(2);
  if (process.argv.length !== 8 || !["admin-external-queue-http", "admin-close-http"].includes(suite)) throw new Error();
  reportWorker('ipc-wait');
  return runAsCampaignChild(suite, { campaignId, referenceSha256 }, async () => {
    reportWorker('ipc-started');
    authorizePilotSuite(suite);
    reportWorker('worker-install');
    const attestWindows = promisify(execFile);
    // The reviewed worker only needs the fixed Windows observer as a subprocess.
    // Capture that call before refusing arbitrary process launches from suite/application code.
    const subprocess = require("node:child_process") as Record<string, unknown>;
    for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
      subprocess[name] = () => { throw integrationBlocked("Subprocesso fora da atestação piloto."); };
    }
    require("node:module").syncBuiltinESMExports();
    const PilotClient = createPilotClient(async () => {
          reportWorker('connection-attestation');
          const output = await attestWindows(resolve(process.env.SystemRoot!, "System32/WindowsPowerShell/v1.0/powershell.exe"),
            ["-NoProfile", "-NonInteractive", "-File", resolve(__dirname, "inspect-postgres-windows.ps1"),
              "-ExpectedBinDirectory", bin, "-ExpectedDataDirectory", data],
            { windowsHide: true, timeout: 30_000, encoding: "utf8", maxBuffer: 16_384,
              env: windowsObserverEnvironment(process.env) });
          if (JSON.parse(output.stdout).instanceSha256 !== fingerprint) throw new Error();
          reportWorker('worker-connection');
    });
    const pools: Pool[] = [];
    // Installed before importing either suite or AppModule. pg-pool awaits onConnect
    // before releasing each newly created physical client, including replacements.
    class PilotPool extends Pool {
      constructor(options: PoolConfig) {
        if (options.connectionString !== process.env.DATABASE_URL || "Client" in options || options.onConnect) {
          throw integrationBlocked("Pool fora do contrato piloto.");
        }
        const config: PoolConfig & { Client: typeof Client } = {
          ...options, Client: PilotClient, ssl: false, connectionTimeoutMillis: 45_000,
          application_name: "arenago-pilot-" + campaignId,
          onConnect: async client => {
            reportWorker('worker-sql-identity');
            await campaignStep('worker-sql-identity', () => attestIntegrationIdentity(client, 180006));
          },
        };
        super(config);
        pools.push(this);
      }
    }
    (require("pg") as { Pool: typeof Pool }).Pool = PilotPool;
    reportWorker('runner');
    traceWorker('runner-enter');
    const runner = run({ files: [resolve(__dirname, "../integration", suite + ".integration.test.ts")],
      isolation: "none", concurrency: 1, forceExit: false });
    let result: Tally | undefined;
    runner.on("test:summary", summary => {
      if (summary.file !== undefined) return;
      const c = summary.counts;
      if (c.todo || c.suites || c.tests !== (suite === "admin-close-http" ? 70 : 41)) return;
      const failed = c.tests - c.passed - c.skipped - c.cancelled;
      result = { passed: c.passed, failed, skipped: c.skipped, cancelled: c.cancelled };
    });
    try {
      for await (const _event of runner) { /* diagnostics stay inside the worker */ }
      reportWorker('runner-summary');
      if (!result) throw integrationBlocked("Resumo completo ausente.");
      if (pools.some(pool => pool.totalCount !== 0 || pool.waitingCount !== 0)) {
        throw integrationBlocked("Pools residuais no filho.");
      }
      traceWorker('runner-finished');
      return result;
    } catch (error) {
      reportWorker(workerStage, error);
      await Promise.allSettled(pools.map(pool => pool.end()));
      throw integrationBlocked("Resultado ou encerramento do piloto inconclusivo.");
    }
  }, traceWorker);
}
if (require.main === module) { traceWorker('worker-entry'); void worker().then(code => { process.exitCode = code; }, error => {
  traceWorker('worker-catch');
  reportWorker(workerStage, error);
  process.exitCode = 2;
  // Failures before runAsCampaignChild's finally must not keep the failed child alive via IPC.
  if (process.connected) process.disconnect?.();
}); }
