import assert from "node:assert/strict";
import { ChildProcess, execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { campaignSpawnEnvironment, windowsObserverEnvironment } from "../infrastructure/campaign-child-protocol";
import { within } from "../infrastructure/campaign-deadline";
import { acquireCampaignLock } from "../infrastructure/campaign-lock";
import { campaignDestination, fileCampaignJournal, type CampaignEvidence, type CampaignJournal } from "../infrastructure/campaign-journal";
import { executePilotCampaign, orchestrateCampaign } from "../infrastructure/campaign-orchestrator";
import { launchInertCampaignChild, superviseCampaignChild, type LaunchCampaignChild } from "../infrastructure/campaign-process";
import { loadCampaignReference } from "../infrastructure/campaign-reference";
import { inspectCampaign, selectCampaign } from "../infrastructure/campaign-selection";
import { checkoutSchema } from "../infrastructure/integration-schema";
import { buildIntegrationEnvironment, windowsObserverVariableGroups, campaignFailure, campaignStep, campaignDiagnosticStages, CampaignDiagnosticError } from "../infrastructure/integration-environment";
import type { StructuralReference } from "../infrastructure/integration-structural-reference";
import { CURATED_GAMES } from "../../src/games/games.types";
import { DEFAULT_QUESTIONNAIRE_DEFINITION, DEFAULT_QUESTIONNAIRE_VERSION } from "../../src/profile/profile-questionnaire.types";
import { Client } from "pg";
import { createPilotClient } from "../infrastructure/pilot-worker";
import { pilotCheckDiagnostic } from "../infrastructure/pilot-executor";
const { errorMetadata } = require('../infrastructure/probe-pilot-windows-observer.cjs') as {
  errorMetadata(error: unknown, spawned: boolean, stderr: string): { code: unknown; statusHex: unknown; spawned: boolean; securityException: boolean; domainStage: unknown; checkDomainStage: unknown };
};

test('D1.3 diagnóstico completo conserva SQLSTATE seguro e exclui mensagens credenciais e causas', async () => {
  for (const stage of campaignDiagnosticStages) {
    const failure = campaignFailure(stage, { code: '28P01', message: 'fixture-secret', detail: 'fixture-secret', cause: 'fixture-secret' });
    assert.deepEqual(failure, { stage, code: '28P01' });
    assert.ok(!JSON.stringify(failure).includes('fixture-secret'));
    await assert.rejects(campaignStep(stage, () => { throw { code: 'fixture-secret', message: 'fixture-secret' }; }),
      error => error instanceof CampaignDiagnosticError && error.diagnostic.stage === stage && error.diagnostic.code === 'unavailable'
        && !error.message.includes('fixture-secret'));
  }
});

test('D1.3 falha de persistência terminal é visível e conserva recuperação pendente', async () => {
  const { request, dependencies } = campaignFixture('incomplete');
  const originalClaim = dependencies.journal.claim.bind(dependencies.journal);
  let attempted = 0;
  const result = await orchestrateCampaign(request, { ...dependencies, journal: {
    async claim(record) {
      const handle = await originalClaim(record);
      return { ...handle, async save(next) {
        if (next.phase === 'interrupted' || next.phase === 'inconsistent') { attempted++; throw Error('fixture-secret'); }
        await handle.save(next);
      } };
    },
  } });
  assert.equal(result.phase, 'interrupted');
  assert.equal(result.recoveryPending, true);
  assert.equal(result.terminalPersistence, 'failed');
  assert.equal(attempted, 2);
  assert.equal(result.cleanupFailures?.filter(x => x.stage === 'journal-save').length, 2);
  assert.ok(!JSON.stringify(result).includes('fixture-secret'));
});

test('D1.3 códigos Windows completos e sonda distinguem spawn de política sem expor erro bruto', () => {
  assert.match(pilotCheckDiagnostic('windows-observer', { code: 4294901760 }), /code=4294901760;/u);
  assert.match(pilotCheckDiagnostic('windows-observer', { code: -2146232576 }), /code=-2146232576;/u);
  assert.match(pilotCheckDiagnostic('windows-observer', { code: 'EINVAL' }), /code=EINVAL;/u);
  const result = errorMetadata({ code: 4294901760, message: 'fixture-secret' }, true, 'PSSecurityException fixture-secret');
  assert.equal(result.code, 4294901760);
  assert.equal(result.statusHex, '0xffff0000');
  assert.equal(result.spawned, true);
  assert.equal(result.securityException, true);
  assert.ok(!JSON.stringify(result).includes('fixture-secret'));
  assert.equal(errorMetadata({ code: 'ENOENT' }, false, '').spawned, false);
});

test('D1.3 diagnóstico do check conserva etapa e recusa mensagens e streams brutos', () => {
  const secret = 'fixture-password-token-url';
  const message = pilotCheckDiagnostic('windows-observer', { code: 1, killed: false,
    stderr: secret + ' [INFRA_OBSERVER:processes] ' + secret, stdout: secret, message: secret });
  assert.equal(message, '[SEGURANÇA BLOQUEADA] check-stage=windows-observer; code=1; timeout=false; observer=processes.');
  assert.ok(!message.includes(secret));
  const domainError = { code: 1, stderr: '[INFRA_OBSERVER:domain] [INFRA_DOMAIN:approval-id:journal] ' + secret };
  const domainMessage = pilotCheckDiagnostic('journal-observer', domainError);
  assert.equal(domainMessage, '[SEGURANÇA BLOQUEADA] check-stage=journal-observer; code=1; timeout=false; observer=domain; domain-stage=approval-id; area=journal.');
  assert.deepEqual(errorMetadata(domainError, true, domainError.stderr).domainStage, ['approval-id','journal']);
  assert.deepEqual(errorMetadata(domainError, true, domainMessage).checkDomainStage, ['approval-id','journal']);
  assert.equal(errorMetadata(domainError, true, '[INFRA_DOMAIN:' + secret + ':journal]').domainStage, null);
  assert.equal(pilotCheckDiagnostic('journal-observer', { code: secret, killed: true, stderr: '[INFRA_OBSERVER:' + secret + ']' }),
    '[SEGURANÇA BLOQUEADA] check-stage=journal-observer; code=unavailable; timeout=true; observer=unavailable.');
  for (const stage of ['entry','observer-environment','windows-json','windows-fingerprint','journal-json','journal-continuity','reference-authority'] as const) {
    assert.equal(pilotCheckDiagnostic(stage, new Error(secret)),
      `[SEGURANÇA BLOQUEADA] check-stage=${stage}; code=unavailable; timeout=false; observer=unavailable.`);
  }
});

test("D1.2 PilotClient preserva Promise, callback e ordem da atestação", async t => {
  const calls: string[] = [];
  t.mock.method(Client.prototype, "connect", async function (this: Client) { calls.push("connect"); return this; });
  const PilotClient = createPilotClient(async () => { calls.push("attest"); });
  const client = new PilotClient();
  assert.equal(await client.connect(), client);
  await new Promise<void>((resolve, reject) => {
    const returned = client.connect((error: Error | null, connected?: Client) => {
      if (error) { reject(error); return; }
      assert.equal(connected, client);
      resolve();
    });
    assert.equal(returned, undefined);
  });
  assert.deepEqual(calls, ["attest", "connect", "attest", "connect"]);
});

test("D1.2 PilotClient encerra rejeições antes de publicar erro sanitizado", async t => {
  const calls: string[] = [];
  t.mock.method(Client.prototype, "connect", async () => { calls.push("connect"); throw Error("fixture-secret"); });
  t.mock.method(Client.prototype, "end", async () => { calls.push("end"); });
  for (const stage of ["attest", "connect"]) {
    const PilotClient = createPilotClient(async () => {
      calls.push("attest");
      if (stage === "attest") throw Error("fixture-secret");
    });
    await assert.rejects(new PilotClient().connect(), { message: "[SEGURANÇA BLOQUEADA] Conexão física recusada." });
    await new Promise<void>(resolve => {
      new PilotClient().connect((error: Error) => {
        assert.equal(error.message, "[SEGURANÇA BLOQUEADA] Conexão física recusada.");
        assert.equal(calls.at(-1), "end");
        resolve();
      });
    });
  }
  assert.deepEqual(calls, ["attest", "end", "attest", "end", "attest", "connect", "end", "attest", "connect", "end"]);
});

const suite = "admin-external-queue-http";
const schema = checkoutSchema();
const reference: StructuralReference = {
  formatVersion: 2, postgresVersionNum: 180006, schemas: ["public", "drizzle"], migrations: schema.migrations,
  objects: [{
    kind: "table", schema: "public", name: "synthetic", relation: null, signature: null,
    properties: { relationKind: "r", persistence: "p", rowSecurity: false, forceRowSecurity: false },
  }],
};
const uri = "postgresql://arenago:synthetic-not-a-password@127.0.0.1:55432/arenago_events_test";
const tally = { passed: 1, failed: 0, skipped: 0, cancelled: 0 };
const ok = { exitCode: 0, tally };
const revision = { branch: "chore/integration-test-infrastructure", commit: "0".repeat(40) };

test("D1.2 observador recebe ambiente mínimo sem credenciais no subprocesso", async () => {
  const parent = {
    SystemRoot: "C:\\Windows", ProgramData: "C:\\ProgramData", PATH: "C:\\untrusted",
    TEMP: "C:\\fixture-parent-temp", USERPROFILE: "C:\\fixture-parent-profile", TMP: "C:\\fixture-parent-tmp",
    ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    ProgramW6432: 'C:\\Program Files', CommonProgramFiles: 'C:\\Program Files\\Common Files',
    'CommonProgramFiles(x86)': 'C:\\Program Files (x86)\\Common Files', CommonProgramW6432: 'C:\\Program Files\\Common Files',
    HOMEDRIVE: 'C:', HOMEPATH: '\\Users\\fixture', APPDATA: 'C:\\Users\\fixture\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\fixture\\AppData\\Local', USERNAME: 'fixture', USERDOMAIN: 'fixture-machine',
    DATABASE_URL: uri, DATABASE_DIRECT_URL: uri, EVENTS_TEST_DATABASE_URL: uri,
    PGPASSWORD: "fixture-pg-secret", JWT_SECRET: "fixture-jwt-secret", JWT_TEMP_SECRET: "fixture-temp-secret",
    TOTP_ENCRYPTION_KEY: "fixture-totp-secret", TOTP_RECOVERY_HMAC_KEY: "fixture-recovery-secret",
    NODE_OPTIONS: "--invalid-fixture-option", PSModulePath: "C:\\untrusted-modules", OTHER_SECRET: "fixture-other-secret",
  };
  const snapshot = { ...parent };
  const env = windowsObserverEnvironment(parent);
  const { stdout } = await promisify(execFile)(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.env))"], { env });
  const received = JSON.parse(stdout) as Record<string, string>;
  const allowed = new Set(["SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "PROGRAMDATA", "PATH",
    "HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "USERDOMAIN", "USERNAME", "TEMP", "USERPROFILE",
    ...Object.values(windowsObserverVariableGroups).flat().map(key => key.toUpperCase())]);
  for (const [key, value] of Object.entries(received)) {
    assert.ok(allowed.has(key.toUpperCase()), "unexpected subprocess variable: " + key);
  }
  assert.equal(received.SystemRoot, parent.SystemRoot);
  assert.equal(received.ProgramData, parent.ProgramData);
  for (const names of Object.values(windowsObserverVariableGroups)) {
    for (const name of names) {
      const expected = Object.entries(parent).find(([key]) => key.toUpperCase() === name.toUpperCase())?.[1];
      if (expected !== undefined) assert.equal(received[name], expected);
    }
  }
  for (const name of ['DATABASE_URL','DATABASE_DIRECT_URL','EVENTS_TEST_DATABASE_URL','PGPASSWORD','JWT_SECRET','JWT_TEMP_SECRET',
    'TOTP_ENCRYPTION_KEY','TOTP_RECOVERY_HMAC_KEY','NODE_OPTIONS','PSModulePath','OTHER_SECRET','DOTENV_CONFIG_PATH']) assert.equal(received[name], undefined);
  assert.equal(received.PATH, "C:\\Windows\\System32;C:\\Windows\\System32\\WindowsPowerShell\\v1.0");
  assert.equal(windowsObserverEnvironment(parent, []).ProgramFiles, undefined);
  assert.equal(windowsObserverEnvironment(parent, ['installation']).ProgramFiles, parent.ProgramFiles);
  assert.equal(windowsObserverEnvironment(parent, ['installation']).USERPROFILE, '');
  if (process.platform === 'win32') {
    const workerEnvironment = buildIntegrationEnvironment(suite, uri, parent);
    const launched = campaignSpawnEnvironment(workerEnvironment);
    assert.deepEqual(windowsObserverEnvironment(launched), env);
    assert.equal(launched.USERDOMAIN, parent.USERDOMAIN);
    assert.equal(launched.HOMEPATH, parent.HOMEPATH);
  }
  assert.deepEqual(parent, snapshot);
});

