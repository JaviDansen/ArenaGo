import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { win32 } from "node:path";
import type { ReadStream } from "node:tty";
import { promisify } from "node:util";
import { loadCampaignReference } from "./campaign-reference";
import type { IntegrationPreflightPoolFactory } from "./integration-db-guard";
import { buildIntegrationEnvironment, integrationBlocked, integrationDestination } from "./integration-environment";
import { collectPreparationEvidence, type PreparationOperation, type WindowsPostgresIdentity } from "./integration-preparation";

const runFile = promisify(execFile);
const digestPattern = /^[0-9a-f]{64}$/u;
const localPathPattern = /^[A-Za-z]:\\[^:]+$/u;

async function readApprovalFile(file: string, maxBytes: number) {
  for (let path = file;;) {
    const item = await lstat(path);
    if (item.isSymbolicLink() || (path === file ? !item.isFile() || item.size > maxBytes : !item.isDirectory())) {
      throw new Error();
    }
    const parent = win32.dirname(path);
    if (parent === path) break;
    path = parent;
  }
  const bytes = await readFile(file);
  if (bytes.length > maxBytes) throw new Error();
  return bytes;
}

export function validateStructuralApproval(value: unknown, target: WindowsPostgresIdentity) {
  const record = value as { kind?: unknown; sourceInstanceSha256?: unknown; sourceClusterSha256?: unknown; sha256?: unknown } | undefined;
  if (record?.kind !== "homologated" || typeof record.sha256 !== "string" || !digestPattern.test(record.sha256)
      || typeof record.sourceInstanceSha256 !== "string" || !digestPattern.test(record.sourceInstanceSha256)
      || typeof record.sourceClusterSha256 !== "string" || !digestPattern.test(record.sourceClusterSha256)
      || record.sourceInstanceSha256 === target.instanceSha256 || record.sourceClusterSha256 === target.clusterSha256) {
    throw integrationBlocked("Referência v2 independente sem homologação válida.");
  }
  return record.sha256;
}

export async function loadIndependentReference(programData: string, target: WindowsPostgresIdentity) {
  const directory = win32.join(programData, "ArenaGO", "integration-authority");
  try {
    const record: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      await readApprovalFile(win32.join(directory, "reference-v2.approval.json"), 4_096),
    ));
    const sha256 = validateStructuralApproval(record, target);
    const source = win32.join(directory, "reference-v2.json");
    return await loadCampaignReference({
      approval: () => ({ source, sha256, kind: "homologated" }),
      readApprovedSource: path => readApprovalFile(path, 4_194_304),
    }, "real");
  } catch {
    throw integrationBlocked("Referência v2 independente sem homologação válida.");
  }
}

export async function readTerminalPassword(input: ReadStream, prompt: (message: string) => void) {
  const bytes = Buffer.alloc(3_072);
  let length = 0;
  const previousRaw = input.isRaw;
  try {
    if (!input.isTTY || input.destroyed || input.readableEnded || input.readableEncoding) throw new Error();
    input.setRawMode(true);
    prompt("Senha da role PostgreSQL dedicada (sem eco): ");
    let cleanup = () => {};
    try {
      await new Promise<void>((resolve, reject) => {
        const cancel = () => reject(new Error());
        const read = (chunk: Buffer) => {
          try {
            for (const byte of chunk) {
              if (byte === 13 || byte === 10) {
                resolve();
                return;
              }
              if (byte === 8 || byte === 127) {
                // Delete a full UTF-8 character, including its continuation bytes.
                if (length) {
                  const end = length;
                  while (--length > 0 && (bytes[length] & 0xc0) === 0x80) { /* scan backwards */ }
                  bytes.fill(0, length, end);
                }
              } else if (byte < 32 || length === bytes.length) {
                cancel();
                return;
              } else {
                bytes[length++] = byte;
              }
            }
          } finally {
            chunk.fill(0);
          }
        };
        cleanup = () => {
          input.pause();
          input.off("data", read);
          input.off("end", cancel);
          input.off("close", cancel);
          input.off("error", cancel);
          process.off("SIGINT", cancel);
        };
        input.once("end", cancel);
        input.once("close", cancel);
        input.once("error", cancel);
        process.once("SIGINT", cancel);
        input.on("data", read);
        input.resume();
      });
      const password = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
      if (!password.trim()) throw new Error();
      return encodeURIComponent(password);
    } finally {
      cleanup();
      prompt("\n");
    }
  } catch {
    throw integrationBlocked("Entrada protegida da credencial cancelada ou inválida.");
  } finally {
    bytes.fill(0);
    if (input.isTTY && input.isRaw !== previousRaw) input.setRawMode(previousRaw);
  }
}

