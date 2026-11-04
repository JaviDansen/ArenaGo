import { Injectable } from "@nestjs/common";

export function eventClosureConfiguration(env: NodeJS.ProcessEnv) {
  const raw = env.EVENT_CLOSURE_INTERVAL_MS ?? "30000";
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1000 || Number(raw) > 3600000) {
    throw new Error("EVENT_CLOSURE_INTERVAL_MS deve ser inteiro entre 1000 e 3600000.");
  }
  if (env.EVENT_CLOSURE_JOB_TEST_ENABLED !== undefined && !["true", "false"].includes(env.EVENT_CLOSURE_JOB_TEST_ENABLED)) {
    throw new Error("EVENT_CLOSURE_JOB_TEST_ENABLED deve ser true ou false.");
  }
  return { intervalMs: Number(raw), enabled: env.NODE_ENV !== "test" || env.EVENT_CLOSURE_JOB_TEST_ENABLED === "true" };
}

@Injectable()
export class EventClosurePolicy {
  readonly configuration = eventClosureConfiguration(process.env);
}
