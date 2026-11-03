// Atraso artificial para exibir o estado de carregamento na demonstração.
export const STAFF_DEMO_LATENCY_MS = 600;

export function waitStaffDemoLatency(ms = STAFF_DEMO_LATENCY_MS) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
