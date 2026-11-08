import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { NestFactory } from "@nestjs/core";
import { DRIZZLE_DATABASE, POSTGRES_POOL } from "../../src/database/database.module";
import { EventsModule } from "../../src/events/events.module";
import { EventsService } from "../../src/events/events.service";
import { QueueEntryService } from "../../src/events/queue-entry.service";
import type { Pool } from "pg";

test("E08.1 Nest resolve as dependências reais de QueueEntryService sob tsx", async () => {
  const variables = ["STAFF_IDEMPOTENCY_TTL_SECONDS", "PARTICIPANT_QUEUE_IDEMPOTENCY_TTL_SECONDS"];
  const original = variables.map(name => process.env[name]);
  for (const name of variables) process.env[name] = "60";
  // create instancia os providers reais; sem init/listen, o lifecycle não conecta ao banco.
  const app = await NestFactory.create(EventsModule, { logger: false });
  try {
    const joining = app.get(QueueEntryService);
    const events = app.get(EventsService);
    const database = app.get(DRIZZLE_DATABASE);
    assert.ok(events instanceof EventsService);
    assert.ok(Reflect.get(joining, "database") === database, "QueueEntryService recebe o banco real");
    assert.ok(Reflect.get(joining, "eventsService") === events, "QueueEntryService recebe EventsService real");
    assert.ok(Reflect.get(events, "database") === database, "EventsService recebe o mesmo banco");
    assert.equal(app.get<Pool>(POSTGRES_POOL).totalCount, 0);
  } finally {
    await app.close();
    variables.forEach((name, index) => {
      if (original[index] === undefined) delete process.env[name]; else process.env[name] = original[index];
    });
  }
});
