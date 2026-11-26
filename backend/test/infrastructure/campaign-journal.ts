import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { integrationBlocked, integrationDestination } from "./integration-environment";
import type { CampaignFailure } from './integration-environment';

export type Tally = Readonly<{ passed: number; failed: number; skipped: number; cancelled: number }>;
export type RunnerEvidence = Readonly<{ exitCode: number; tally: Tally }>;
type Verdict = "pending" | "passed" | "failed";
type Phase = "preparing" | "authorized" | "running" | "verifying" | "clean" | "test-failure" | "inconsistent" | "interrupted";
type Diagnosis = "preflight" | "launch" | "supervision" | "timeout" | "baseline" | "resources"
  | "lock-lost" | "persistence" | "session-close" | "cancelled";
export type CampaignEvidence = {
  id: string;
  destination: string;
  referenceSha256: string;
  node: string;
  revision: { branch: string; commit: string };
  supervisor: { instance: string; pid: number };
  suites: readonly string[];
  beganAt: string;
  endedAt?: string;
  durationMs?: number;
  phase: Phase;
  preflight: Verdict;
  lock: "acquired" | "lost" | "closed" | "uncertain";
  postflight: Verdict;
  resources: Verdict;
  recoveryPending: boolean;
  diagnosis?: Diagnosis;
  failure?: CampaignFailure;
  cleanupFailures?: CampaignFailure[];
  terminalPersistence?: 'passed' | 'failed';
  attempts: {
    suite: string;
    pid?: number;
    state: "not-started" | "launched" | "authorized" | "reported";
    launchedAt?: string;
    endedAt?: string;
    result?: RunnerEvidence;
  }[];
};

export function campaignDestination() {
  const { address, port, database, role } = integrationDestination;
  return address + ":" + port + "/" + database + " (" + role + ")";
}

export function defaultCampaignStateDirectory() {
  // Same account and endpoint use one namespace across checkouts. Future real deployment must
  // provision one protected, shared namespace for all authorized operators of this destination.
  const { address, port, database } = integrationDestination;
  return join(homedir(), ".arenago", "integration", address + "-" + port + "-" + database);
}

export interface CampaignJournal {
  claim(record: CampaignEvidence): Promise<{
    save(next: CampaignEvidence): Promise<void>;
    finish(): Promise<void>;
  }>;
}

const transitions: Record<Phase, readonly Phase[]> = {
  preparing: ["preparing", "authorized", "inconsistent", "interrupted"],
  authorized: ["running", "inconsistent", "interrupted"],
  running: ["running", "verifying", "inconsistent", "interrupted"],
  verifying: ["verifying", "preparing", "clean", "test-failure", "inconsistent", "interrupted"],
  clean: ["inconsistent", "interrupted"],
  "test-failure": ["inconsistent", "interrupted"],
  inconsistent: ["inconsistent"],
  interrupted: ["interrupted", "inconsistent"],
};

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function matches(value: unknown, pattern: RegExp) {
  return typeof value === "string" && pattern.test(value);
}

