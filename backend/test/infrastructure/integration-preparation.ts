import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { win32 } from "node:path";
import { inspectPreparationSnapshot, type IntegrationPreflightPoolFactory } from "./integration-db-guard";
import { integrationBlocked, integrationDestination } from "./integration-environment";
import {
  prepareStructuralReference, structuralSchemas, structuralSnapshot,
} from "./integration-structural-reference";

const postgresVersionNum = 180006;
const service = "postgresql-x64-18";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const isDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

export type WindowsPostgresIdentity = Readonly<{
  address: string;
  port: number;
  service: string;
  listenerPid: number;
  servicePid: number;
  postgresVersionNum: number;
  clusterSha256: string;
  instanceSha256: string;
}>;

function confirmIdentity(actual: WindowsPostgresIdentity, expected: WindowsPostgresIdentity) {
  const { address, port } = integrationDestination;
  if (actual?.address !== address || actual.port !== port || actual.service !== service
      || actual.postgresVersionNum !== postgresVersionNum || !isDigest(actual.instanceSha256)
      || !isDigest(actual.clusterSha256) || actual.clusterSha256 !== expected.clusterSha256
      || ![actual.listenerPid, actual.servicePid].every(pid => Number.isSafeInteger(pid) && pid > 0)
      || actual.listenerPid !== expected.listenerPid || actual.servicePid !== expected.servicePid
      || actual.instanceSha256 !== expected.instanceSha256) {
    throw integrationBlocked("Identidade operacional Windows ausente, divergente ou alterada.");
  }
}

type Clock = Readonly<{ wallMs(): number; monotonicMs(): number }>;
const systemClock: Clock = { wallMs: () => Date.now(), monotonicMs: () => performance.now() };

export async function measureQuestionnaireClock(read: () => Promise<unknown>, clock: Clock = systemClock) {
  const start = clock.monotonicMs();
  const before = clock.wallMs();
  const sample = await read() as { server_ms?: number; snapshot_ms?: number; activation_ms?: number } | undefined;
  const after = clock.wallMs();
  const elapsedMs = clock.monotonicMs() - start;
  const { server_ms: server, snapshot_ms: snapshot, activation_ms: activation } = sample ?? {};
  // Wall clock readings are quantized to milliseconds. Allow one tick at each boundary.
  if (![before, after, elapsedMs].every(Number.isFinite)
      || typeof server !== "number" || !Number.isFinite(server)
      || typeof snapshot !== "number" || !Number.isFinite(snapshot)
      || typeof activation !== "number" || !Number.isFinite(activation)
      || elapsedMs < 0 || after < before || Math.abs(after - before - elapsedMs) > 2 || snapshot > server) {
    throw integrationBlocked("Medição dos relógios inconclusiva.");
  }
  // The application sends a JavaScript Date back to PostgreSQL, losing submillisecond precision.
  const applicationCutoff = Math.floor(server);
  if (activation > snapshot || activation > before - 1 || activation > applicationCutoff - 1) {
    throw integrationBlocked("Vigência do questionário incompatível com o intervalo observado.");
  }
  return {
    elapsedMs, serverMs: server, snapshotMs: snapshot, activationMs: activation, applicationCutoffMs: applicationCutoff,
    offsetMinMs: server - after - 1, offsetMaxMs: server - before + 1,
    activationMarginMs: Math.min(snapshot, before - 1, applicationCutoff - 1) - activation,
  };
}

export async function measurePreparationClock(read: () => Promise<unknown>, clock: Clock = systemClock) {
  const samples: Awaited<ReturnType<typeof measureQuestionnaireClock>>[] = [];
  for (let i = 0; i < 3; i++) samples.push(await measureQuestionnaireClock(read, clock));
  const offsetMinMs = Math.max(...samples.map(sample => sample.offsetMinMs));
  const offsetMaxMs = Math.min(...samples.map(sample => sample.offsetMaxMs));
  if (offsetMinMs > offsetMaxMs || samples.some((sample, i) => sample.elapsedMs > 250
      || sample.snapshotMs !== samples[0].snapshotMs || sample.activationMs !== samples[0].activationMs
      || (i > 0 && sample.serverMs < samples[i - 1].serverMs))) {
    throw integrationBlocked("Amostras consecutivas dos relógios inconclusivas.");
  }
  return { samples, offsetMinMs, offsetMaxMs, activationMarginMs: Math.min(...samples.map(sample => sample.activationMarginMs)) };
}

export type PreparationOperation =
  | { kind: "extract-candidate" }
  | { kind: "qualify"; expectedStructure: unknown };

type PreparationDependencies = Readonly<{
  env: NodeJS.ProcessEnv;
  expectedIdentity: WindowsPostgresIdentity;
  observeIdentity(): Promise<WindowsPostgresIdentity>;
  createPool: IntegrationPreflightPoolFactory;
  clock?: Clock;
}>;