test("D1.2 todas as chamadas PowerShell do piloto usam isolamento explícito", async () => {
  const worker = await readFile(resolve(__dirname, "../infrastructure/pilot-worker.ts"), "utf8");
  const executor = await readFile(resolve(__dirname, "../infrastructure/pilot-executor.ts"), "utf8");
  assert.match(worker, /env: windowsObserverEnvironment\(process\.env\)/u);
  assert.match(executor, /export function pilotJournalObserverInvocation\(\)[\s\S]+?const env = windowsObserverEnvironment\(process\.env\)/u);
  assert.match(executor, /const env = windowsObserverEnvironment\(process\.env, groups\)/u);
  assert.match(executor, /exec\(windowsCall\.file, windowsCall\.args, windowsCall\.options\)/u);
  assert.match(executor, /exec\(journalCall\.file, journalCall\.args, journalCall\.options\)/u);
  assert.deepEqual(windowsObserverEnvironment({ systemroot: "C:\\Windows" }), windowsObserverEnvironment({ SystemRoot: "C:\\Windows" }));
  assert.throws(() => windowsObserverEnvironment({}), /SystemRoot/u);
});

test("D1.2 rejeita suítes fora do piloto antes de abrir recursos", async () => {
  const { request, dependencies, events } = campaignFixture();
  await assert.rejects(executePilotCampaign({ ...request, mode: "real", selection: { suite: "auth" } }, dependencies), /Somente D06/u);
  assert.deepEqual(events, []);
});

