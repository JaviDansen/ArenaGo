const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');
const load = (path, resolve) => loadModule(path, resolve).exports;
const events = load('services/adminEventsService.js', require);
const api = load('services/adminEventSetupService.js', () => events);
const schedule = load('screens/admin/adminScheduleForm.js', require);
const forms = load('screens/admin/adminCreationForm.js', () => schedule);
const { bindStaffSession, createStaffSession } = load('screens/admin/adminStaffSession.js', name => {
  if (name.endsWith('/adminEventsService')) return events;
  if (name === '../../context/adminAccess') return loadModule('context/adminAccess.js', require).exports;
  if (name.endsWith('/adminEventSetupService')) return api;
  assert.equal(name, './adminCreationForm');
  return forms;
});
const id = n => 'abcdef01-0000-4000-8000-' + String(n).padStart(12, '0');
const eventId = id(1), email = 'staff@example.test';
const grant = { id: id(2), userId: id(3), eventId, role: 'staff', grantedAt: '2090-01-01T12:00:00Z', revokedAt: null };
const revoked = { ...grant, revokedAt: '2090-01-02T12:00:00Z' };

test('GET Staff valida escopo, identificadores, situação e duplicidade na resposta', async () => {
  const member = { grantId: grant.id, userId: grant.userId, name: 'Pessoa Staff', email, grantedAt: grant.grantedAt, eligible: false };
  const client = { get(path, options) {
    assert.equal(path, '/admin/events/' + eventId + '/staff');
    assert.equal(options.auth, true);
    return { eventId, items: [member] };
  } };
  const result = await api.readEventStaff(client, eventId);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [{ ...grant, name: member.name, email, eligible: false }]);
  for (const payload of [{ eventId: id(8), items: [] }, { eventId, items: [member, member] },
    { eventId, items: [member, { ...member, grantId: id(9) }] },
    { eventId, items: [{ ...member, grantId: 'inválido' }] }, { eventId, items: [{ ...member, eligible: 'false' }] }]) {
    await assert.rejects(api.readEventStaff({ get: () => payload }, eventId));
  }
});

function fixture(handler) {
  let active = true, sequence = 0;
  const writes = [], refreshes = [];
  const client = { post(path, body, options) {
    const call = { path, body: JSON.parse(JSON.stringify(body)), key: options.headers['Idempotency-Key'] };
    writes.push(call);
    assert.equal(options.retryOnUnauthorized, false);
    assert.equal(options.expectedStatus, path.endsWith('/grant') ? 201 : 200);
    return handler(call, writes.length);
  } };
  const store = createStaffSession(client, () => id(++sequence + 10), () => active);
  store.subscribe((event, refresh) => { if (refresh) refreshes.push(event); });
  return { store, writes, refreshes, end() { active = false; }, view: () => store.snapshot(eventId) };
}

test('valida o e-mail antes da escrita e preserva o destinatário informado fora do grant', async () => {
  const h = fixture(() => ({ grant }));
  for (const invalid of ['', 'abc', 'a'.repeat(252) + '@b.c']) {
    await assert.rejects(h.store.send(eventId, 'grant', invalid));
  }
  assert.equal(h.writes.length, 0);
  await h.store.send(eventId, 'grant', ' Staff@Example.Test ');
  assert.deepEqual(h.writes[0].body, { role: 'staff', eventId, email });
  assert.equal(h.view().grants[0].email, email);
  assert.deepEqual(h.refreshes, [eventId]);
  assert.equal(h.store.snapshot(id(8)).grants.length, 0);
});

test('vínculo consultado e inelegível pode ser revogado e recuperado com a mesma chave', async () => {
  const h = fixture((_call, count) => {
    if (count === 1) throw { outcomeUnknown: true };
    return { grant: revoked };
  });
  const listed = { ...grant, email, eligible: false };
  await h.store.revokeListed(id(8), listed);
  assert.equal(h.writes.length, 0);
  await h.store.revokeListed(eventId, listed);
  const [intent] = h.view().attempts;
  assert.equal(intent.status, 'unknown');
  assert.deepEqual(h.writes[0].body, { grantId: grant.id });
  await h.store.revokeListed(eventId, listed);
  assert.equal(h.writes.length, 1);
  await h.store.send(eventId, intent.kind, intent.target, intent);
  assert.deepEqual(h.writes[1], h.writes[0]);
  assert.equal(h.view().feedback[0].message, 'Revogação confirmada.');
});

