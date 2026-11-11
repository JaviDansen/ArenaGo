import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import supertest from 'supertest';
import { AuthService } from '../../src/auth/auth.service';
import { SessionAuthGuard } from '../../src/auth/session-auth.guard';
import { StaffEntryNoStoreGuard } from '../../src/participations/staff-entry.controller';
import { ProblemDetailsExceptionFilter } from '../../src/common/errors/problem-details.filter';
import { StaffCalledRemovalController } from '../../src/events/staff-called-removal.controller';
import { CalledRemovalService } from '../../src/events/staff-called-removal.service';
import { StaffIdempotencyPolicy } from '../../src/events/staff-idempotency.policy';
import { fixture, input } from './helpers/staff-called-removal-fixture';
import { sessionScenario } from './mutation-session-scenario';

let f = fixture();
function reset(options: Parameters<typeof fixture>[0] = {}, revoked = false) {
  f = fixture(options);
  sessionScenario(f.service, input.staffUserId, revoked ? 'revoked' : 'valid');
}
@Module({ controllers: [StaffCalledRemovalController], providers: [SessionAuthGuard, StaffEntryNoStoreGuard,
  { provide: AuthService, useValue: { authenticateBearerToken: async () => ({ userId: input.staffUserId,
    sessionId: '00000000-0000-4000-8000-000000000099', roles: ['staff'] }) } },
  { provide: CalledRemovalService, useValue: { removeAuthenticated: (...args: Parameters<CalledRemovalService['removeAuthenticated']>) => f.service.removeAuthenticated(...args) } },
  { provide: StaffIdempotencyPolicy, useValue: { expiresAt: () => new Date('2099-01-01') } },
] }) class HttpModule {}
let app: INestApplication;
before(async () => { app = await NestFactory.create(HttpModule, { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ProblemDetailsExceptionFilter()); await app.listen(0, '127.0.0.1'); });
after(async () => { await app?.close(); });
const id = '11111111-1111-4111-8111-111111111111';
const url = `/api/v1/staff/events/${id}/service-sessions/${id}/remove`;
const post = (path = url, body: object = {}) => supertest(app.getHttpServer()).post(path)
  .set('Authorization', 'Bearer synthetic-staff').set('Idempotency-Key', 'synthetic-key').send(body);

test('HTTP remove chamado: guard, UUID, chave, corpo vazio e contrato mínimo', async () => {
  reset();
  assert.equal((await supertest(app.getHttpServer()).post(url).send({})).status, 401);
  assert.equal((await supertest(app.getHttpServer()).post(url).set('Authorization', 'Bearer synthetic-staff').send({})).status, 400);
  assert.equal((await post(url.replace(id, 'invalid'))).status, 400);
  assert.equal((await post(url, { sessionId: id })).status, 400);
  const res = await post();
  assert.equal(res.status, 200); assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body.serviceSession.status, 'canceled');
  assert.equal(res.body.serviceSession.cancelReason, 'staff_queue_removed');
  assert.equal(res.body.participation.status, 'active');
  assert.equal(res.body.participation.currentQueueEntryId, null);
  assert.deepEqual(Object.keys(res.body).sort(), ['participation', 'queueEntry', 'serviceSession']);
});
test('HTTP recusa sessão revogada, falta de Staff e recurso ausente', async () => {
  reset({}, true); assert.equal((await post()).status, 401);
  reset({ missing: 'staff' }); assert.equal((await post()).status, 403);
  reset({ missing: 'target' }); assert.equal((await post()).status, 404);
  reset({ status: 'completed' }); assert.equal((await post()).status, 409);
});
test('HTTP auditoria falha: rollback e 500 sanitizado sem marcador privado', async () => {
  reset({ fail: 'audit' });
  const res = await post();
  assert.equal(res.status, 500); assert.equal(res.body.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE|audit_logs|idempotency_operations/);
  assert.equal(f.state.session, 'pending'); assert.equal(f.state.currentId, 'entry');
  assert.equal(f.state.reservation, 0); assert.equal(f.state.audit, 0);
});