// These operations return local evidence. Authority and artifact storage belong to a separate workflow.
export async function simulateIntegrationPreparation(operation: PreparationOperation, options: PreparationDependencies & { mode: "simulation" }) {
  if (options.mode !== "simulation") throw integrationBlocked("Preparação real indisponível nesta etapa.");
  return collectPreparationEvidence(operation, options);
}

export async function collectPreparationEvidence(operation: PreparationOperation, options: PreparationDependencies) {
  if (operation?.kind !== "extract-candidate" && operation?.kind !== "qualify") {
    throw integrationBlocked("Operação de preparação desconhecida.");
  }
  const expected = { ...options.expectedIdentity };
  const observe = async () => {
    let actual: WindowsPostgresIdentity;
    try {
      actual = await options.observeIdentity();
    } catch {
      throw integrationBlocked("Evidência operacional Windows indisponível.");
    }
    confirmIdentity(actual, expected);
  };
  await observe();

  const statements: string[] = [];
  let candidate: { bytes: string; sha256: string } | undefined;
  let structure: { sha256: string; kinds: Record<string, number>; foreignKeys: number } | undefined;
  let clock: Awaited<ReturnType<typeof measurePreparationClock>> | undefined;
  // Keep the existing pool options and lifecycle. Record hashes of statements, never driver messages or rows.
  await inspectPreparationSnapshot(options.env, config => {
    const pool = options.createPool(config);
    return {
      end: () => pool.end(),
      async connect() {
        await observe();
        const client = await pool.connect();
        return {
          release: destroy => client.release(destroy),
          query: sql => {
            statements.push(sha256(sql));
            return client.query(sql);
          },
        };
      },
    };
  }, postgresVersionNum, (rows, schema) => {
    const snapshot = structuralSnapshot(rows);
    const objects = [...snapshot.objects.values()];
    const kinds: Record<string, number> = {};
    const foreignKeys = new Set<string>();
    for (const object of objects) {
      kinds[object.kind] = (kinds[object.kind] ?? 0) + 1;
      if (object.kind === "constraint" && object.properties.constraintType === "f") {
        foreignKeys.add(object.schema + "." + object.relation + "." + object.name);
      }
    }
    // Require the identities discovered from migrations as well as the earlier inventory query.
    const projected = new Set(objects.filter(object => object.kind !== "column"
      && !(object.kind === "constraint" && object.properties.constraintType === "n")).map(object =>
      object.kind + ":" + [object.schema, object.relation, object.name].filter(part => part !== null).join(".")
      + (object.kind === "function" ? "(" + object.signature + ")" : "")));
    const tablesWithColumns = new Set(objects.filter(object => object.kind === "column")
      .map(object => object.schema + "." + object.relation));
    if (schema.objects.length !== projected.size || schema.objects.some(object => !projected.has(object.kind + ":" + object.name))
        || schema.objects.some(object => object.kind === "table" && !tablesWithColumns.has(object.name))
        || schema.foreignKeys.length !== foreignKeys.size || schema.foreignKeys.some(name => !foreignKeys.has(name))) {
      throw integrationBlocked("Projeção estrutural incompleta para o checkout.");
    }
    const observed = { formatVersion: 2, postgresVersionNum, schemas: structuralSchemas, migrations: schema.migrations, objects };
    prepareStructuralReference(observed, schema.migrations);
    if (operation.kind === "extract-candidate") {
      const bytes = JSON.stringify(observed) + "\n";
      candidate = { bytes, sha256: sha256(bytes) };
    }
    structure = { sha256: snapshot.sha256, kinds, foreignKeys: foreignKeys.size };
  }, async read => {
    clock = await measurePreparationClock(read, options.clock);
  },
  operation.kind === "qualify" ? { reference: operation.expectedStructure } : undefined);

  await observe();
  return { operation: operation.kind, clusterSha256: expected.clusterSha256,
    instanceSha256: expected.instanceSha256, statements, structure, clock, candidate };
}

export type JournalDomain = Readonly<{ path: string; directoryId: string; operatorSid: string }>;
export type JournalObservation = JournalDomain & Readonly<{
  localNtfs: boolean;
  withoutReparsePoints: boolean;
  protectedAcl: boolean;
  residual: boolean;
}>;

// Pure contract for the future OS adapter. There is no journal mutation or recovery operation here.
export function confirmJournalDomain(expected: JournalDomain, observed: JournalObservation) {
  if (!/^[A-Za-z]:\\[^:]+$/u.test(expected.path) || win32.normalize(expected.path) !== expected.path
      || !expected.directoryId || !/^S-1-(?:\d+-)+\d+$/u.test(expected.operatorSid)
      || typeof observed?.path !== "string" || observed.path.toLowerCase() !== expected.path.toLowerCase()
      || observed.directoryId !== expected.directoryId || observed.operatorSid !== expected.operatorSid
      || observed.localNtfs !== true || observed.withoutReparsePoints !== true
      || observed.protectedAcl !== true || observed.residual !== false) {
    throw integrationBlocked("Domínio do journal divergente, inconclusivo ou com recuperação pendente.");
  }
}
