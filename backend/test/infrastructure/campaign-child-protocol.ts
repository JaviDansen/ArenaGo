import { randomUUID } from "node:crypto";
import { win32 } from "node:path";
import { within } from "./campaign-deadline";
import { campaignDestination, validTally, type Tally } from "./campaign-journal";
import { integrationBlocked, validateIntegrationEnvironment, windowsObserverVariableGroups } from "./integration-environment";

export type CampaignPermit = Readonly<{
  campaignId: string;
  suite: string;
  profile: string;
  destination: string;
  referenceSha256: string;
}>;

export type CampaignIdentity = Pick<CampaignPermit, "campaignId" | "referenceSha256">;

// libuv copies these Windows defaults from the parent when omitted, even with an explicit env.
const windowsSpawnDefaults = ["HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "SYSTEMDRIVE", "USERDOMAIN", "USERNAME", "WINDIR"];

export function campaignSpawnEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // An own property with undefined blocks Node's automatic coverage propagation.
  const childEnv: NodeJS.ProcessEnv = { ...env, NODE_V8_COVERAGE: undefined };
  if (process.platform === "win32") {
    for (const name of windowsSpawnDefaults) {
      if (childEnv[name] === undefined) childEnv[name] = "";
    }
  }
  return childEnv;
}

/** OS observers never need database URLs or application credentials. */
export function windowsObserverEnvironment(parent: NodeJS.ProcessEnv,
  groups: readonly (keyof typeof windowsObserverVariableGroups)[] = Object.keys(windowsObserverVariableGroups) as (keyof typeof windowsObserverVariableGroups)[],
): NodeJS.ProcessEnv {
  const value = (name: string) => Object.entries(parent).find(([key]) => key.toUpperCase() === name.toUpperCase())?.[1];
  const root = value("SystemRoot");
  if (!root || !/^[A-Za-z]:\\[^:]+$/u.test(root) || win32.normalize(root) !== root) {
    throw integrationBlocked("SystemRoot do observador inválido.");
  }
  const env = campaignSpawnEnvironment({});
  // Block implicit libuv inheritance when a value is absent or its group is omitted by the probe.
  env.TEMP = "";
  env.USERPROFILE = "";
  env.SystemRoot = root;
  env.WINDIR = root;
  env.SYSTEMDRIVE = win32.parse(root).root.slice(0, 2);
  // Resolve fsutil and built-in PowerShell modules without the caller's PATH/PSModulePath.
  env.PATH = [win32.join(root, "System32"), win32.join(root, "System32/WindowsPowerShell/v1.0")].join(";");
  const programData = value("ProgramData");
  if (programData !== undefined) env.ProgramData = programData;
  for (const group of groups) {
    for (const name of windowsObserverVariableGroups[group]) {
      const entry = value(name);
      if (entry !== undefined) env[name] = entry;
    }
  }
  return env;
}

function campaignChildEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (process.platform === "win32") {
    for (const name of windowsSpawnDefaults) {
      // Empty entries only suppress implicit inheritance; named Windows values use the shared allowlist.
      if (env[name] === "") delete env[name];
    }
  }
  return env;
}

function sendToSupervisor(message: object): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.send || !process.connected) {
      reject(integrationBlocked("Supervisor indisponível."));
      return;
    }
    process.send(message, (error: Error | null) => error ? reject(integrationBlocked("Canal indisponível.")) : resolve());
  });
}

/** Call before importing a migrated suite or constructing any write-capable resources. */
export async function runAsCampaignChild(
  suiteId: string,
  expected: CampaignIdentity,
  run: (permit: CampaignPermit) => Promise<Tally>,
  trace?: (event: 'ipc-ready' | 'ipc-started' | 'worker-exit') => void,
) {
  if (!process.send || !process.connected) throw integrationBlocked("Execução direta sem supervisor.");
  const { suite: expectedSuite } = validateIntegrationEnvironment(suiteId, campaignChildEnvironment());
  const { campaignId, referenceSha256 } = expected;
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(campaignId)
      || !/^[a-f0-9]{64}$/u.test(referenceSha256)) throw integrationBlocked("Contexto de campanha inválido.");
  const destination = campaignDestination();
  const challenge = randomUUID();
  const disconnected = () => process.exit(2);
  process.once("disconnect", disconnected);
  let onPermit: ((message: unknown) => void) | undefined;

  try {
    const permit = await within(async () => {
      const message = new Promise<CampaignPermit>((resolve, reject) => {
        onPermit = (value: unknown) => {
          if (!value || typeof value !== "object" || Array.isArray(value)
              || !("type" in value) || value.type !== "permit"
              || !("challenge" in value) || value.challenge !== challenge
              || !("suite" in value) || value.suite !== expectedSuite.id
              || !("profile" in value) || value.profile !== expectedSuite.profile
              || !("destination" in value) || value.destination !== destination
              || !("campaignId" in value) || value.campaignId !== campaignId
              || !("referenceSha256" in value) || value.referenceSha256 !== referenceSha256) {
            reject(integrationBlocked("Permissão de campanha inválida."));
            return;
          }
          resolve(Object.freeze({ campaignId, suite: expectedSuite.id, profile: expectedSuite.profile, destination, referenceSha256 }));
        };
        process.once("message", onPermit);
      });
      trace?.('ipc-ready');
      await Promise.all([sendToSupervisor({ type: "ready", challenge }), message]);
      return message;
    // Supervisor persists running through two 30s Windows observers BEFORE sending permission.
    // A 10s child timeout could expire during that required persistence. Still bounded, no SQL yet.
    }, 120_000);

    if (!process.connected) throw integrationBlocked("Supervisor indisponível.");
    await sendToSupervisor({ type: "started", challenge });
    trace?.('ipc-started');
    if (!process.connected) throw integrationBlocked("Supervisor indisponível.");
    const tally = await run(permit);
    if (!validTally(tally)) throw integrationBlocked("Resultado do runner inválido.");
    await sendToSupervisor({ type: "result", challenge, tally });
    return tally.failed || tally.cancelled ? 1 : 0;
  } finally {
    trace?.('worker-exit');
    if (onPermit) process.off("message", onPermit);
    process.off("disconnect", disconnected);
    if (process.connected) process.disconnect?.();
  }
}