test('somente um vínculo Staff confirmado do evento pode ser revogado', async () => {
  const h = fixture(call => ({ grant: call.path.endsWith('/grant') ? grant : revoked }));
  await h.store.send(eventId, 'revoke', grant.id);
  await h.store.send(eventId, 'grant', email);
  await h.store.send(id(8), 'revoke', grant.id);
  await h.store.send(eventId, 'revoke', id(7));
  assert.equal(h.writes.length, 1);
  await h.store.send(eventId, 'revoke', grant.id);
  assert.deepEqual(h.writes[1].body, { grantId: grant.id });
  assert.equal(h.view().grants.length, 0);
  assert.deepEqual(h.refreshes, [eventId, eventId]);
  for (const malformed of [{ ...grant, role: 'admin', eventId: null }, { ...grant, eventId: id(8) }, { ...grant, userId: 'x' }, revoked]) {
    const other = fixture(() => ({ grant: malformed }));
    await other.store.send(eventId, 'grant', email);
    assert.equal(other.view().grants.length, 0);
    assert.equal(other.view().attempts[0].status, 'unknown');
    await other.store.send(eventId, 'revoke', grant.id);
    assert.equal(other.writes.length, 1);
  }
});

for (const kind of ['grant', 'revoke']) {
  test(kind + ' conserva corpo e chave entre consumidores e serializa o retry explícito', async () => {
    let n = 0, finish;
    const h = fixture(call => {
      if (!call.path.endsWith('/' + kind)) return { grant };
      if (++n === 1) throw { status: 409, code: 'IDEMPOTENCY_IN_PROGRESS' };
      return new Promise(resolve => { finish = resolve; });
    });
    const target = kind === 'grant' ? email : grant.id;
    if (kind === 'revoke') await h.store.send(eventId, 'grant', email);
    await h.store.send(eventId, kind, target);
    const record = h.view().attempts[0];
    assert.equal(record.status, 'unknown');
    const unsubscribe = h.store.subscribe(() => {});
    unsubscribe();
    await h.store.send(eventId, kind, target);
    assert.equal(n, 1);
    const flight = h.store.send(eventId, kind, target, record);
    await h.store.send(eventId, kind, target, record);
    assert.equal(n, 2);
    assert.deepEqual(h.writes.at(-1), h.writes.at(-2));
    finish({ grant: kind === 'grant' ? grant : revoked });
    await flight;
    assert.equal(h.view().attempts.length, 0);
    assert.equal(h.view().grants.length, kind === 'grant' ? 1 : 0);
  });
}

test('um resultado incerto não bloqueia outro destinatário e conflito não gera chave nova', async () => {
  const h = fixture((call, n) => {
    if (n === 1) throw { outcomeUnknown: true };
    if (call.body.email === email) throw { status: 409, code: 'IDEMPOTENCY_KEY_REUSED' };
    return { grant };
  });
  await h.store.send(eventId, 'grant', email);
  await h.store.send(eventId, 'grant', 'outro@example.test');
  assert.equal(h.view().grants.length, 1);
  await h.store.send(eventId, 'grant', email, h.view().attempts[0]);
  assert.equal(h.view().attempts[0].status, 'conflict');
  await h.store.send(eventId, 'grant', email);
  assert.equal(h.writes.length, 3);
});

test('logout, mudança de identidade ou de cliente descarta conclusões antigas', async () => {
  let finish;
  const old = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = old.store.send(eventId, 'grant', email);
  old.end();
  const fresh = fixture(() => assert.fail('POST na nova sessão'));
  finish({ grant });
  await pending;
  assert.equal(old.view().grants.length, 0);
  assert.equal(fresh.view().grants.length, 0);
  assert.equal(fresh.view().attempts.length, 0);
  assert.equal(old.refreshes.length, 0);
});

test('uma resposta tardia do evento A não publica a concessão no evento B', async () => {
  let finish;
  const h = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.store.send(eventId, 'grant', email);
  const seen = [];
  const unsubscribe = h.store.subscribe(idChanged => { if (idChanged === id(8)) seen.push(h.store.snapshot(id(8))); });
  finish({ grant });
  await pending;
  assert.equal(h.view().grants.length, 1);
  assert.equal(h.store.snapshot(id(8)).grants.length, 0);
  assert.equal(seen.length, 0);
  unsubscribe();
});

test('revogação divergente mantém o comprovante e o acompanhamento da intenção', async () => {
  for (const result of [{ ...revoked, userId: id(9) }, { ...revoked, id: id(8) },
    { ...revoked, revokedAt: null }, { ...revoked, role: 'admin' }]) {
    const h = fixture((call, n) => ({ grant: n === 1 ? grant : result }));
    await h.store.send(eventId, 'grant', email);
    await h.store.send(eventId, 'revoke', grant.id);
    assert.equal(h.view().grants.length, 1);
    assert.equal(h.view().attempts[0].status, 'unknown');
    assert.deepEqual(h.refreshes, [eventId]);
  }
});