test("D1.2 recusa autoridade sintética antes da primeira conexão real", async () => {
  const { request, dependencies, events } = campaignFixture();
  let reads = 0;
  let resourceRequests = 0;
  const guardedDependencies: Parameters<typeof executePilotCampaign>[1] = {
    ...dependencies,
    reference: {
      ...dependencies.reference,
      async readApprovedSource(source) {
        reads++;
        return dependencies.reference.readApprovedSource(source);
      },
    },
    async openLockConnection(environment) {
      resourceRequests++;
      return dependencies.openLockConnection(environment);
    },
    createReadPool(...args) {
      resourceRequests++;
      return dependencies.createReadPool(...args);
    },
    journal: { async claim(record) {
      resourceRequests++;
      return dependencies.journal.claim(record);
    } },
    launch(...args) {
      resourceRequests++;
      return dependencies.launch(...args);
    },
  };
  await assert.rejects(executePilotCampaign({ ...request, mode: "real" }, guardedDependencies), error =>
    error instanceof CampaignDiagnosticError
      && error.diagnostic.stage === "reference"
      && error.diagnostic.code === "unavailable"
      && error.message === "[SEGURANÇA BLOQUEADA] campaign-stage=reference; code=unavailable.");
  assert.equal(reads, 0);
  assert.equal(resourceRequests, 0);
  assert.deepEqual(events, []);
});

for (const [reported, expectedPhase] of [
  [{ passed: 41, failed: 0, cancelled: 0, skipped: 0 }, "clean"],
  [{ passed: 40, failed: 0, cancelled: 0, skipped: 0 }, "interrupted"],
  [{ passed: 40, failed: 0, cancelled: 0, skipped: 1 }, "interrupted"],
] as const) {
  test("D1.2 reconcilia o total efetivo e conserva marcador diante de parcialidade " + JSON.stringify(reported), async () => {
    const { request, dependencies, journalRecords } = campaignFixture();
    const source = approved();
    const originalLaunch = dependencies.launch;
    const result = await executePilotCampaign({ ...request, mode: "real" }, {
      ...dependencies,
      reference: { ...source.authority, approval: () => ({
        source: "approved-fixture", sha256: createHash("sha256").update(source.bytes).digest("hex"), kind: "homologated",
      }), readApprovedSource: async () => source.bytes },
      launch(...args) {
        const child = originalLaunch(...args);
        return { ...child, result: child.result.then(() => ({ exitCode: 0, tally: reported })) };
      },
    });
    assert.equal(result.phase, expectedPhase);
    assert.equal(result.recoveryPending, expectedPhase !== "clean");
    assert.equal(journalRecords.at(-1)?.phase, expectedPhase);
  });
}

function approved(value: StructuralReference = reference) {
  const bytes = Buffer.from(JSON.stringify(value));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    bytes,
    authority: {
      approval: () => ({ source: "synthetic-registry-entry", sha256, kind: "synthetic" as const }),
      async readApprovedSource(source: string) {
        assert.equal(source, "synthetic-registry-entry");
        return bytes;
      },
    },
  };
}

test("inspeção usa o manifesto, inclui campanha nomeada, completa e perfis", () => {
  assert.equal(inspectCampaign({ all: true }).length, 43);
  assert.ok(inspectCampaign({ all: true }).every(item => !item.runnable));
  assert.equal(inspectCampaign({ suite })[0].migration, "legacy-compatible");
  assert.deepEqual(inspectCampaign({ campaign: "admin-event-operations" }).map(item => item.id), [suite, "admin-close-http"]);
  assert.equal(inspectCampaign({ profile: "isolated-ddl" })[0].profileEnabled, false);
});

const badSelections: [Parameters<typeof selectCampaign>[0], RegExp][] = [
  [{ suite: "unknown" }, /desconhecida/u],
  [{ suite: "../test/integration/admin-close-http.integration.test.ts" }, /desconhecida/u],
  [{ suites: [suite, suite] }, /duplicada/u],
  [{ profile: "isolated-ddl" }, /especializado/u],
  [{ suites: [] }, /vazia/u],
  [{ suites: [suite, "profile-games"] }, /especializado/u],
  [{ suite, all: true }, /somente um/u],
];
for (const [selection, error] of badSelections) {
  test("seleção recusa " + JSON.stringify(selection), () => assert.throws(() => selectCampaign(selection), error));
}

test("a fronteira de execução real rejeita até suíte legada compatível antes de acessar dependências", async () => {
  for (const suiteId of [suite, "auth"]) {
    await assert.rejects(orchestrateCampaign({
      mode: "real", selection: { suite: suiteId }, connectionString: uri, parentEnvironment: {}, revision,
    }, new Proxy({} as Parameters<typeof orchestrateCampaign>[1], {
      get() { assert.fail("nenhuma dependência pode ser acessada"); },
    })), /indisponível/u);
  }
});

test("referência é lida pela fonte registrada e permanece congelada após alteração do arquivo", async () => {
  const { authority, bytes } = approved();
  const loaded = await loadCampaignReference(authority, "simulation");
  bytes.fill(0);
  const fixed = loaded.reference as StructuralReference;
  assert.deepEqual(fixed, reference);
  assert.ok(Object.isFrozen(fixed.objects[0].properties));
  assert.ok(Object.isFrozen(fixed.migrations[0]));
});

test("referência sem aprovação não chega ao leitor de arquivos", async () => {
  let calls = 0;
  await assert.rejects(loadCampaignReference({
    approval: () => undefined,
    async readApprovedSource() { calls++; return Buffer.alloc(0); },
  }, "simulation"), /sem aprovação/u);
  assert.equal(calls, 0);
});

test("referência rejeita conteúdo de outra fonte e hash autodeclarado", async () => {
  const { authority } = approved();
  await assert.rejects(loadCampaignReference({
    ...authority, async readApprovedSource() { return Buffer.from('{"sha256":"candidato"}'); },
  }, "simulation"), /sem aprovação/u);
});

test("referência com hash correto e migrations incompatíveis é recusada", async () => {
  const { authority } = approved({ ...reference, migrations: [] });
  await assert.rejects(loadCampaignReference(authority, "simulation"), /incompatível/u);
});

test("referência sintética não atende ao modo real", async () => {
  const { authority } = approved();
  let reads = 0;
  await assert.rejects(loadCampaignReference({
    ...authority, async readApprovedSource(source) { reads++; return authority.readApprovedSource(source); },
  }, "real"), /sem aprovação/u);
  assert.equal(reads, 0);
});

test("capitalização do Windows se aplica à allowlist sem importar configuração externa", () => {
  const environment = buildIntegrationEnvironment(suite, uri, {
    Path: "fixture-path", systemroot: "fixture-windows", Node_Options: "ignored", PgHost: "ignored",
  });
  assert.equal(environment.PATH, process.platform === "win32" ? "fixture-path" : undefined);
  assert.equal(environment.SystemRoot, process.platform === "win32" ? "fixture-windows" : undefined);
  assert.equal(environment.Path, undefined);
  assert.equal(environment.Node_Options, undefined);
  assert.equal(environment.PgHost, undefined);
});

