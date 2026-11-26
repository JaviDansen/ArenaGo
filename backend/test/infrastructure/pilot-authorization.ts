import { integrationBlocked } from "./integration-environment";

let authorizedSuite: string | undefined;
export function authorizePilotSuite(suite: string) {
  if (authorizedSuite || !["admin-external-queue-http", "admin-close-http"].includes(suite)
      || !process.connected) throw integrationBlocked("Permissão supervisora ausente.");
  authorizedSuite = suite;
}
export function requirePilotSuite(suite: string) {
  if (authorizedSuite !== suite || !process.connected) throw integrationBlocked("Execução direta do piloto bloqueada.");
}
