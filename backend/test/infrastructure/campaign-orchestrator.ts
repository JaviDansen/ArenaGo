import { randomUUID } from "node:crypto";
import { acquireCampaignLock, type CampaignLockConnection } from "./campaign-lock";
import { CampaignTimeout, within } from "./campaign-deadline";
import { campaignDestination, validTally, type CampaignEvidence, type CampaignJournal } from "./campaign-journal";
import type { CampaignChild, LaunchCampaignChild } from "./campaign-process";
import { loadCampaignReference, type CampaignReferenceAuthority } from "./campaign-reference";
import { refuseRealCampaign, selectCampaign, type CampaignSelection } from "./campaign-selection";
import { attestIntegrationDatabase, type IntegrationPreflightPoolFactory } from "./integration-db-guard";
import { buildIntegrationEnvironment, integrationBlocked, campaignStep, campaignFailure, CampaignDiagnosticError, type CampaignDiagnosticStage } from "./integration-environment";

type SimulationDependencies = {
  reference: CampaignReferenceAuthority;
  openLockConnection(environment: NodeJS.ProcessEnv): Promise<CampaignLockConnection>;
  createReadPool: IntegrationPreflightPoolFactory;
  journal: CampaignJournal;
  launch: LaunchCampaignChild;
  /** Independent proof for descendants, database connections and transactions, even after child exit. */
  resourcesReleased(record: Readonly<CampaignEvidence>, signal: AbortSignal): Promise<boolean>;
};

type CampaignRequest = {
  mode: "simulation" | "real";
  selection: CampaignSelection;
  connectionString: string;
  parentEnvironment: NodeJS.ProcessEnv;
  revision: CampaignEvidence["revision"];
  signal?: AbortSignal;
  timeoutMs?: number;
  trace?: (event: string, campaignId?: string) => void;
};

export async function orchestrateCampaign(request: CampaignRequest, dependencies: SimulationDependencies): Promise<CampaignEvidence> {
  if (request.mode !== "simulation") refuseRealCampaign();
  return executeCampaign(request, dependencies, "simulation");
}

/** Real callers must supply the concrete, reviewed Windows adapters. */
export async function executePilotCampaign(request: CampaignRequest, dependencies: SimulationDependencies): Promise<CampaignEvidence> {
  try { request.trace?.('execute-pilot-enter'); } catch { /* informational only */ }
  const ids = "suites" in request.selection ? request.selection.suites
    : "suite" in request.selection ? [request.selection.suite] : [];
  if (request.mode !== "real" || !ids.length || new Set(ids).size !== ids.length
      || ids.some(id => !["admin-external-queue-http", "admin-close-http"].includes(id))) {
    throw integrationBlocked("Somente D06 e D09 são autorizáveis no piloto.");
  }
  return executeCampaign(request, dependencies, "real");
}

