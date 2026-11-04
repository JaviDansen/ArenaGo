import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { EventClosureService } from "../../src/events/event-closure.service";
import { EventClosurePolicy, eventClosureConfiguration } from "../../src/events/event-closure.policy";
import { EventClosureScheduler } from "../../src/events/event-closure.scheduler";

function harness(enabled = true) {
  const cursors: Array<string | null> = [], attempted: string[] = [], logs: unknown[] = [];
  let pages = [["a", "b"]], failEvent = "", failDiscovery = false;
  let held: Promise<void> | undefined;
  const service = {
    async findCandidates(cursor: string | null) { cursors.push(cursor); if (failDiscovery) throw new Error("PRIVATE_CREDENTIAL"); return pages.shift() ?? []; },
    async regularizeEvent(id: string, skip: boolean) { assert.equal(skip, true); attempted.push(id); await held; if (id === failEvent) throw new Error("PRIVATE_PERSON"); return { kind: "closed" as const }; },
  };
  const scheduler = new EventClosureScheduler(service as unknown as EventClosureService, { configuration: { enabled, intervalMs: 1000 } });
  const logger = { error(value: unknown) { logs.push(value); }, log(value: unknown) { logs.push(value); } };
  Reflect.set(scheduler, "logger", logger);
  return { scheduler, service, cursors, attempted, logs, pages(value: string[][]) { pages = value; }, fail(id: string) { failEvent = id; },
    discoveryError(value: boolean) { failDiscovery = value; }, hold(value: Promise<void>) { held = value; } };
}
test("E08.9 configuração valida intervalo e habilita produção inclusive com flag de teste false", () => {
  assert.deepEqual(eventClosureConfiguration({ NODE_ENV: "production", EVENT_CLOSURE_JOB_TEST_ENABLED: "false" }), { enabled: true, intervalMs: 30000 });
  assert.equal(eventClosureConfiguration({ NODE_ENV: "test" }).enabled, false);
  assert.equal(eventClosureConfiguration({ NODE_ENV: "test", EVENT_CLOSURE_JOB_TEST_ENABLED: "true" }).enabled, true);
  for (const value of ["", "0", "999", "3600001", "1.5", "NaN", "1000ms", "-1", " 1000 "]) assert.throws(() => eventClosureConfiguration({ EVENT_CLOSURE_INTERVAL_MS: value }), /INTERVAL/);
  for (const value of ["1000", "3600000"]) assert.equal(eventClosureConfiguration({ EVENT_CLOSURE_INTERVAL_MS: value }).intervalMs, Number(value));
  assert.throws(() => eventClosureConfiguration({ EVENT_CLOSURE_JOB_TEST_ENABLED: "yes" }), /TEST_ENABLED/);
});
test("E08.9 startup, período e shutdown usam timer sem deixar execução futura", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const f = harness();
  try {
    await f.scheduler.onApplicationBootstrap(); assert.deepEqual(f.attempted, ["a", "b"]);
    f.pages([["c"]]); t.mock.timers.tick(1000); await f.scheduler.runCycle(); assert.deepEqual(f.attempted, ["a", "b", "c"]);
    await f.scheduler.beforeApplicationShutdown(); t.mock.timers.tick(5000); assert.equal(f.cursors.length, 2);
    await f.scheduler.runCycle(); assert.equal(f.cursors.length, 2);
  } finally { await f.scheduler.beforeApplicationShutdown(); t.mock.timers.reset(); }
});
test("E08.9 ambiente de testes não inicia agendamento implicitamente", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); const f = harness(false);
  try { await f.scheduler.onApplicationBootstrap(); t.mock.timers.tick(5000); assert.deepEqual(f.cursors, []); }
  finally { await f.scheduler.beforeApplicationShutdown(); t.mock.timers.reset(); }
});
test("E08.9 ciclos concorrentes compartilham promessa; shutdown espera evento corrente e para os demais", async () => {
  const f = harness(); let release!: () => void; f.hold(new Promise<void>(yes => { release = yes; }));
  const a = f.scheduler.runCycle(), b = f.scheduler.runCycle(); assert.equal(a, b);
  await Promise.resolve(); assert.deepEqual(f.attempted, ["a"]);
  let stopped = false; const shutdown = f.scheduler.beforeApplicationShutdown().then(() => { stopped = true; });
  await Promise.resolve(); assert.equal(stopped, false); release(); await Promise.all([a, b, shutdown]);
  assert.deepEqual(f.attempted, ["a"]); assert.equal(stopped, true);
});
test("E08.9 falha individual não impede outros eventos, recuperação ou retry posterior", async () => {
  const f = harness(); f.fail("a"); await f.scheduler.runCycle(); assert.deepEqual(f.attempted, ["a", "b"]);
  f.fail(""); f.pages([["a"]]); await f.scheduler.runCycle(); assert.deepEqual(f.attempted, ["a", "b", "a"]);
  assert.equal(JSON.stringify(f.logs).includes("PRIVATE"), false);
  assert.ok(f.logs.some(log => typeof log === "object" && log !== null && "event" in log && log.event === "EVENT_CLOSURE_EVENT_FAILED")); await f.scheduler.beforeApplicationShutdown();
});
test("E08.9 descoberta falha sem rejeição não observada e próximo ciclo recupera", async () => {
  const f = harness(); f.discoveryError(true); await f.scheduler.runCycle(); assert.deepEqual(f.attempted, []);
  f.discoveryError(false); await f.scheduler.runCycle(); assert.deepEqual(f.attempted, ["a", "b"]);
  assert.deepEqual(f.logs[0], "EVENT_CLOSURE_CYCLE_FAILED"); await f.scheduler.beforeApplicationShutdown();
});
test("E08.9 paginação keyset avança após erro sem repetir página infinita", async () => {
  const f = harness(), first = Array.from({ length: 100 }, (_, i) => `id-${i}`); f.pages([first, ["last"]]); f.fail("id-50");
  await f.scheduler.runCycle(); assert.deepEqual(f.cursors, [null, "id-99"]); assert.equal(f.attempted.length, 101); await f.scheduler.beforeApplicationShutdown();
});
test("E08.9 nova instância recupera eventos após reinicialização", async () => {
  const first = harness(); await first.scheduler.runCycle(); await first.scheduler.beforeApplicationShutdown();
  const next = harness(); next.pages([["late-event"]]); await next.scheduler.runCycle(); assert.deepEqual(next.attempted, ["late-event"]); await next.scheduler.beforeApplicationShutdown();
});
test("E08.9 ciclo de vida Nest aguarda shutdown antes da liberação do banco", async () => {
  const f = harness(); const order: string[] = [];
  @Module({ providers: [{ provide: EventClosureService, useValue: f.service }, { provide: EventClosurePolicy, useValue: { configuration: { enabled: true, intervalMs: 1000 } } },
    EventClosureScheduler, { provide: "pool-lifecycle", useValue: { onApplicationShutdown() { order.push("pool-ended"); assert.equal(Reflect.get(app.get(EventClosureScheduler), "stopped"), true); } } }] })
  class LifecycleModule {}
  const app = await NestFactory.createApplicationContext(LifecycleModule, { logger: false });
  assert.deepEqual(f.attempted, ["a", "b"]); await app.close(); assert.deepEqual(order, ["pool-ended"]);
});
