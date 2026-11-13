import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import supertest from 'supertest';
import { AuthService } from '../../src/auth/auth.service';
import { SessionAuthGuard } from '../../src/auth/session-auth.guard';
import { ProblemException } from '../../src/common/errors/problem.exception';
import { ProblemDetailsExceptionFilter } from '../../src/common/errors/problem-details.filter';
import { StaffIdempotencyPolicy } from '../../src/events/staff-idempotency.policy';
import { StaffStationStateController } from '../../src/events/staff-station-state.controller';
import { StaffStationStateService } from '../../src/events/staff-station-state.service';
import { StaffQueueRemovalController } from '../../src/events/staff-queue-removal.controller';
import { StaffQueueRemovalService } from '../../src/events/staff-queue-removal.service';
import { StaffEntryNoStoreGuard } from '../../src/participations/staff-entry.controller';
import { actor, fixture, queueEntryId } from './helpers/staff-station-fixture';

let f = fixture();
@Module({ controllers: [StaffStationStateController, StaffQueueRemovalController], providers: [SessionAuthGuard, StaffEntryNoStoreGuard,
  { provide: AuthService, useValue: { authenticateBearerToken: async (token: string) => {
    if (token !== 'staff') throw new ProblemException({ status: 401, code: 'INVALID_ACCESS_TOKEN',
      typeSlug: 'invalid-access-token', title: 'Sessão inválida', detail: 'Token inválido.' });
    return { userId: actor.userId, sessionId: actor.sessionId, roles: ['staff'] };
  } } },
  { provide: StaffStationStateService, useValue: { read: (...args: Parameters<StaffStationStateService['read']>) => f.reader.read(...args) } },
  { provide: StaffQueueRemovalService, useValue: { remove: (...args: Parameters<StaffQueueRemovalService['remove']>) => f.remover.remove(...args) } },
  { provide: StaffIdempotencyPolicy, useValue: { expiresAt: () => new Date('2099-01-01') } },
] }) class StaffStationModule {}

let app: INestApplication;
before(async () => { app = await NestFactory.create(StaffStationModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ProblemDetailsExceptionFilter());
  await app.listen(0, '127.0.0.1'); });
after(async () => { await app?.close(); });
const id = (n: number) => `abcdef00-0000-4000-8000-${String(n).padStart(12, '0')}`;
const statePath = `/api/v1/staff/events/${actor.eventId}/experiences/${actor.experienceId}/stations/${actor.stationId}/operational-state`;
const removalPath = `/api/v1/staff/events/${actor.eventId}/experiences/${actor.experienceId}/queue-entries/${queueEntryId}/remove`;
const get = (url: string) => supertest(app.getHttpServer()).get(url).set('Authorization', 'Bearer staff');
const remove = (url = removalPath) => supertest(app.getHttpServer()).post(url).set('Authorization', 'Bearer staff')
  .set('Idempotency-Key', id(20)).send({});

test('HTTP nominal exige sessão e UUID, usa apenas principal e retorna campos mínimos', async () => {
  f = fixture();
  assert.equal((await supertest(app.getHttpServer()).get(statePath)).status, 401);
  assert.equal((await get(statePath.replace(actor.stationId, 'invalid'))).status, 400);
  const res = await get(statePath).query({ userId: id(99), sessionId: id(98) });
  assert.equal(res.status, 200); assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(Object.keys(res.body).sort(), ['availability', 'canCall', 'eventId', 'experienceId',
    'pending', 'stationId', 'waiting', 'waitingCount']);
  assert.deepEqual(res.body.waiting, [{ queueEntryId, displayName: 'Ana', position: 1 }]);
  assert.ok(f.queries.some(q => q.params.includes(actor.sessionId) && q.params.includes(actor.userId)));
});

test('HTTP consulta nega sessão revogada e recurso sem concessão sem revelar dados', async () => {
  f = fixture(); f.flags.session = false;
  assert.equal((await get(statePath)).status, 401);
  f.flags.session = true; f.flags.grant = false;
  const denied = await get(statePath), missing = await get(statePath.replace(actor.eventId, id(99)));
  assert.equal(denied.status, 404); assert.equal(missing.status, 404);
  assert.deepEqual(denied.body, missing.body);
});

test('HTTP remoção não concede acesso a Admin sem Staff ou concessão revogada', async () => {
  f = fixture(); f.flags.grant = false;
  const denied = await remove();
  assert.equal(denied.status, 404); assert.equal(denied.body.code, 'RESOURCE_NOT_FOUND');
  assert.equal(f.state.entry, 'waiting'); assert.equal(f.state.audit, 0);
});

test('HTTP remoção exige Bearer, chave e corpo vazio; mantém evento e participação', async () => {
  f = fixture();
  assert.equal((await supertest(app.getHttpServer()).post(removalPath).send({})).status, 401);
  assert.equal((await supertest(app.getHttpServer()).post(removalPath).set('Authorization', 'Bearer staff').send({})).status, 400);
  assert.equal((await remove(removalPath.replace(queueEntryId, 'invalid'))).status, 400);
  assert.equal((await supertest(app.getHttpServer()).post(removalPath)
    .set('Authorization', 'Bearer staff').set('Idempotency-Key', id(20)).send({ userId: id(99) })).status, 400);
  const res = await remove();
  assert.equal(res.status, 200); assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body.participation.status, 'active');
  assert.equal(res.body.queueEntry.closeReason, 'staff_queue_removed');
  assert.equal(f.state.audit, 1);
});

test('HTTP falha interna não expõe SQL, dados privados ou chaves', async () => {
  f = fixture(); f.flags.failAudit = true;
  const res = await remove();
  assert.equal(res.status, 500); assert.equal(res.body.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE|audit_logs|idempotency_operations/);
  assert.equal(f.state.entry, 'waiting');
  f = fixture(); f.flags.failRead = true;
  const readFailure = await get(statePath);
  assert.equal(readFailure.status, 500); assert.equal(readFailure.body.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(readFailure.headers['cache-control'], 'no-store');
  assert.doesNotMatch(JSON.stringify(readFailure.body), /PRIVATE_STATION_DATABASE/);
});