const identity = {
  database_name: "arenago_events_test", server_address: "127.0.0.1", server_port: 55432,
  database_owner: "arenago", current_role: "arenago", session_role: "arenago",
  rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false,
  rolbypassrls: false, member_of_role: false, granted_to_role: false, replication_role: "origin",
  recovering: false, rolcanlogin: true, server_version_num: 180006,
};

function mockLock(events: string[], fault?: "identity" | "incoming-membership" | "busy" | "timeout" | "close" | "probe") {
  let disconnected = () => {};
  let held = false;
  return {
    lose() { held = false; disconnected(); },
    connection: {
      onDisconnect(listener: () => void) {
        disconnected = listener;
        return () => { disconnected = () => {}; };
      },
      async query(sql: string): Promise<{ rows: Record<string, unknown>[] }> {
        if (sql.includes("AS database_name")) {
          events.push("identity");
          return { rows: [{ ...identity, server_port: fault === "identity" ? 5432 : 55432,
            granted_to_role: fault === "incoming-membership" }] };
        }
        if (sql.includes("pg_try_advisory_lock")) {
          events.push("acquire");
          if (fault === "timeout") return new Promise(() => {});
          held = fault !== "busy";
          return { rows: [{ acquired: held }] };
        }
        assert.match(sql, /pg_locks[\s\S]*pg_backend_pid\(\)[\s\S]*ExclusiveLock/u);
        return { rows: [{ owned: fault !== "probe" && held }] };
      },
      async close() {
        events.push("close");
        if (fault === "close") throw new Error(uri);
        held = false;
      },
    },
    held: () => held,
  };
}

test("lock identifica a sessão antes de adquirir, confirma posse e encerra para liberar", async () => {
  const events: string[] = [];
  const fake = mockLock(events);
  const lease = await acquireCampaignLock(fake.connection, 180006);
  await lease.verify();
  assert.equal(fake.held(), true);
  await lease.close();
  assert.deepEqual(events, ["identity", "acquire", "close"]);
  assert.equal(fake.held(), false);
});

for (const fault of ["identity", "busy", "timeout"] as const) {
  test("lock recusa " + fault + " e descarta a conexão", async () => {
    const events: string[] = [];
    await assert.rejects(acquireCampaignLock(mockLock(events, fault).connection, 180006, { timeout: 30 }),
      fault === "busy" ? /indisponível/u : /não confirmada/u);
    assert.deepEqual(events, fault === "identity" ? ["identity", "close"] : ["identity", "acquire", "close"]);
  });
}

test("probe que perde a posse invalida o lease", async () => {
  const lease = await acquireCampaignLock(mockLock([], "probe").connection, 180006);
  try {
    await assert.rejects(lease.verify(), /perdido/u);
    assert.ok(lease.lost.aborted);
  } finally {
    await lease.close();
  }
});

test("BC-01 recusa concessão da role proprietária antes de tentar o advisory lock", async () => {
  const events: string[] = [];
  await assert.rejects(acquireCampaignLock(mockLock(events, "incoming-membership").connection, 180006), /não confirmada/u);
  assert.deepEqual(events, ["identity", "close"]);
});

async function tempState<T>(run: (root: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), "arenago-campaign-test-"));
  try {
    return await run(root);
  } finally {
    // Delete only the fixture's known files and directories.
    const records = join(root, "campaigns");
    for (const file of await readdir(records).catch(() => [])) {
      assert.match(file, /^[a-f0-9.-]+\.(json|tmp)$/u);
      await unlink(join(records, file));
    }
    await rmdir(records).catch(() => undefined);
    await unlink(join(root, "occupied", "owner")).catch(() => undefined);
    await rmdir(join(root, "occupied")).catch(() => undefined);
    await rmdir(root);
  }
}

function initialRecord(): CampaignEvidence {
  return {
    id: randomUUID(), supervisor: { pid: process.pid, instance: randomUUID() },
    referenceSha256: "0".repeat(64), destination: campaignDestination(), revision, node: process.version,
    suites: [suite], attempts: [{ suite, state: "not-started" }], beganAt: new Date().toISOString(),
    phase: "preparing", lock: "acquired", preflight: "pending", postflight: "pending",
    resources: "pending", recoveryPending: true,
  };
}

test("journal aceita apenas um reclamante e impede reuso após perda do supervisor", () => tempState(async root => {
  const [a, b] = await Promise.allSettled([
    fileCampaignJournal(root).claim(initialRecord()),
    fileCampaignJournal(root).claim(initialRecord()),
  ]);
  const winner = a.status === "fulfilled" ? a : b;
  assert.equal([a, b].filter(result => result.status === "fulfilled").length, 1);
  assert.equal(winner.status, "fulfilled");
  if (winner.status === "fulfilled") await assert.rejects(winner.value.finish(), /pendente/u);
  await assert.rejects(fileCampaignJournal(root).claim(initialRecord()), /ocupado/u);
}));

test("journal recusa transições inválidas e grava interrupção sem liberar o marcador", () => tempState(async root => {
  const record = initialRecord();
  const journal = fileCampaignJournal(root);
  const handle = await journal.claim(record);
  await assert.rejects(handle.save({ ...record, phase: "clean" }), /Transição inválida/u);
  await handle.save({ ...record, phase: "interrupted", diagnosis: "lock-lost" });
  const stored = JSON.parse(await readFile(join(root, "campaigns", record.id + ".json"), "utf8"));
  assert.equal(stored.diagnosis, "lock-lost");
  assert.equal(stored.recoveryPending, true);
  await assert.rejects(journal.claim(initialRecord()), /ocupado/u);
}));

type CampaignFault = "preflight" | "schema" | "baseline" | "resources" | "launch" | "failure" |
  "cancelled-tests" | "no-tests" | "timeout" | "cancel" | "loss" | "incomplete" | "postflight" | "persistence" | "close" |
  "membership-preflight" | "membership-postflight";

