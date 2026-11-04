// Atraso artificial para exibir o estado de carregamento na demonstração.
export const ADMIN_DEMO_LATENCY_MS = 600;

export function waitAdminDemoLatency(ms = ADMIN_DEMO_LATENCY_MS) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
