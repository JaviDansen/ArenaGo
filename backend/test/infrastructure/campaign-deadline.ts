import { integrationBlocked } from "./integration-environment";

export class CampaignTimeout extends Error {
  constructor() {
    super("[SEGURANÇA BLOQUEADA] Prazo da operação excedido.");
  }
}

export async function within<T>(work: () => Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw integrationBlocked("Operação interrompida.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CampaignTimeout()), ms);
        cancel = () => reject(integrationBlocked("Operação interrompida."));
        signal?.addEventListener("abort", cancel, { once: true });
      }),
      Promise.resolve().then(() => {
        if (signal?.aborted) throw integrationBlocked("Operação interrompida.");
        return work();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (cancel) signal?.removeEventListener("abort", cancel);
  }
}