function campaignFixture(fault?: CampaignFault, persistentJournal?: CampaignJournal) {
  const events: string[] = [];
  const fake = mockLock(events, fault === "close" ? "close" : undefined);
  const cancel = new AbortController();
  let preflights = 0;
  const journalRecords: CampaignEvidence[] = [];
  const fakeLaunch: LaunchCampaignChild = (_, env, expected) => {
    assert.ok(fake.held());
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.PGHOST, undefined);
    assert.equal(env.RESEND_API_KEY, undefined);
    assert.equal(env.PATH, "fixture-path");
    events.push("launch");
    if (fault === "launch") throw new Error(uri);
    let resolve!: (result: typeof ok) => void;
    return {
      pid: 123,
      result: new Promise(done => { resolve = done; }),
      async authorize(permit, signal, confirm) {
        await confirm();
        assert.equal(signal.aborted, false);
        assert.equal(permit.campaignId, expected.campaignId);
        assert.equal(permit.referenceSha256, expected.referenceSha256);
        assert.equal(permit.suite, journalRecords.at(-1)?.attempts.find(row => row.pid === 123 && row.state === "launched")?.suite);
        assert.equal(permit.referenceSha256, journalRecords.at(-1)?.referenceSha256);
        events.push("permit");
        if (fault === "timeout") return;
        if (fault === "cancel") { cancel.abort(); return; }
        if (fault === "loss" || fault === "incomplete") { fake.lose(); return; }
        const verdict = fault === "failure" ? { passed: 0, failed: 1 } :
          fault === "cancelled-tests" ? { passed: 0, cancelled: 1 } :
          fault === "no-tests" ? { passed: 0, skipped: 1 } : {};
        resolve({ exitCode: fault === "failure" || fault === "cancelled-tests" ? 1 : 0, tally: { ...tally, ...verdict } });
        events.push("exited");
      },
      async stop() {
        events.push("stopped");
        if (fault === "incomplete") throw new Error(uri);
      },
    };
  };
  const dependencies: Parameters<typeof orchestrateCampaign>[1] = {
    reference: approved().authority,
    async openLockConnection(env) {
      assert.equal(env.NODE_ENV, "test");
      assert.equal(env.DATABASE_URL, uri);
      return fake.connection;
    },
    createReadPool() {
      assert.ok(fake.held());
      const count = ++preflights;
      events.push(count === 1 ? "preflight" : "postflight");
      return {
        async connect() {
          return {
            async query(sql: string) {
              assert.ok(fake.held());
              if (sql.startsWith("BEGIN ") || sql === "ROLLBACK") return { rows: [] };
              if (sql.includes("AS database_name")) return { rows: [{ ...identity,
                granted_to_role: fault === (count === 1 ? "membership-preflight" : "membership-postflight") }] };
              if (sql.startsWith("SELECT nspname")) return { rows: [
                { name: "drizzle", owner: "arenago" }, { name: "public", owner: "pg_database_owner" },
              ] };
              if (sql.includes("aclexplode")) return { rows: [{ compatible: fault !== "preflight" }] };
              if (sql.includes("AS structural_catalog")) {
                if (count > 1 && fault === "postflight") throw new Error(uri);
                return { rows: count > 1 && fault === "schema" ? [] : reference.objects.map(row => ({ ...row })) };
              }
              if (sql.includes("AS kind")) return { rows: schema.objects.map(row => ({ ...row, owner: "arenago", valid: true })) };
              if (sql.includes(" AS migration")) return { rows: schema.migrations };
              if (sql.includes(" AS occupied")) return { rows: [{ occupied: count > 1 && fault === "baseline" }] };
              if (sql.includes("public.games")) return { rows: CURATED_GAMES.map(name => ({ name, curated: true })) };
              if (sql.includes("public.questionnaire_versions")) return { rows: [{
                version: DEFAULT_QUESTIONNAIRE_VERSION, published: true, definition: DEFAULT_QUESTIONNAIRE_DEFINITION,
              }] };
              throw new Error("unexpected query");
            },
            release() {},
          };
        },
        async end() {},
      };
    },
    journal: {
      async claim(record) {
        events.push("claim");
        const persistent = persistentJournal && await persistentJournal.claim(record);
        journalRecords.push(record);
        return {
          async save(next) {
            events.push(next.phase);
            if (fault === "persistence" && next.phase === "running") throw new Error(uri);
            if (persistent) await persistent.save(next);
            journalRecords.push(next);
          },
          async finish() {
            events.push("finish");
            if (persistent) await persistent.finish();
          },
        };
      },
    },
    launch: fakeLaunch,
    async resourcesReleased() {
      assert.ok(fake.held());
      events.push("resource-check");
      return fault !== "resources";
    },
  };
  const request = {
    mode: "simulation" as const, selection: { suite }, connectionString: uri, revision,
    parentEnvironment: { Path: "fixture-path", PATH: "fixture-path", SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP, TMP: process.env.TMP, node_options: "--require unsafe",
      NODE_OPTIONS: "--require unsafe", PGHOST: "synthetic.invalid", RESEND_API_KEY: "synthetic" },
    signal: cancel.signal,
    timeoutMs: fault === "timeout" ? 30 : undefined,
  };
  return { request, dependencies, events, journalRecords };
}

test("campanha aprovada comprova ordem, ambiente, recursos e fechamento", async () => {
  const { request, dependencies, events, journalRecords } = campaignFixture();
  const record = await orchestrateCampaign(request, dependencies);
  assert.equal(record.phase, "clean");
  assert.equal(record.recoveryPending, false);
  assert.deepEqual(events, ["identity", "acquire", "claim", "preflight", "authorized", "launch", "running",
    "permit", "exited", "verifying", "resource-check", "postflight", "verifying", "close", "clean", "finish"]);
  assert.deepEqual(record.attempts[0].result, ok);
  assert.doesNotMatch(JSON.stringify(journalRecords), /synthetic-not-a-password|postgresql:\/\/|fixture-path/u);
});

test("D1.3 distingue admissão concorrente de falha após lançamento no journal persistente", () => tempState(async root => {
  const journal = fileCampaignJournal(root);
  const first = initialRecord();
  const held = await journal.claim(first);
  await held.save({ ...first, phase: "authorized", preflight: "passed" });
  await held.save({ ...first, phase: "running", preflight: "passed", attempts: [{ suite, state: "launched", pid: 123 }] });

  const { request, dependencies, events } = campaignFixture(undefined, journal);
  const source = approved();
  await assert.rejects(executePilotCampaign({ ...request, mode: "real" }, {
    ...dependencies,
    reference: { ...source.authority, approval: () => ({
      source: "approved-fixture", sha256: createHash("sha256").update(source.bytes).digest("hex"), kind: "homologated",
    }), readApprovedSource: async () => source.bytes },
  }), error => error instanceof CampaignDiagnosticError && error.diagnostic.stage === "journal-admission");
  assert.deepEqual(events, ["identity", "acquire", "claim", "close"]);
  const persisted = JSON.parse(await readFile(join(root, "campaigns", first.id + ".json"), "utf8"));
  assert.equal(persisted.phase, "running");
  assert.equal(persisted.attempts[0].state, "launched");
  assert.equal(persisted.recoveryPending, true);
}));

