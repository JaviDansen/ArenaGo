import { attestIntegrationIdentity, type IntegrationPreflightClient } from "./integration-db-guard";
import { within } from "./campaign-deadline";
import { integrationBlocked, campaignStep, campaignFailure, CampaignDiagnosticError } from "./integration-environment";

export interface CampaignLockConnection extends Pick<IntegrationPreflightClient, "query"> {
  /** Dedicated session. close() must destroy it and reject if closure cannot be confirmed. */
  close(): Promise<void>;
  onDisconnect(listener: () => void): () => void;
}

// Reserved namespace ARGI, identifier INFR. Distinct from the application lock classes.
const lockSql = "SELECT pg_catalog.pg_try_advisory_lock(1095911241, 1229866578) AS acquired";
const ownsSql = `SELECT EXISTS (
  SELECT 1 FROM pg_catalog.pg_locks
  WHERE locktype = 'advisory' AND pid = pg_catalog.pg_backend_pid()
    AND database = (SELECT oid FROM pg_catalog.pg_database WHERE datname = pg_catalog.current_database())
    AND classid = 1095911241::oid AND objid = 1229866578::oid AND objsubid = 2
    AND mode = 'ExclusiveLock' AND granted
) AS owned`;

export async function acquireCampaignLock(
  connection: CampaignLockConnection,
  postgresVersionNum: number,
  { timeout = 2_000, heartbeat = 1_000 } = {},
) {
  const loss = new AbortController();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  let unsubscribe: (() => void) | undefined;
  async function close() {
    if (closed) throw integrationBlocked("Sessão supervisora já encerrada.");
    closed = true;
    clearTimeout(timer);
    try {
      // Closing the dedicated PostgreSQL session releases its session locks.
      await within(() => connection.close(), timeout);
    } catch {
      throw integrationBlocked("Encerramento da sessão supervisora não confirmado.");
    } finally {
      // The closed flag disables callbacks even if the adapter cannot unsubscribe.
      try { unsubscribe?.(); } catch { /* The connection has already been closed or discarded. */ }
    }
  }
  try {
    unsubscribe = connection.onDisconnect(() => { if (!closed) loss.abort(); });
    await within(() => campaignStep('sql-identity', () => attestIntegrationIdentity(connection, postgresVersionNum)), timeout, loss.signal);
    const { rows } = await within(() => connection.query(lockSql), timeout, loss.signal);
    if (rows.length !== 1 || rows[0].acquired !== true) throw integrationBlocked("Lock da campanha indisponível.");
  } catch (error) {
    // A timed-out acquisition could still have succeeded at the server. Discard the session.
    await close();
    if (error instanceof Error && error.message === "[SEGURANÇA BLOQUEADA] Lock da campanha indisponível.") throw error;
    const failure = new CampaignDiagnosticError(campaignFailure('lock-acquisition', error));
    failure.message = '[SEGURANÇA BLOQUEADA] Identidade ou aquisição do lock não confirmada.';
    throw failure;
  }

  function verify(): Promise<void> {
    if (closed || loss.signal.aborted) return Promise.reject(integrationBlocked("Lock da campanha perdido."));
    if (pending) return pending;
    pending = within(async () => {
      const { rows } = await connection.query(ownsSql);
      if (rows.length !== 1 || rows[0].owned !== true) throw new Error();
    }, timeout, loss.signal).catch(() => {
      loss.abort();
      throw integrationBlocked("Lock da campanha perdido.");
    }).finally(() => { pending = undefined; });
    return pending;
  }

  function schedule() {
    if (closed || loss.signal.aborted) return;
    timer = setTimeout(() => { void verify().then(schedule, () => undefined); }, heartbeat);
  }

  schedule();
  return { verify, close, lost: loss.signal };
}