async function main() {
  const [authorization, action, bin, data, expectedDigest, ...extra] = process.argv.slice(2);
  const { SystemRoot, ProgramData } = process.env;
  if (process.platform !== "win32" || process.env.NODE_ENV !== "test" || !process.stdin.isTTY || !process.stderr.isTTY
      || authorization !== "--authorized-read" || (action !== "extract-candidate" && action !== "qualify")
      || (action === "extract-candidate" && process.stdout.isTTY)
      || extra.length || !digestPattern.test(expectedDigest ?? "") || !SystemRoot || !ProgramData
      || ![bin, data, SystemRoot, ProgramData].every(path => typeof path === "string" && localPathPattern.test(path)
        && win32.normalize(path) === path)
      || Object.keys(process.env).some(key => /^(PG|NODE_PG_FORCE_NATIVE$|NODE_OPTIONS$|NODE_PATH$|NODE_DEBUG)/iu.test(key))) {
    throw integrationBlocked("Entrada operacional Windows ou ambiente de leitura inválido.");
  }
  const powershell = win32.join(SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = win32.join(__dirname, "inspect-postgres-windows.ps1");
  async function observeIdentity(): Promise<WindowsPostgresIdentity> {
    try {
      const { stdout } = await runFile(powershell, [
        "-NoProfile", "-NonInteractive", "-File", script,
        "-ExpectedBinDirectory", bin, "-ExpectedDataDirectory", data,
      ], { windowsHide: true, timeout: 30_000, maxBuffer: 16_384, encoding: "utf8" });
      return JSON.parse(stdout) as WindowsPostgresIdentity;
    } catch {
      throw integrationBlocked("Atestação Windows inconclusiva. Consulte o diagnóstico no terminal autorizado.");
    }
  }
  const expectedIdentity = await observeIdentity();
  if (expectedIdentity?.instanceSha256 !== expectedDigest || !digestPattern.test(expectedIdentity.clusterSha256)) {
    throw integrationBlocked("Identidade Windows divergente do fingerprint aprovado.");
  }
  const approved = action === "qualify" ? await loadIndependentReference(ProgramData, expectedIdentity) : undefined;
  const operation: PreparationOperation = approved
    ? { kind: "qualify", expectedStructure: approved.reference } : { kind: "extract-candidate" };
  const { address, port, database, role } = integrationDestination;
  const password = await readTerminalPassword(process.stdin, message => { process.stderr.write(message); });
  const connectionString = `postgresql://${role}:${password}@${address}:${port}/${database}`;
  const env = buildIntegrationEnvironment("admin-external-queue-http", connectionString, {});
  const { Client } = await import("pg");
  const createPool: IntegrationPreflightPoolFactory = config => {
    // One physical client, no replacement and no reuse. The collector owns BEGIN and ROLLBACK.
    const client = new Client(config);
    let failed = false;
    client.on("error", () => { failed = true; });
    return {
      async connect() {
        await client.connect();
        return {
          query: sql => client.query(sql),
          release() { /* end() always closes this client */ },
        };
      },
      async end() {
        await client.end();
        if (failed) throw integrationBlocked("Sessão PostgreSQL interrompida.");
      },
    };
  };
  const evidence = await collectPreparationEvidence(operation, { env, expectedIdentity, observeIdentity, createPool });
  process.stdout.write(JSON.stringify({ ...evidence, referenceSha256: approved?.sha256 }) + "\n");
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write((error instanceof Error && error.message.startsWith("[SEGURANÇA BLOQUEADA] ")
      ? error.message : "[SEGURANÇA BLOQUEADA] Preparação somente leitura inconclusiva.") + "\n");
    process.exitCode = 1;
  });
}