test("D1.3 entrypoints Node e loader registram processos reais sem alcançar PostgreSQL", async () => {
  const infrastructure = resolve(__dirname, "../infrastructure");
  const loader = join(infrastructure, "pilot-loader.cjs");
  const cwd = resolve(__dirname, "../..");
  const env = campaignSpawnEnvironment({ NODE_ENV: "test", SystemRoot: process.env.SystemRoot });
  const executor = await promisify(execFile)(process.execPath,
    ["--require", loader, join(infrastructure, "pilot-executor.ts"), "invalid-action"],
    { cwd, env, encoding: "utf8" }).then(() => assert.fail("ação inválida deveria ser bloqueada"), error => error);
  assert.match(executor.stderr, /"event":"executor-entry"/u);
  assert.match(executor.stderr, /"event":"executor-main-enter"/u);
  assert.match(executor.stderr, /"event":"executor-catch"/u);
  assert.doesNotMatch(executor.stderr, /postgresql:\/\/|synthetic-not-a-password/u);

  const campaignId = randomUUID();
  const observed: { event: string; worker: { runId: string; pid: number; ppid: number; invocations: number } }[] = [];
  const child = spawn(process.execPath, ["--require", loader, join(infrastructure, "pilot-worker.ts"),
    "invalid-suite", campaignId, "0".repeat(64), "invalid-bin", "invalid-data", "0".repeat(64)],
  { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const supervision = superviseCampaignChild(child, { campaignId,
    trace: (event, worker) => observed.push({ event, worker }) });
  await assert.rejects(supervision.result);
  assert.deepEqual(observed.map(row => row.event), ["worker-entry", "worker-main-enter", "worker-catch"]);
  assert.ok(observed.every(row => row.worker.pid === child.pid && row.worker.ppid === process.pid));
  assert.equal(observed[0].worker.runId, observed[1].worker.runId);
  assert.equal(observed[0].worker.invocations, 0);
  assert.equal(observed[1].worker.invocations, 1);
});

test("campanha com falha de teste e ambiente íntegro registra as duas conclusões", async () => {
  const { request, dependencies } = campaignFixture("failure");
  const record = await orchestrateCampaign(request, dependencies);
  assert.equal(record.phase, "test-failure");
  assert.equal(record.postflight, "passed");
  assert.equal(record.recoveryPending, false);
  assert.equal(record.attempts[0].result?.tally.failed, 1);
});

for (const phase of ["preflight", "postflight"] as const) {
  test("BC-01 recusa concessão da role dedicada no " + phase, async () => {
    const { request, dependencies, events } = campaignFixture(phase === "preflight" ? "membership-preflight" : "membership-postflight");
    const record = await orchestrateCampaign({ ...request,
      selection: { campaign: "admin-event-operations" } }, dependencies);
    assert.equal(record.phase, "inconsistent");
    assert.equal(record.recoveryPending, true);
    assert.equal(record.diagnosis, phase === "preflight" ? "preflight" : "baseline");
    assert.equal(record.postflight, phase === "preflight" ? "pending" : "failed");
    assert.equal(events.filter(event => event === "launch").length, phase === "preflight" ? 0 : 1);
    assert.equal(events.includes("finish"), false);
  });
}

test("campanha de duas suítes revalida entre filhos sob a mesma conexão supervisora", async () => {
  const { request, dependencies, events } = campaignFixture();
  const record = await orchestrateCampaign({ ...request, selection: { campaign: "admin-event-operations" } }, dependencies);
  assert.equal(record.phase, "clean");
  assert.deepEqual(record.attempts.map(attempt => attempt.result), [ok, ok]);
  const operations = events.filter(event => ["acquire", "launch", "resource-check", "postflight", "close"].includes(event));
  assert.deepEqual(operations, ["acquire", "launch", "resource-check", "postflight", "postflight",
    "launch", "resource-check", "postflight", "close"]);
});

const blockedCases = [
  ["preflight", "inconsistent", "preflight"],
  ["baseline", "inconsistent", "baseline"],
  ["schema", "inconsistent", "baseline"],
  ["postflight", "inconsistent", "baseline"],
  ["resources", "inconsistent", "resources"],
  ["launch", "interrupted", "launch"],
  ["timeout", "interrupted", "timeout"],
  ["cancel", "interrupted", "cancelled"],
  ["loss", "interrupted", "lock-lost"],
  ["incomplete", "interrupted", "lock-lost"],
  ["persistence", "interrupted", "persistence"],
  ["close", "interrupted", "session-close"],
  ["cancelled-tests", "interrupted", "supervision"],
  ["no-tests", "interrupted", "supervision"],
] as const;

for (const [fault, phase, diagnosis] of blockedCases) {
  test("bloqueia reutilização em " + fault, async () => {
    const { request, dependencies, events, journalRecords } = campaignFixture(fault);
    const record = await orchestrateCampaign({ ...request, selection: { campaign: "admin-event-operations" } }, dependencies);
    assert.equal(record.phase, phase);
    assert.equal(record.diagnosis, diagnosis);
    assert.equal(record.recoveryPending, true);
    assert.ok(!events.includes("finish"));
    assert.doesNotMatch(JSON.stringify(journalRecords), /synthetic-not-a-password/u);
    if (fault !== "close") assert.equal(record.attempts[1].state, "not-started");
    if (fault === "preflight") assert.ok(!events.includes("launch"));
    if (fault === "persistence") assert.ok(!events.includes("permit"));
    if (["cancel", "loss", "incomplete", "timeout", "persistence"].includes(fault)) {
      assert.ok(events.indexOf("stopped") >= 0 && events.indexOf("stopped") < events.indexOf("close"));
    }
    if (["baseline", "schema", "postflight"].includes(fault)) {
      assert.equal(record.attempts[0].result?.exitCode, 0);
      assert.equal(record.postflight, "failed");
    }
  });
}

test("marcador sobrevive a falha de persistência e nova instância recusa lançamento", () => tempState(async root => {
  const journal = fileCampaignJournal(root);
  const initial = {
    ...initialRecord(),
    toJSON() { throw new Error(uri); },
  };
  await assert.rejects(journal.claim(initial), { message: "[SEGURANÇA BLOQUEADA] Falha ao persistir o registro da campanha." });
  const { request, dependencies, events } = campaignFixture();
  await assert.rejects(orchestrateCampaign(request, { ...dependencies, journal: fileCampaignJournal(root) }), /ocupado/u);
  assert.ok(!events.includes("preflight") && !events.includes("launch"));
}));

test("registro durável e filho Node inofensivo confirmam isolamento e protocolo IPC", () => tempState(async root => {
  const journal = fileCampaignJournal(root);
  const { request, dependencies, events } = campaignFixture(undefined, journal);
  const record = await orchestrateCampaign(request, { ...dependencies, launch: launchInertCampaignChild });
  assert.equal(record.phase, "clean");
  const stored = JSON.parse(await readFile(join(root, "campaigns", record.id + ".json"), "utf8"));
  assert.deepEqual(stored.attempts[0].result, ok);
  assert.equal(stored.resources, "passed");
  assert.equal(stored.postflight, "passed");
  assert.ok(events.indexOf("resource-check") >= 0 && events.indexOf("resource-check") < events.indexOf("postflight"));
  assert.equal(stored.lock, "closed");
  assert.equal(stored.recoveryPending, false);
  const next = await journal.claim(initialRecord());
  await assert.rejects(next.finish(), /pendente/u);
}));

function completedRecord(record: CampaignEvidence): CampaignEvidence {
  return {
    ...record, phase: "clean", lock: "closed", preflight: "passed", postflight: "passed",
    resources: "passed", recoveryPending: false, endedAt: record.beganAt, durationMs: 0,
    attempts: [{
      suite, pid: 123, state: "reported", launchedAt: record.beganAt, endedAt: record.beganAt, result: ok,
    }],
  };
}

const residualRecords = [
  ["interrompido", (record: CampaignEvidence) => JSON.stringify({ ...record, phase: "interrupted" })],
  ["ativo", (record: CampaignEvidence) => JSON.stringify({ ...record, phase: "running" })],
  ["recuperação pendente", (record: CampaignEvidence) => JSON.stringify({ ...record, recoveryPending: true })],
  ["inconsistente", (record: CampaignEvidence) => JSON.stringify({ ...record, phase: "inconsistent" })],
  ["corrompido", () => '{"phase":'],
  ["estado desconhecido", (record: CampaignEvidence) => JSON.stringify({ ...record, phase: "unknown" })],
  ["falha de atestação posterior", (record: CampaignEvidence) => JSON.stringify({ ...record, postflight: "pending" })],
  ["sem prova de encerramento", (record: CampaignEvidence) => JSON.stringify({ ...record, lock: "uncertain" })],
  ["sem resultado da suíte", (record: CampaignEvidence) => JSON.stringify({ ...record, attempts: [] })],
  ["fase terminal contradiz resultado", (record: CampaignEvidence) => JSON.stringify({ ...record, phase: "test-failure" })],
  ["destino divergente", (record: CampaignEvidence) => JSON.stringify({ ...record, destination: "other" })],
] as const;

for (const [label, content] of residualRecords) {
  test("histórico residual bloqueia sem marcador: " + label, () => tempState(async root => {
    const records = join(root, "campaigns");
    await mkdir(records);
    const previous = completedRecord(initialRecord());
    const file = join(records, previous.id + ".json");
    const bytes = content(previous);
    await writeFile(file, bytes);
    const { request, dependencies, events } = campaignFixture();
    await assert.rejects(orchestrateCampaign(request, { ...dependencies, journal: fileCampaignJournal(root) }),
      /ocupado ou sem registro/u);
    assert.ok(!events.includes("preflight") && !events.includes("launch") && !events.includes("permit"));
    assert.equal(await readFile(file, "utf8"), bytes);
    assert.match(await readFile(join(root, "occupied", "owner"), "utf8"), /^[a-f0-9-]+:[a-f0-9-]+$/u);
    await assert.rejects(fileCampaignJournal(root).claim(initialRecord()), /ocupado/u);
  }));
}

test("histórico inacessível impede autorização e retém o marcador", () => tempState(async root => {
  const records = join(root, "campaigns");
  await writeFile(records, uri);
  try {
    const { request, dependencies, events } = campaignFixture();
    await assert.rejects(orchestrateCampaign(request, { ...dependencies, journal: fileCampaignJournal(root) }),
      { message: "[SEGURANÇA BLOQUEADA] Ambiente ocupado ou sem registro operacional confirmado." });
    assert.ok(!events.includes("preflight") && !events.includes("launch"));
    await assert.rejects(fileCampaignJournal(root).claim(initialRecord()), /ocupado/u);
  } finally {
    await unlink(records);
  }
}));

for (const phase of ["clean", "test-failure"] as const) {
  test("conclusão íntegra permite nova campanha: " + phase, () => tempState(async root => {
    const journal = fileCampaignJournal(root);
    const { request, dependencies } = campaignFixture(phase === "test-failure" ? "failure" : undefined, journal);
    const result = await orchestrateCampaign({ ...request, selection: { campaign: "admin-event-operations" } }, dependencies);
    assert.equal(result.phase, phase);
    assert.equal(result.attempts[1].state, phase === "clean" ? "reported" : "not-started");
    const previous = join(root, "campaigns", result.id + ".json");
    const bytes = await readFile(previous, "utf8");
    const next = campaignFixture(undefined, journal);
    const admitted = await orchestrateCampaign(next.request, next.dependencies);
    assert.notEqual(admitted.id, result.id);
    assert.equal(admitted.phase, "clean");
    assert.equal(await readFile(previous, "utf8"), bytes);
  }));
}

test("um handle não remove o marcador se a propriedade persistida mudou", () => tempState(async root => {
  const record = initialRecord();
  const journal = fileCampaignJournal(root);
  const handle = await journal.claim(record);
  for (const phase of ["authorized", "running", "verifying"] as const) {
    await handle.save({ ...record, phase });
  }
  await handle.save(completedRecord(record));
  const owner = join(root, "occupied", "owner");
  const other = randomUUID() + ":" + randomUUID();
  await writeFile(owner, other);
  await assert.rejects(handle.finish(), /não liberado/u);
  assert.equal(await readFile(owner, "utf8"), other);
  await assert.rejects(journal.claim(initialRecord()), /ocupado/u);
}));

test("dois processos Node concorrentes admitem apenas um proprietário do journal", () => tempState(async root => {
  const cwd = resolve(__dirname, "../..");
  const loader = require.resolve("tsx/cjs", { paths: [cwd] });
  const code = `
    const { fileCampaignJournal } = require("./test/infrastructure/campaign-journal.ts");
    const [root, record] = process.argv.slice(1);
    fileCampaignJournal(root).claim(JSON.parse(record)).then(
      () => { process.exitCode = 0; },
      error => { process.exitCode = /Ambiente ocupado/u.test(error?.message) ? 2 : 3; },
    );
  `;
  const contenders = [initialRecord(), initialRecord()];
  const children = contenders.map(record => spawn(process.execPath,
    ["--require", loader, "--eval", code, root, JSON.stringify(record)], {
      cwd, env: { ...buildIntegrationEnvironment(suite, uri, process.env), NODE_V8_COVERAGE: undefined },
      shell: false, windowsHide: true, stdio: "ignore",
    }));
  const closures = children.map(child => new Promise<number | null>(done => {
    child.on("error", () => undefined);
    child.once("close", done);
  }));
  try {
    const codes = await within(() => Promise.all(closures), 5_000);
    assert.deepEqual([...codes].sort(), [0, 2]);
    const winner = contenders[codes.indexOf(0)];
    assert.deepEqual(await readdir(join(root, "campaigns")), [winner.id + ".json"]);
    assert.ok((await readFile(join(root, "occupied", "owner"), "utf8")).startsWith(winner.id + ":"));
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
    await within(() => Promise.all(closures), 5_000);
  }
}));

function fakeProcess(stdout: PassThrough | null, stderr: PassThrough | null, pid?: number) {
  let kills = 0;
  const child = Object.assign(new ChildProcess(), {
    stdout, stderr, pid, connected: true, kill() { kills++; return true; },
  });
  return { child, kills: () => kills };
}

test('D1.3 worker sem ready expõe estágio seguro e não adquire autorização por diagnóstico', async () => {
  const { child } = fakeProcess(new PassThrough(), new PassThrough(), 123);
  const supervision = superviseCampaignChild(child);
  child.emit('message', { type: 'diagnostic', stage: 'worker-environment', code: 'unavailable' });
  child.emit('message', { type: 'diagnostic', stage: 'worker-environment', code: 'EACCES', failure: true });
  child.emit('message', { type: 'diagnostic', stage: 'ipc-wait', code: 'unavailable' });
  child.emit('exit', 2, null);
  child.emit('close', 2, null);
  await assert.rejects(supervision.result, error => error instanceof CampaignDiagnosticError
    && error.diagnostic.stage === 'worker-environment' && error.diagnostic.code === 'EACCES' && error.diagnostic.exitCode === 2);
  await assert.rejects(supervision.authorize({ campaignId: randomUUID(), suite, referenceSha256: '0'.repeat(64),
    destination: campaignDestination(), profile: 'conventional' }, new AbortController().signal, async () => {}));
});

test("supervisão drena stdout e stderr sem registrar seu conteúdo", async () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const { child } = fakeProcess(stdout, stderr, 123);
  const supervision = superviseCampaignChild(child);
  for (const stream of [stdout, stderr]) {
    assert.equal(stream.readableFlowing, true);
    await new Promise<void>((done) => {
      stream.once("end", done);
      stream.end(uri);
    });
    assert.equal(stream.readableLength, 0);
  }
  child.emit("exit", 0, null);
  child.emit("close", 0, null);
  await assert.rejects(supervision.result, { message: "[SEGURANÇA BLOQUEADA] Execução do filho não confirmada." });
});

for (const missing of ["stdout", "stderr"] as const) {
  test("supervisão recusa pipe ausente: " + missing, async () => {
    const { child, kills } = fakeProcess(missing === "stdout" ? null : new PassThrough(),
      missing === "stderr" ? null : new PassThrough(), 123);
    const supervision = superviseCampaignChild(child);
    assert.equal(kills(), 1);
    if (child.stdout) assert.equal(child.stdout.readableFlowing, true);
    if (child.stderr) assert.equal(child.stderr.readableFlowing, true);
    child.emit("exit", null, "SIGTERM");
    child.emit("close", null, "SIGTERM");
    await assert.rejects(supervision.result, /não confirmada/u);
  });
}

test("supervisão sanitiza falha de inicialização sem PID ou pipes", async () => {
  const { child, kills } = fakeProcess(null, null);
  const supervision = superviseCampaignChild(child);
  child.emit("error", new Error(uri));
  child.emit("close", -1, null);
  await assert.rejects(supervision.result, { message: "[SEGURANÇA BLOQUEADA] Execução do filho não confirmada." });
  assert.equal(kills(), 0);
});

async function withProtocolFixture(
  run: (fixture: ReturnType<typeof startProtocolFixture>) => Promise<void>,
  overrideEnv: NodeJS.ProcessEnv = {},
) {
  const fixture = startProtocolFixture(overrideEnv);
  try {
    await run(fixture);
  } finally {
    if (fixture.child.exitCode === null && fixture.child.signalCode === null) fixture.child.kill();
    await within(() => Promise.race([fixture.exited, fixture.closed]), 5_000);
  }
}

function startProtocolFixture(overrideEnv: NodeJS.ProcessEnv) {
  const campaignId = randomUUID();
  const referenceSha256 = "a".repeat(64);
  const cwd = resolve(__dirname, "../..");
  // Hold the inert callback until the parent releases it, so duplicate permits can be tested while it runs.
  const code = `
    const { runAsCampaignChild } = require("./test/infrastructure/campaign-child-protocol.ts");
    const [suite, campaignId, referenceSha256] = process.argv.slice(1);
    runAsCampaignChild(suite, { campaignId, referenceSha256 }, () => new Promise(resolve => {
      process.on("message", message => {
        if (message?.type === "fixture-release") resolve({ passed: 1, failed: 0, skipped: 0, cancelled: 0 });
      });
      process.send({ type: "fixture-callback" });
    })).then(code => { process.exitCode = code; }, () => { process.exitCode = 2; });
  `;
  const env = campaignSpawnEnvironment(buildIntegrationEnvironment(suite, uri, process.env));
  const child = spawn(process.execPath, [
    "--require", require.resolve("tsx/cjs", { paths: [cwd] }), "--eval", code, suite, campaignId, referenceSha256,
  ], {
    cwd, env: { ...env, ...overrideEnv }, shell: false, windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const messages: { type: string; challenge?: unknown }[] = [];
  let spawnFailed = false;
  child.on("error", () => { spawnFailed = true; });
  child.on("message", (value: unknown) => {
    if (value && typeof value === "object" && "type" in value && typeof value.type === "string") {
      messages.push({ type: value.type, challenge: "challenge" in value ? value.challenge : undefined });
    }
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(done => {
    child.once("exit", (code, signal) => done({ code, signal }));
  });
  const closed = new Promise<number | null>(done => { child.once("close", done); });

  async function waitFor(type: string) {
    const previous = messages.find(message => message.type === type);
    if (previous) return previous;
    const found = new Promise<(typeof messages)[number]>(done => {
      child.on("message", function notify() {
        const message = messages.find(row => row.type === type);
        if (message) {
          child.off("message", notify);
          done(message);
        }
      });
    });
    return within(() => Promise.race([found, closed.then(code => {
      const status = spawnFailed ? "falha de spawn" : "código " + code + ", sinal " + child.signalCode;
      assert.fail("filho encerrou sem " + type + " (" + status + ")");
    })]), 5_000);
  }
  async function permit() {
    const { challenge } = await waitFor("ready");
    assert.equal(typeof challenge, "string");
    return { type: "permit", challenge, campaignId, suite, profile: "permanent", destination: campaignDestination(), referenceSha256 };
  }
  function send(value: object | string) {
    return new Promise<void>((done, reject) => { child.send(value, error => error ? reject(error) : done()); });
  }
  return { child, messages, exited, closed, permit, send, waitFor };
}

test("filho executa o callback uma vez após permissão válida, mesmo ao receber duplicata", () => withProtocolFixture(async fixture => {
  const permit = await fixture.permit();
  assert.deepEqual(fixture.messages.map(row => row.type), ["ready"]);
  await fixture.send(permit);
  await fixture.waitFor("fixture-callback");
  await fixture.send(permit);
  await fixture.send({ type: "fixture-release" });
  assert.equal(await within(() => fixture.closed, 5_000), 0);
  assert.deepEqual(fixture.messages.map(row => row.type), ["ready", "started", "fixture-callback", "result"]);
}));

type TestPermit = Awaited<ReturnType<ReturnType<typeof startProtocolFixture>["permit"]>>;
const invalidPermits: readonly [string, (permit: TestPermit) => object | string][] = [
  ["perfil ausente", ({ profile: _profile, ...permit }) => permit],
  ["perfil divergente", permit => ({ ...permit, profile: "isolated-ddl" })],
  ["suíte divergente", permit => ({ ...permit, suite: "admin-close-http" })],
  ["campanha divergente", permit => ({ ...permit, campaignId: randomUUID() })],
  ["desafio antigo", permit => ({ ...permit, challenge: randomUUID() })],
  ["referência divergente", permit => ({ ...permit, referenceSha256: "b".repeat(64) })],
  ["destino divergente", permit => ({ ...permit, destination: "other" })],
  ["mensagem malformada", () => "permit"],
];
for (const [label, change] of invalidPermits) {
  test("filho rejeita autorização: " + label, () => withProtocolFixture(async fixture => {
    await fixture.send(change(await fixture.permit()));
    assert.equal(await within(() => fixture.closed, 5_000), 2);
    assert.deepEqual(fixture.messages.map(row => row.type), ["ready"]);
  }));
}

test("desconexão antes da autorização impede execução posterior", () => withProtocolFixture(async fixture => {
  const permit = await fixture.permit();
  const disconnected = new Promise<void>(done => { fixture.child.once("disconnect", done); });
  fixture.child.disconnect();
  await assert.rejects(fixture.send(permit), { code: "ERR_IPC_CHANNEL_CLOSED" });
  // Parent-initiated IPC disconnect can leave 'close' unreported even after the child exits.
  const [, exit] = await within(() => Promise.all([disconnected, fixture.exited]), 5_000);
  assert.deepEqual(exit, { code: 2, signal: null });
  assert.deepEqual(fixture.messages.map(row => row.type), ["ready"]);
}));

test("filho não emite ready se uma variável de bootstrap contém valor fora da allowlist", () => withProtocolFixture(async fixture => {
  assert.equal(await within(() => fixture.closed, 5_000), 2);
  assert.deepEqual(fixture.messages, []);
}, { OTHER_SECRET: "synthetic-outside-allowlist" }));