async function executeCampaign(request: CampaignRequest, dependencies: SimulationDependencies, purpose: "real" | "simulation"): Promise<CampaignEvidence> {
  const trace = (event: string, campaignId?: string) => { try { request.trace?.(event, campaignId); } catch { /* diagnostics cannot authorize or interrupt a campaign */ } };
  const step = <T>(stage: CampaignDiagnosticStage, work: () => T | Promise<T>): Promise<T> => purpose === 'real' ? campaignStep(stage, work) : Promise.resolve().then(work);
  const suites = selectCampaign(request.selection);
  const { commit, branch } = request.revision;
  if (!/^[a-f0-9]{40}$/u.test(commit) || !/^[a-zA-Z0-9._/-]{1,180}$/u.test(branch)) {
    throw integrationBlocked("Revisão Git inválida.");
  }
  const timeout = request.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 3_600_000) throw integrationBlocked("Prazo da campanha inválido.");
  const envs = await step('configuration', () => suites.map(({ id }) => buildIntegrationEnvironment(id, request.connectionString, request.parentEnvironment)));
  const reference = await step('reference', () => within(() => loadCampaignReference(dependencies.reference, purpose), purpose === 'real' ? 90_000 : 5_000, request.signal));

  // The adapter must return a new dedicated session. Discard late connections even after a timeout.
  const opening = new AbortController();
  const connectSignal = request.signal ? AbortSignal.any([request.signal, opening.signal]) : opening.signal;
  let lease: Awaited<ReturnType<typeof acquireCampaignLock>>;
  try {
    const connection = await within(async () => {
      const session = await dependencies.openLockConnection({ ...envs[0] });
      if (connectSignal.aborted) {
        await session.close();
        throw integrationBlocked("Abertura interrompida.");
      }
      return session;
      }, purpose === "real" ? 60_000 : 5_000, connectSignal);
    lease = await step('lock-acquisition', () => acquireCampaignLock(connection, reference.postgresVersionNum));
  } catch (error) {
    opening.abort();
    if (purpose === 'real') throw new CampaignDiagnosticError(campaignFailure('connection', error));
    throw integrationBlocked("Exclusividade da campanha não confirmada.");
  }

  const signal = request.signal ? AbortSignal.any([request.signal, lease.lost]) : lease.lost;
  const started = performance.now();
  const record: CampaignEvidence = {
    id: randomUUID(), supervisor: { instance: randomUUID(), pid: process.pid },
    destination: campaignDestination(), referenceSha256: reference.sha256, node: process.version,
    revision: { commit, branch }, suites: suites.map(suite => suite.id), beganAt: new Date().toISOString(),
    attempts: suites.map(({ id }) => ({ suite: id, state: "not-started" })),
    phase: "preparing", preflight: "pending", lock: "acquired", postflight: "pending",
    resources: "pending", recoveryPending: true,
  };
  trace('campaign-created', record.id);
  let handle: Awaited<ReturnType<CampaignJournal["claim"]>> | undefined;
  let active: CampaignChild | undefined;
  let leaseClosed = false;
  let diagnosis: CampaignEvidence["diagnosis"] = "persistence";
  let resultPhase: "clean" | "test-failure" = "clean";

  function stamp() {
    record.endedAt = new Date().toISOString();
    record.durationMs = Math.round(performance.now() - started);
  }
  async function save(phase: CampaignEvidence["phase"]) {
    record.phase = phase;
    await step('journal-save', () => handle!.save(structuredClone(record)));
  }
  async function ensureLease() {
    if (signal.aborted) throw integrationBlocked("Campanha interrompida.");
    await step('lock-verification', () => lease.verify());
    if (signal.aborted) throw integrationBlocked("Campanha interrompida.");
  }
  async function attest(index: number) {
    await ensureLease();
    await step(record.phase === 'verifying' ? 'postflight' : 'preflight', () => within(() => attestIntegrationDatabase(suites[index].id, envs[index],
      dependencies.createReadPool, reference.reference), purpose === "real" ? 90_000 : 30_000, signal));
    await ensureLease();
  }

  try {
    await ensureLease();
    trace('journal-claim-start', record.id);
    handle = await step('journal-admission', () => dependencies.journal.claim(structuredClone(record)));
    trace('journal-claim-passed', record.id);
    for (const [index, suite] of suites.entries()) {
      if (index > 0) {
        record.preflight = record.postflight = record.resources = "pending";
        diagnosis = "persistence";
        await save("preparing");
      }
      diagnosis = "preflight";
      await attest(index);
      record.preflight = "passed";
      diagnosis = "persistence";
      await save("authorized");
      await ensureLease();

      const attempt = record.attempts[index];
      diagnosis = "launch";
      active = await step('worker-launch', () => dependencies.launch(suite.id, { ...envs[index] }, {
        campaignId: record.id, referenceSha256: reference.sha256,
      }));
      trace('worker-launched', record.id);
      const child = active;
      void child.result.catch(() => undefined);
      if (child.pid === undefined || !Number.isSafeInteger(child.pid) || child.pid <= 0) throw new Error();
      attempt.pid = child.pid;
      attempt.state = "launched";
      attempt.launchedAt = new Date().toISOString();
      diagnosis = "persistence";
      await save("running");
      trace('running-saved', record.id);

      diagnosis = "supervision";
      await ensureLease();
      const attemptControl = new AbortController();
      const attemptSignal = AbortSignal.any([signal, attemptControl.signal]);
      const result = await within(async () => {
        await step('ipc-authorize', () => child.authorize({
          campaignId: record.id, suite: suite.id, profile: suite.profile,
          referenceSha256: record.referenceSha256, destination: record.destination,
        }, attemptSignal, ensureLease));
        trace('ipc-authorized', record.id);
        if (!attemptSignal.aborted) attempt.state = "authorized";
        return child.result;
      }, timeout, attemptSignal).finally(() => attemptControl.abort());
      const { exitCode, tally } = result;
      trace('worker-result', record.id);
      await step('reconciliation', () => {
      if (!validTally(tally) || exitCode !== (tally.failed || tally.cancelled ? 1 : 0)) throw new Error();
      const { passed, failed, skipped, cancelled } = tally;
      if (purpose === "real" && (passed + failed + skipped + cancelled !== suite.cases || skipped || cancelled)) {
        throw integrationBlocked("Execução parcial ou contagem divergente do piloto.");
      }
      });
      const { passed, failed, skipped, cancelled } = tally;
      attempt.result = { exitCode, tally: { passed, failed, skipped, cancelled } };
      attempt.state = "reported";
      attempt.endedAt = new Date().toISOString();
      active = undefined;
      if (cancelled > 0 || (exitCode === 0 && passed === 0)) throw new Error();
      diagnosis = "persistence";
      await save("verifying");

      diagnosis = "resources";
      await ensureLease();
      await step('resources', async () => {
        if (await within(() => dependencies.resourcesReleased(structuredClone(record), signal), purpose === "real" ? 90_000 : 5_000, signal) !== true) throw new Error();
      });
      record.resources = "passed";
      diagnosis = "baseline";
      await attest(index);
      record.postflight = "passed";
      if (exitCode !== 0) {
        resultPhase = "test-failure";
        break;
      }
    }

    // Preserve the result of the postflight while the lock is still held. The durable marker
    // survives until the dedicated session is closed and the final record is committed.
    diagnosis = "persistence";
    await save("verifying");
    await ensureLease();
    diagnosis = "session-close";
    await step('lock-close', () => lease.close());
    leaseClosed = true;
    record.lock = "closed";
    if (signal.aborted) throw new Error();
    diagnosis = "persistence";
    record.recoveryPending = false;
    stamp();
    await save(resultPhase);
    const finishingHandle = handle;
    if (!finishingHandle) throw integrationBlocked('Handle de finalização do journal ausente.');
    await step('journal-finish', () => finishingHandle.finish());
    trace('journal-finished', record.id);
    return record;
  } catch (error) {
    trace('campaign-catch', record.id);
    const reason = lease.lost.aborted ? "lock-lost" : request.signal?.aborted ? "cancelled"
      : error instanceof CampaignTimeout && diagnosis === "supervision" ? "timeout" : diagnosis;
    record.recoveryPending = true;
    record.failure = campaignFailure('campaign', error);
    record.cleanupFailures = [];
    record.diagnosis = reason;
    if (reason === "preflight") record.preflight = "failed";
    if (reason === "baseline") record.postflight = "failed";
    if (reason === "resources") record.resources = "failed";
    if (lease.lost.aborted) record.lock = "lost";
    if (reason === "session-close") record.lock = "uncertain";

    if (active) await within(() => active!.stop(), 3_000).catch(error => {
      record.resources = "failed"; record.cleanupFailures!.push(campaignFailure('worker-stop', error));
    });
    stamp();
    const phase = reason === "baseline" || reason === "preflight" || reason === "resources" ? "inconsistent" : "interrupted";
    record.phase = phase;
    async function persistFailure() {
      if (!handle) return;
      trace('terminal-save-start', record.id);
      try { record.terminalPersistence = 'passed'; await save(phase); trace('terminal-save-passed', record.id); }
      catch (error) { trace('terminal-save-failed', record.id); record.terminalPersistence = 'failed'; record.cleanupFailures!.push(campaignFailure('journal-save', error)); }
    }
    await persistFailure();
    if (!leaseClosed && reason !== "session-close") {
      try {
        await lease.close();
        if (record.lock === "acquired") record.lock = "closed";
      } catch (error) {
        record.lock = "uncertain";
        record.cleanupFailures!.push(campaignFailure('lock-close', error));
      }
      await persistFailure();
    }
    if (!handle) {
      if (purpose === 'real') throw new CampaignDiagnosticError(record.failure!);
      throw integrationBlocked("Ambiente ocupado ou sem registro operacional confirmado.");
    }
    return record;
  }
}
