import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { within } from "./campaign-deadline";
import { campaignSpawnEnvironment, type CampaignIdentity, type CampaignPermit } from "./campaign-child-protocol";
import { validTally, type RunnerEvidence, type Tally } from "./campaign-journal";
import { integrationBlocked, validateIntegrationEnvironment, campaignDiagnosticStages, campaignFailure, CampaignDiagnosticError, type CampaignFailure } from "./integration-environment";

export type CampaignChild = {
  pid: number | undefined;
  authorize(permit: CampaignPermit, signal: AbortSignal, confirm: () => Promise<void>): Promise<void>;
  result: Promise<RunnerEvidence>;
  stop(): Promise<void>;
};

export type LaunchCampaignChild = (suite: string, env: NodeJS.ProcessEnv, identity: CampaignIdentity) => CampaignChild;

/** The only wired process entry in C is an inert local worker. There is no suite-path input. */
export const launchInertCampaignChild: LaunchCampaignChild = (suite, env, { campaignId, referenceSha256 }) => {
  validateIntegrationEnvironment(suite, env);
  const cwd = resolve(__dirname, "../..");
  const worker = resolve(__dirname, "campaign-simulation-child.ts");
  try {
    const loader = require.resolve("tsx/cjs", { paths: [cwd] });
    const child = spawn(process.execPath, ["--require", loader, worker, suite, campaignId, referenceSha256], {
      cwd, env: campaignSpawnEnvironment(env), shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    return superviseCampaignChild(child);
  } catch {
    throw integrationBlocked("Falha ao iniciar o filho supervisionado.");
  }
};

export function superviseCampaignChild(child: ChildProcess, observation?: {
  campaignId: string; trace(event: string, worker: { runId: string; pid: number; ppid: number; invocations: number }): void;
}): CampaignChild {
  let challenge: string | undefined;
  let permitted = false;
  let started = false;
  let protocolError = false;
  let tally: Tally | undefined;
  let exited = false;
  let stopping = false;
  let diagnostic: CampaignFailure | undefined;
  let reportedFailure: CampaignFailure | undefined;
  let ready!: (challenge: string | undefined) => void;
  const waitingForReady = new Promise<string | undefined>(resolveReady => { ready = resolveReady; });

  function failProtocol() {
    protocolError = true;
    ready(undefined);
  }
  function requestStop() {
    if (exited || child.pid === undefined) return;
    try { child.kill(); } catch { failProtocol(); }
  }

  child.on("message", (value: unknown) => {
    const message = value as { type?: string; challenge?: unknown; tally?: unknown; stage?: unknown; code?: unknown; failure?: unknown;
      event?: unknown; campaignId?: unknown; runId?: unknown; pid?: unknown; ppid?: unknown; invocations?: unknown } | null;
    if (message?.type === 'trace') {
      const events = ['worker-entry','worker-main-enter','ipc-ready','ipc-started','runner-enter','runner-finished','worker-exit','worker-catch'];
      if (!observation || Object.keys(message).length !== 7 || typeof message.event !== 'string' || !events.includes(message.event)
          || message.campaignId !== observation.campaignId || typeof message.pid !== 'number' || message.pid !== child.pid
          || typeof message.ppid !== 'number' || !Number.isSafeInteger(message.ppid)
          || typeof message.invocations !== 'number' || !Number.isSafeInteger(message.invocations)
          || message.invocations < 0
          || typeof message.runId !== 'string'
          || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(message.runId)) {
        failProtocol(); return;
      }
      observation.trace(message.event, { runId: message.runId, pid: message.pid, ppid: message.ppid,
        invocations: message.invocations });
    } else if (message?.type === 'diagnostic') {
      const stage = campaignDiagnosticStages.find(stage => stage === message.stage);
      if (!stage || Object.keys(message).length !== (message.failure === true ? 4 : 3)) { failProtocol(); return; }
      const safe = campaignFailure(stage, { code: message.code });
      if (message.code !== safe.code) { failProtocol(); return; }
      diagnostic = safe; // Informational only: never authorizes execution or establishes a result.
      if (message.failure === true && !reportedFailure) reportedFailure = safe;
    } else if (message?.type === "ready" && challenge === undefined
        && typeof message.challenge === "string" && /^[a-f0-9-]{36}$/u.test(message.challenge)) {
      challenge = message.challenge;
      ready(challenge);
    } else if (message?.type === "started" && permitted && !started && message.challenge === challenge) {
      started = true;
    } else if (message?.type === "result" && started && tally === undefined
        && message.challenge === challenge && validTally(message.tally)) {
      const { passed, failed, skipped, cancelled } = message.tally;
      tally = { passed, failed, skipped, cancelled };
    } else failProtocol();
  });

  child.on("error", failProtocol);
  child.once("disconnect", () => { if (!tally) failProtocol(); });
  child.once("exit", () => { exited = true; });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolveClose => {
    child.once("close", (code, signal) => { ready(undefined); resolveClose({ code, signal }); });
  });
  // Keep only structured IPC results. Drain any available pipes even if one is missing.
  const { stdout, stderr } = child;
  for (const stream of [stdout, stderr]) {
    stream?.on("error", failProtocol);
    stream?.resume();
  }
  if (!stdout || !stderr) {
    failProtocol();
    requestStop();
  }

  const result = closed.then(({ code, signal }) => {
    if (!exited || protocolError || signal || !tally || code !== (tally.failed || tally.cancelled ? 1 : 0)) {
      if (diagnostic) throw new CampaignDiagnosticError({ ...(reportedFailure ?? diagnostic),
        ...(typeof code === 'number' && Number.isInteger(code) && code >= -2147483648 && code <= 4294967295 ? { exitCode: code } : {}),
        ...(['SIGTERM','SIGKILL','SIGINT','SIGABRT'].includes(signal ?? '') ? { signal: signal! } : {}),
      });
      const failure = new CampaignDiagnosticError({
        ...campaignFailure(protocolError ? 'ipc-protocol' : started ? 'runner' : challenge ? 'ipc-authorize' : 'worker-bootstrap', undefined),
        ...(typeof code === 'number' && Number.isInteger(code) && code >= -2147483648 && code <= 4294967295 ? { exitCode: code } : {}),
      });
      failure.message = '[SEGURANÇA BLOQUEADA] Execução do filho não confirmada.';
      throw failure;
    }
    return { exitCode: code === 0 ? 0 : 1, tally };
  });
  void result.catch(() => undefined);

  return {
    pid: child.pid,
    result,
    async authorize(permit, signal, confirm) {
      const nonce = await waitingForReady;
      await confirm();
      if (!nonce || permitted || protocolError || stopping || signal.aborted || !child.connected) {
        if (diagnostic) throw new CampaignDiagnosticError(reportedFailure ?? diagnostic);
        const failure = new CampaignDiagnosticError(campaignFailure(protocolError ? 'ipc-protocol' : 'ipc-authorize', undefined));
        failure.message = '[SEGURANÇA BLOQUEADA] Filho sem canal de autorização.';
        throw failure;
      }
      permitted = true;
      await new Promise<void>((resolveSend, reject) => {
        child.send({ ...permit, type: "permit", challenge: nonce }, error =>
          error ? reject(error) : resolveSend());
      }).catch(() => {
        failProtocol();
        throw integrationBlocked("Falha na autorização do filho.");
      });
    },
    async stop() {
      stopping = true;
      requestStop();
      // close waits for the local runner and its stdio. It cannot attest arbitrary descendants.
      await within(() => closed, 2_000);
    },
  };
}