for (const [status, code] of [[404,'RESOURCE_NOT_FOUND'], [422,'ROLE_TARGET_INELIGIBLE'], [409,'ROLE_ALREADY_GRANTED'],
  [401,'SESSION_REVOKED'], [401,'SESSION_EXPIRED'], [401,'INVALID_SESSION'], [401,'ACCOUNT_DEACTIVATED'],
  [401,'ADMIN_2FA_REQUIRED'], [403,'ADMIN_REQUIRED'], [403,'ADMIN_EMAIL_UNVERIFIED']]) {
  test(code + ' não produz concessão nem revogação por e-mail', async () => {
    const h = fixture(() => { throw { status, code }; });
    await h.store.send(eventId, 'grant', email);
    assert.equal(h.view().grants.length, 0);
    assert.equal(h.view().attempts.length, 0);
    assert.ok(h.view().denied || h.view().feedback[0]?.message);
    assert.equal(Boolean(h.view().denied), status === 401 || status === 403);
    await h.store.send(eventId, 'revoke', email);
    assert.equal(h.writes.length, 1);
  });
}

for (const cause of ['evento indisponível', 'vínculo indisponível']) {
  for (const previouslyUncertain of [false, true]) {
    test('404 de revogação preserva histórico para ' + cause + (previouslyUncertain ? ' após timeout' : ''), async () => {
      const other = { ...grant, id: id(7), userId: id(8) };
      let revocations = 0;
      const h = fixture(call => {
        if (call.path.endsWith('/grant')) return { grant: call.body.email === email ? grant : other };
        revocations++;
        if (previouslyUncertain && revocations === 1) throw { status: null, code: 'REQUEST_TIMEOUT' };
        if (revocations <= (previouslyUncertain ? 2 : 1)) throw { status: 404, code: 'RESOURCE_NOT_FOUND' };
        return { grant: revoked };
      });
      await h.store.send(eventId, 'grant', email);
      await h.store.send(eventId, 'grant', 'outro@example.test');
      await h.store.send(eventId, 'revoke', grant.id);
      const first = h.view().attempts[0];
      if (previouslyUncertain) await h.store.send(eventId, 'revoke', grant.id, first);
      assert.equal(h.view().grants.find(item => item.id === grant.id).unconfirmed, true);
      assert.equal(h.view().grants.find(item => item.id === other.id).unconfirmed, undefined);
      assert.equal(h.view().attempts[0].key, first.key);
      assert.equal(h.view().attempts[0].status, previouslyUncertain ? 'unknown' : 'unavailable');
      const notice = h.view().feedback.find(item => item.kind === 'revoke');
      assert.match(notice.message, /vínculo ou o evento/);
      assert.equal(notice.tone, 'warning');
      const count = h.writes.length;
      await h.store.send(eventId, 'revoke', grant.id);
      assert.equal(h.writes.length, count);
      if (previouslyUncertain) {
        await h.store.send(eventId, 'revoke', grant.id, h.view().attempts[0]);
        assert.deepEqual(h.writes.at(-1), h.writes.at(-2));
        assert.equal(h.view().grants.find(item => item.id === grant.id), undefined);
        assert.equal(h.view().feedback.find(item => item.kind === 'revoke').tone, 'success');
      }
    });
  }
}

test('duplo envio reserva uma chave e preserva o feedback de vínculos já confirmados', async () => {
  let release;
  let count = 0;
  const other = { ...grant, id: id(7), userId: id(8) };
  const next = { ...grant, id: id(9) };
  const h = fixture(call => {
    if (call.body.email !== email) return { grant: other };
    if (++count === 1) return { grant };
    return new Promise(resolve => { release = resolve; });
  });
  await h.store.send(eventId, 'grant', email);
  const flight = h.store.send(eventId, 'grant', email);
  await h.store.send(eventId, 'grant', ' Staff@Example.Test ');
  await h.store.send(eventId, 'grant', 'outro@example.test');
  assert.equal(h.writes.length, 3);
  assert.equal(h.view().attempts[0].status, 'sending');
  assert.deepEqual(Array.from(h.view().feedback, notice => notice.grantId), [grant.id, other.id]);
  release({ grant: next });
  await flight;
  assert.deepEqual(Array.from(h.view().feedback, notice => notice.grantId), [grant.id, other.id, next.id]);
});