function isInteger(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function validTally(value: unknown): value is Tally {
  if (!isRecord(value) || Object.keys(value).length !== 4
      || !["passed", "failed", "skipped", "cancelled"].every(key => Object.hasOwn(value, key))) return false;
  const { passed, failed, skipped, cancelled } = value;
  return isInteger(passed, 0, 1_000_000) && isInteger(failed, 0, 1_000_000)
    && isInteger(skipped, 0, 1_000_000) && isInteger(cancelled, 0, 1_000_000)
    && passed + failed + skipped + cancelled > 0;
}

function isTimestamp(value: unknown) {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function terminalEvidence(record: unknown, id: string): boolean {
  if (!isRecord(record) || record.id !== id || !uuid.test(id) || record.destination !== campaignDestination()
      || (record.phase !== "clean" && record.phase !== "test-failure") || record.recoveryPending !== false
      || record.lock !== "closed" || record.preflight !== "passed" || record.postflight !== "passed"
      || record.resources !== "passed" || record.diagnosis !== undefined
      || !matches(record.referenceSha256, /^[a-f0-9]{64}$/u) || !matches(record.node, /^v\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/u)
      || !isRecord(record.revision) || !matches(record.revision.commit, /^[a-f0-9]{40}$/u)
      || !matches(record.revision.branch, /^[a-zA-Z0-9._/-]{1,180}$/u)
      || !isRecord(record.supervisor) || !matches(record.supervisor.instance, uuid) || !isInteger(record.supervisor.pid, 1)
      || !isTimestamp(record.beganAt) || !isTimestamp(record.endedAt) || !isInteger(record.durationMs, 0)
      || !Array.isArray(record.suites) || !record.suites.length || new Set(record.suites).size !== record.suites.length
      || !Array.isArray(record.attempts) || record.attempts.length !== record.suites.length) return false;

  let failed = false;
  for (let index = 0; index < record.suites.length; index++) {
    const suite: unknown = record.suites[index];
    const attempt: unknown = record.attempts[index];
    if (!matches(suite, /^[a-z0-9-]+$/u) || !isRecord(attempt) || attempt.suite !== suite) return false;
    if (failed) {
      if (attempt.state !== "not-started" || Object.keys(attempt).length !== 2) return false;
      continue;
    }
    if (attempt.state !== "reported" || !isInteger(attempt.pid, 1) || !isTimestamp(attempt.launchedAt)
        || !isTimestamp(attempt.endedAt) || !isRecord(attempt.result) || !validTally(attempt.result.tally)) return false;
    const { passed, failed: failures, cancelled } = attempt.result.tally;
    if (cancelled !== 0 || (failures === 0 && passed === 0)
        || attempt.result.exitCode !== (failures ? 1 : 0)) return false;
    failed = failures > 0;
  }
  return record.phase === (failed ? "test-failure" : "clean");
}

async function readTerminalRecord(path: string, id: string) {
  if (!(await lstat(path)).isFile()) return false;
  const record: unknown = JSON.parse(await readFile(path, "utf8"));
  return terminalEvidence(record, id);
}

/** Only the claiming process can update a journal via this handle. No automatic takeover. */
export function fileCampaignJournal(directory: string): CampaignJournal {
  if (!isAbsolute(directory)) throw integrationBlocked("Diretório operacional inválido.");
  return {
    async claim(record) {
      const marker = join(directory, "occupied");
      const owner = join(marker, "owner");
      const records = join(directory, "campaigns");
      const { id } = record;
      if (record.phase !== "preparing" || !record.recoveryPending || !uuid.test(id)
          || record.destination !== campaignDestination()) {
        throw integrationBlocked("Estado inicial da campanha inválido.");
      }
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await mkdir(marker, { mode: 0o700 });
      } catch {
        throw integrationBlocked("Ambiente ocupado, com recuperação pendente ou sem registro operacional.");
      }

      const ownership = id + ":" + randomUUID();
      async function verifyOwner() {
        if (!(await lstat(marker)).isDirectory() || !(await lstat(owner)).isFile()
            || await readFile(owner, "utf8") !== ownership) throw new Error();
      }
      // Claim before inspecting history. Any uncertain admission retains the marker.
      try {
        await writeFile(owner, ownership, { flag: "wx", mode: 0o600 });
        await mkdir(records, { recursive: true, mode: 0o700 });
        if (!(await lstat(records)).isDirectory()) throw new Error();
        for (const entry of await readdir(records, { withFileTypes: true })) {
          const previousId = entry.name.slice(0, -5);
          if (!entry.isFile() || !entry.name.endsWith(".json") || !uuid.test(previousId) || previousId === id
              || !await readTerminalRecord(join(records, entry.name), previousId)) throw new Error();
        }
      } catch {
        throw integrationBlocked("Histórico da campanha inválido, indisponível ou com recuperação pendente.");
      }

      const path = join(records, id + ".json");
      let phase: Phase = "preparing";
      let releasable = false;
      let busy = false;
      let finished = false;
      async function save(next: CampaignEvidence) {
        if (finished || busy || id !== next.id || next.destination !== record.destination
            || !transitions[phase].includes(next.phase)) {
          throw integrationBlocked("Transição inválida do registro de campanha.");
        }
        const terminal = next.phase === "clean" || next.phase === "test-failure";
        if (terminal && !terminalEvidence(next, id)) throw integrationBlocked("Conclusão da campanha sem evidência suficiente.");
        busy = true;
        const temp = join(records, id + "." + randomUUID() + ".tmp");
        let created = false;
        try {
          await verifyOwner();
          const file = await open(temp, "wx", 0o600);
          created = true;
          try {
            await file.writeFile(JSON.stringify(next));
            await file.sync();
          } finally {
            await file.close();
          }
          await rename(temp, path);
          phase = next.phase;
          releasable = terminal;
        } catch {
          releasable = false;
          throw integrationBlocked("Falha ao persistir o registro da campanha.");
        } finally {
          if (created) await unlink(temp).catch(() => undefined);
          busy = false;
        }
      }

      await save(record);
      return {
        save,
        async finish() {
          if (finished || busy || !releasable) throw integrationBlocked("Recuperação pendente.");
          busy = true;
          try {
            await verifyOwner();
            if (!await readTerminalRecord(path, id)) throw new Error();
            await unlink(owner);
            await rmdir(marker);
            finished = true;
          } catch {
            throw integrationBlocked("Marcador de recuperação não liberado.");
          } finally {
            busy = false;
          }
        },
      };
    },
  };
}