function boundSession(post) {
  const user = { id: id(90), sessionId: id(91), emailVerified: true, roles: ['admin'] };
  let auth = { isAuthenticated: true, identityStatus: 'verified', sessionStatus: 'authenticated', user };
  let epoch = 1, sequence = 0, revision = 0;
  const manager = {
    client: { post },
    getSnapshot: () => auth,
    getSessionEpoch: () => epoch,
    getIdentityRevision: () => revision,
    isIdentityVerified: () => auth.identityStatus === 'verified',
  };
  const binding = bindStaffSession(manager, () => id(++sequence + 30));
  return { binding, manager, user, change(patch) { auth = { ...auth, ...patch }; revision++; binding.sync(); },
    advanceEpoch() { epoch++; binding.sync(); } };
}

test('conclusão durante revalidação permanece inacessível até confirmar a mesma sessão', async () => {
  let finish, posts = 0;
  const h = boundSession(() => { posts++; return new Promise(resolve => { finish = resolve; }); });
  const original = h.binding.get();
  const write = original.send(eventId, 'grant', email);
  h.change({ identityStatus: 'checking' });
  assert.equal(h.binding.get(), null);
  assert.equal(original.snapshot(eventId).attempts.length, 0);
  await original.send(eventId, 'grant', 'outro@example.test');
  finish({ grant });
  await write;
  assert.equal(original.snapshot(eventId).grants.length, 0);
  assert.equal(posts, 1);
  h.change({ identityStatus: 'verified' });
  assert.equal(h.binding.get(), original);
  assert.equal(original.snapshot(eventId).grants[0].id, grant.id);
});

for (const change of ['cliente', 'papel', 'geração', 'sessionId']) {
  test('troca de ' + change + ' invalida um registro suspenso', async () => {
    const h = boundSession(() => ({ grant }));
    const original = h.binding.get();
    await original.send(eventId, 'grant', email);
    h.change({ identityStatus: 'checking' });
    if (change === 'cliente') { h.manager.client = { post: () => ({ grant }) }; h.binding.sync(); }
    if (change === 'papel') h.change({ user: { ...h.user, roles: ['staff'] } });
    if (change === 'geração') h.advanceEpoch();
    const user = change === 'sessionId' ? { ...h.user, sessionId: id(92) } : h.user;
    h.change({ identityStatus: 'verified', user });
    assert.notEqual(h.binding.get(), original);
    assert.equal(original.snapshot(eventId).grants.length, 0);
    assert.equal(h.binding.get().snapshot(eventId).grants.length, 0);
  });
}

for (const outcome of ['replay 200', '404 no retry']) {
  test('a revogação do vínculo antigo preserva a concessão confirmada posterior para o mesmo e-mail: ' + outcome, async () => {
    const replacement = { ...grant, id: id(9) };
    let grants = 0, revokes = 0;
    const h = fixture(call => {
      if (call.path.endsWith('/grant')) return { grant: ++grants === 1 ? grant : replacement };
      assert.equal(call.body.grantId, grant.id);
      if (++revokes === 1) throw { status: null, code: 'REQUEST_TIMEOUT' };
      if (outcome === '404 no retry') throw { status: 404, code: 'RESOURCE_NOT_FOUND' };
      return { grant: revoked };
    });

    await h.store.send(eventId, 'grant', email);
    await h.store.send(eventId, 'revoke', grant.id);
    const uncertain = h.view().attempts[0];
    await h.store.send(eventId, 'grant', email);
    const observed = h.view().feedback.find(notice => notice.grantId === replacement.id);
    assert.equal(observed?.message, 'Concessão confirmada.');
    assert.equal(observed.eventId, eventId);
    assert.equal(observed.kind, 'grant');

    await h.store.send(eventId, 'revoke', grant.id, uncertain);
    assert.equal(revokes, 2);
    const requests = h.writes.filter(entry => entry.path.endsWith('/revoke'));
    assert.deepEqual(requests[0], requests[1]);
    assert.equal(h.view().feedback.find(notice => notice.grantId === replacement.id), observed);
    const resolved = h.view().feedback.find(notice => notice.kind === 'revoke' && notice.grantId === grant.id);
    assert.equal(resolved.intentKey, uncertain.key);
    assert.equal(resolved.retry, true);
    assert.equal(resolved.tone, outcome === 'replay 200' ? 'success' : 'warning');
    assert.equal(h.view().grants.find(item => item.id === replacement.id).unconfirmed, undefined);
    assert.equal(h.view().feedback.filter(notice => notice.id === observed.id).length, 1);
  });
}
