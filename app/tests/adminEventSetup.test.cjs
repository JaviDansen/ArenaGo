const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const events = loadModule('services/adminEventsService.js', require).exports;
const schedule = loadModule('screens/admin/adminScheduleForm.js', require).exports;
const forms = loadModule('screens/admin/adminCreationForm.js', () => schedule).exports;
const setup = loadModule('services/adminEventSetupService.js', () => events).exports;
const shared = loadModule('screens/admin/adminStructureIntents.js', () => setup).exports;
const { createEventSetup } = loadModule('screens/admin/adminCreationFlow.js', name => {
  if (name === './adminStructureIntents') return shared;
  if (name.endsWith('/adminEventsService')) return events;
  if (name.endsWith('/adminEventSetupService')) return setup;
  assert.equal(name, './adminCreationForm');
  return forms;
}).exports;

const id = n => 'abcdef00-0000-4000-8000-' + String(n).padStart(12, '0');
const eventId = id(1), path = '/admin/events/' + eventId;
const form = { name: ' Encontro ', accessCode: ' abc-123 ', timezone: 'America/Fortaleza',
  start: { date: '01/12/2090', time: '19:00' }, end: { date: '01/12/2090', time: '21:00' }, margin: '30', externalQueueEnabled: false };
const event = { ...forms.creationBody(form), id: eventId, effectivePhase: 'scheduled', readiness: { ready: false } };
const experience = { id: id(2), eventId, name: 'Oficina' };
const station = { id: id(3), experienceId: experience.id, label: 'Mesa A', availability: 'available' };
const grant = { id: id(4), userId: id(5), role: 'staff', eventId, grantedAt: '2090-11-01T12:00:00Z', revokedAt: null };
const plain = value => JSON.parse(JSON.stringify(value));
function fixture({ resume = false, post, get, now, isCurrent = () => true } = {}) {
  const writes = [], reads = [];
  const db = { items: [], staff: false };
  const client = {
    async get(url, options) {
      assert.equal(options.auth, true);
      reads.push(url);
      if (get) { const result = await get(url); if (result !== undefined) return result; }
      if (url === path) return { event };
      if (url === path + '/experiences') return { eventId, items: db.items };
      assert.equal(url, path + '/readiness');
      const available = db.items.some(item => item.stations.some(row => row.availability === 'available'));
      return { eventId, effectivePhase: 'scheduled', statusStored: 'scheduled', acceptingNewParticipations: false,
        ready: available && db.staff, missing: [...(available ? [] : ['EXPERIENCE_WITH_AVAILABLE_STATION']),
          ...(db.staff ? [] : ['VERIFIED_ACTIVE_STAFF'])], checks: { nameAndAccessCode: true, validScheduleAndTimezone: true,
          externalQueueConfigured: true, hasExperienceWithAvailableStation: available, hasVerifiedActiveStaff: db.staff } };
    },
    async post(url, body, options) {
      writes.push({ url, body: plain(body), key: options.headers['Idempotency-Key'] });
      assert.equal(options.auth, true);
      assert.equal(options.retryOnUnauthorized, false);
      assert.equal(options.outcomeUnknownOnNetworkError, true);
      return post(url, body, db);
    },
  };
  let sequence = 0;
  const sessionIntents = new Map();
  function open(selected = resume ? eventId : null, structureIntents = sessionIntents) {
    const flow = createEventSetup({ client, eventId: selected, isCurrent, now, structureIntents, newKey: () => id(++sequence) });
    const dispose = flow.mount(() => {});
    async function settled() {
      for (let i = 0; i < 20; i++) {
        if (!flow.snapshot().loading && !flow.snapshot().busy) return;
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.fail('Leitura ou escrita não terminou');
    }
    return { flow, reads, writes, dispose, settled, open,
      next: () => flow.next(flow.snapshot().stepVersion),
      create: () => flow.confirmCreate(flow.snapshot().stepVersion) };
  }
  return open();
}

test('wizard recupera o cadastro da gestão e preserva sua chave sem reenviar durante a leitura', async () => {
  const h = fixture({ post: (url, body, db) => {
    assert.equal(url, path + '/experiences');
    db.items = [{ ...experience, stations: [] }];
    return { experience };
  } });
  const record = { eventId, kind: 'addExperience', value: experience.name, key: id(9), attempts: 1 };
  record.id = shared.structureIntentId(record);
  const pending = new Map([[record.id, record]]);
  const page = h.open(eventId, pending);
  await page.settled();
  page.flow.editSetup({ experience: experience.name });
  await page.flow.run('experience');
  assert.equal(page.writes.length, 0);
  assert.equal(pending.get(record.id).key, id(9));
  assert.match(page.flow.snapshot().message, /ficou sem confirmação/);
  await page.settled();
  await page.flow.retry();
  assert.deepEqual(page.writes, [{ url: path + '/experiences', body: { name: experience.name }, key: id(9) }]);
  assert.equal(pending.size, 0);
  page.dispose();
  h.dispose();
});

test('identidade aplica limites por caractere, valida ASCII antes da caixa e normaliza espaços externos', () => {
  for (const name of ['', 'a'.repeat(181), 'x\nxx', 'x\ud800']) assert.throws(() => forms.eventIdentity({ ...form, name }));
  assert.equal(forms.configurationName('🎮'.repeat(180)), '🎮'.repeat(180));
  for (const accessCode of ['abc', 'ßABC', '-ABC', 'ABC--D', 'ABC-', 'a'.repeat(65)]) {
    assert.throws(() => forms.eventIdentity({ ...form, accessCode }));
  }
  assert.deepEqual(plain(forms.eventIdentity(form)), { name: 'Encontro', accessCode: 'ABC-123' });
});

test('programação usa fuso do evento, virada do dia, margens extremas e configuração explícita da fila', () => {
  for (const [margin, deadline, externalQueueEnabled] of [['0', '00:00', false], ['60', '01:00', true]]) {
    const body = forms.creationBody({ ...form, margin, externalQueueEnabled });
    assert.equal(body.startsAt, '2090-12-01T22:00:00.000Z');
    assert.equal(body.operationalDeadlineAt, '2090-12-02T' + deadline + ':00.000Z');
    assert.equal(body.externalQueueEnabled, externalQueueEnabled);
  }
  for (const patch of [{ margin: '61' }, { margin: '-1' }, { end: form.start }, { timezone: 'Fuso/Inexistente' },
    { timezone: 'America/New_York', start: { date: '08/03/2026', time: '02:30' } },
    { timezone: 'America/New_York', start: { date: '01/11/2026', time: '01:30' } }]) {
    assert.throws(() => forms.creationBody({ ...form, ...patch }));
  }
});

test('criação em voo, timeout e retry explícito usam uma única intenção e bloqueiam edição e segundo POST na reentrada', async () => {
  let reject, attempts = 0;
  const h = fixture({ post: () => ++attempts === 1 ? new Promise((_, no) => { reject = no; }) : { event } });
  h.flow.editForm(form);
  h.next();
  assert.equal(h.writes.length, 0);
  const first = h.create();
  h.create();
  reject({ outcomeUnknown: true });
  await first;
  assert.equal(h.flow.snapshot().uncertain, true);
  h.flow.editForm({ accessCode: 'DIFFERENT' });
  h.create();
  await h.flow.refresh();
  assert.equal(h.writes.length, 1);
  await h.flow.retry();
  assert.equal(h.writes.length, 2);
  assert.deepEqual(h.writes[0], h.writes[1]);
  assert.equal(h.flow.snapshot().eventId, eventId);
  h.flow.step(1); await h.settled();
  h.flow.editForm({ name: 'Alterado' });
  h.next(); await h.settled();
  h.next(); await h.settled();
  assert.equal(h.flow.snapshot().event.name, event.name);
  assert.equal(h.writes.length, 2);
});

test('criação verifica o relógio no envio e aceita um início já passado com término futuro', async () => {
  const starts = Date.parse(event.startsAt), ends = Date.parse(event.officialEndsAt);
  const cases = [
    [ends + 60_000, false], [ends, false], [starts + 60_000, true], [starts - 60_000, true],
  ];
  for (const [at, permitted] of cases) {
    let clock = starts - 60_000;
    const h = fixture({ now: () => clock, post: () => ({ event }) });
    h.flow.editForm(form);
    h.next();
    clock = at;
    await h.create();
    assert.equal(h.writes.length, permitted ? 1 : 0);
    if (permitted) assert.equal(h.flow.snapshot().eventId, eventId);
    else assert.match(h.flow.snapshot().message, /término oficial deve ser futuro/);
    h.dispose();
  }
});

test('retry da criação após alcançar o término mantém o resultado anterior incerto', async () => {
  let clock = Date.parse(event.startsAt);
  const h = fixture({ now: () => clock, post: () => { throw { outcomeUnknown: true }; } });
  h.flow.editForm(form);
  h.next();
  await h.create();
  clock = Date.parse(event.officialEndsAt);
  await h.flow.retry();
  assert.equal(h.writes.length, 1);
  assert.equal(h.flow.snapshot().uncertain, true);
  assert.match(h.flow.snapshot().message, /resultado do envio anterior continua sem confirmação/);
});

test('código histórico em conflito preserva formulário e permite corrigir a intenção rejeitada', async () => {
  const h = fixture({ post: () => { throw { status: 409, code: 'ACCESS_CODE_ALREADY_USED' }; } });
  h.flow.editForm(form); h.next(); await h.create();
  assert.match(h.flow.snapshot().message, /código já foi reservado/);
  assert.equal(h.flow.snapshot().eventId, null);
  h.flow.back(); h.flow.editForm({ accessCode: 'OUTRO' }); h.next(); await h.create();
  assert.notEqual(h.writes[0].key, h.writes[1].key);
  assert.equal(h.writes[1].body.accessCode, 'OUTRO');
});

test('persistência incremental, falha parcial, concessão e revogação atualizam os checks oficiais do mesmo evento', async () => {
  let rejectStation = true, rejectStaff = true;
  const h = fixture({ resume: true, post: (url, body, db) => {
    if (url === path + '/experiences') {
      assert.deepEqual(plain(body), { name: experience.name });
      db.items = [{ ...experience, stations: [] }];
      return { experience };
    }
    if (url === path + '/experiences/' + experience.id + '/stations') {
      assert.deepEqual(plain(body), { label: station.label });
      if (rejectStation) throw { status: 400 };
      db.items = [{ ...experience, stations: [station] }];
      return { station };
    }
    if (url === '/admin/roles/grant') {
      assert.deepEqual(plain(body), { role: 'staff', eventId, email: 'equipe@example.test' });
      if (rejectStaff) throw { status: 422, code: 'ROLE_TARGET_INELIGIBLE' };
      db.staff = true;
      return { grant };
    }
    assert.equal(url, '/admin/roles/revoke');
    assert.deepEqual(plain(body), { grantId: grant.id });
    db.staff = false;
    return { grant: { ...grant, revokedAt: '2090-11-02T00:00:00Z' } };
  } });
  await h.settled();
  h.flow.editSetup({ experience: experience.name });
  await h.flow.run('experience');
  h.flow.editSetup({ parent: experience.id, station: station.label });
  await h.flow.run('station');
  assert.equal(h.flow.snapshot().items[0].stations.length, 0);
  assert.equal(h.flow.snapshot().items[0].id, experience.id);
  rejectStation = false;
  await h.flow.run('station');
  assert.equal(h.flow.snapshot().items[0].stations[0].id, station.id);
  assert.equal(h.flow.snapshot().readiness.checks.hasExperienceWithAvailableStation, true);
  h.next(); await h.settled();
  h.flow.editSetup({ email: ' Equipe@example.test ' });
  await h.flow.run('grant');
  assert.match(h.flow.snapshot().message, /verificado/);
  assert.equal(h.flow.snapshot().grants.length, 0);
  rejectStaff = false; await h.flow.run('grant');
  assert.equal(h.flow.snapshot().grants[0].id, grant.id);
  h.next(); await h.settled();
  assert.equal(h.flow.snapshot().readiness.ready, true);
  assert.equal(h.flow.snapshot().readiness.acceptingNewParticipations, false);
  h.next(); await h.settled();
  assert.equal(h.flow.snapshot().step, 6);
  h.flow.step(4); await h.settled();
  await h.flow.run('revoke', grant.id);
  assert.equal(h.flow.snapshot().grants.length, 0);
  assert.equal(h.flow.snapshot().readiness.ready, false);
  assert.equal(h.writes.filter(write => write.url === path + '/experiences').length, 1);
  assert.equal(new Set(h.writes.map(write => write.key)).size, h.writes.length);
});

test('UUIDs de outro evento ou experiência e concessões globais não são aceitos', async () => {
  await assert.rejects(setup.readEventStructure({ get: () => ({ eventId, items: [{ ...experience, eventId: id(8), stations: [] }] }) }, eventId));
  await assert.rejects(setup.addEventStation({ post: () => ({ station: { ...station, experienceId: id(8) } }) },
    eventId, experience.id, station.label, id(9)));
  let sent = 0;
  await assert.rejects(setup.revokeEventStaff({ post: () => { sent++; } }, eventId, { ...grant, role: 'admin' }, id(9)));
  assert.equal(sent, 0);
  await assert.rejects(setup.grantEventStaff({ post: () => ({ grant: { ...grant, eventId: id(8) } }) }, eventId, 'staff@example.test', id(9)));
});

test('404 remove só o comprovante revogado e reconsulta a prontidão, com 401/403 tratados como bloqueio', async () => {
  for (const status of [404, 401, 403]) {
    const other = { ...grant, id: id(6), userId: id(7) };
    const h = fixture({ resume: true, post: (url, body, db) => {
      if (url === '/admin/roles/grant') {
        db.staff = true;
        return { grant: body.email === 'primeiro@example.test' ? grant : other };
      }
      assert.equal(url, '/admin/roles/revoke');
      if (body.grantId === grant.id) throw { status, code: 'RESOURCE_NOT_FOUND' };
      assert.equal(body.grantId, other.id);
      db.staff = false;
      return { grant: { ...other, revokedAt: event.startsAt } };
    } });
    await h.settled();
    h.next();
    await h.settled();
    for (const email of ['primeiro@example.test', 'segundo@example.test']) {
      h.flow.editSetup({ email });
      await h.flow.run('grant');
    }
    assert.equal(h.flow.snapshot().grants.length, 2);
    const readsBefore = h.reads.filter(url => url.endsWith('/readiness')).length;
    await h.flow.run('revoke', grant.id);
    if (status === 404) {
      assert.deepEqual(plain(h.flow.snapshot().grants.map(item => item.id)), [other.id]);
      assert.equal(h.reads.filter(url => url.endsWith('/readiness')).length, readsBefore + 1);
      assert.match(h.flow.snapshot().message, /vínculo Staff não está mais disponível/);
      await h.flow.run('revoke', other.id);
      assert.equal(h.flow.snapshot().grants.length, 0);
    } else {
      assert.equal(h.flow.snapshot().blocked, true);
      assert.equal(h.flow.snapshot().event, null);
      assert.equal(h.flow.snapshot().grants.length, 0);
      assert.equal(h.reads.filter(url => url.endsWith('/readiness')).length, readsBefore);
    }
    h.dispose();
  }
});

for (const kind of ['experience', 'station']) {
  test(`recupera a intenção de ${kind} na mesma sessão e repete apenas com confirmação explícita`, async () => {
    let first = true, allowRead = true, unblock;
    const route = kind === 'experience' ? path + '/experiences' : path + '/experiences/' + experience.id + '/stations';
    const h = fixture({ resume: true, get: async url => {
      if (!allowRead && url === path + '/experiences') await new Promise(resolve => { unblock = resolve; });
    }, post: (url, body, db) => {
      if (kind === 'station' && url === path + '/experiences') {
        db.items = [{ ...experience, stations: [] }];
        return { experience };
      }
      assert.equal(url, route);
      assert.deepEqual(plain(body), kind === 'experience' ? { name: experience.name } : { label: station.label });
      if (first) {
        first = false;
        db.items = [{ ...experience, stations: kind === 'station' ? [station] : [] }];
        throw { outcomeUnknown: true };
      }
      return kind === 'experience' ? { experience } : { station };
    } });
    await h.settled();
    h.flow.editSetup({ experience: experience.name });
    if (kind === 'station') {
      await h.flow.run('experience');
      h.flow.editSetup({ parent: experience.id, station: station.label });
    }
    await h.flow.run(kind);
    assert.equal(h.flow.snapshot().uncertain, true);
    h.dispose();

    const writesBefore = h.writes.length;
    const other = h.open(eventId, new Map());
    await other.settled();
    assert.equal(other.flow.snapshot().uncertain, false);
    assert.equal(other.flow.snapshot().items[0].id, experience.id);
    other.dispose();
    allowRead = false;
    const reopened = h.open(eventId);
    assert.equal(reopened.flow.snapshot().uncertain, true);
    await reopened.flow.retry();
    assert.equal(h.writes.length, writesBefore);
    allowRead = true;
    unblock();
    await reopened.settled();
    const originals = reopened.flow.snapshot().items;
    assert.equal(originals.length, 1);
    assert.equal(originals[0].stations.length, kind === 'station' ? 1 : 0);
    reopened.flow.editSetup({ experience: experience.name, station: station.label, parent: experience.id });
    await reopened.flow.run(kind);
    await reopened.flow.refresh();
    assert.equal(h.writes.length, writesBefore);
    await reopened.flow.retry();
    assert.equal(h.writes.length, writesBefore + 1);
    assert.deepEqual(h.writes.at(-1), h.writes.at(-2));
    reopened.dispose();
    const clean = h.open(eventId);
    await clean.settled();
    assert.equal(clean.flow.snapshot().uncertain, false);
    clean.dispose();
  });
}

test('encerrar a confirmação de estrutura libera uma nova ação explícita sem afirmar que o cadastro falhou', async () => {
  const h = fixture({ resume: true, post: () => { throw { outcomeUnknown: true }; } });
  await h.settled();
  h.flow.editSetup({ experience: experience.name });
  await h.flow.run('experience');
  h.flow.discardStructureIntent();
  assert.equal(h.writes.length, 1);
  assert.equal(h.flow.snapshot().uncertain, false);
  assert.match(h.flow.snapshot().message, /cadastro anterior ainda pode ter sido salvo/);
  h.dispose();
  const reopened = h.open(eventId);
  await reopened.settled();
  assert.equal(reopened.flow.snapshot().uncertain, false);
  assert.equal(h.writes.length, 1);
  reopened.flow.editSetup({ experience: 'Outra oficina' });
  await reopened.flow.run('experience');
  assert.notEqual(h.writes[1].key, h.writes[0].key);
  reopened.dispose();
});

test('falha de prontidão impede confirmação e 403 suprime dados até nova sessão', async () => {
  let status = 500;
  const h = fixture({ resume: true, get: url => { if (url.endsWith('/readiness')) throw { status }; } });
  await h.settled();
  assert.ok(h.flow.snapshot().readError);
  h.flow.step(6);
  assert.equal(h.flow.snapshot().step, 3);
  status = 403; await h.flow.refresh();
  assert.equal(h.flow.snapshot().blocked, true);
  assert.equal(h.flow.snapshot().event, null);
  assert.equal(h.flow.snapshot().items.length, 0);
});

test('logout ou troca de sessão durante o POST descarta a resposta e não dispara novas leituras', async () => {
  let owned = true, release;
  const h = fixture({ isCurrent: () => owned, post: () => new Promise(resolve => { release = resolve; }) });
  h.flow.editForm(form); h.next();
  const pending = h.create();
  owned = false; h.dispose(); release({ event }); await pending;
  assert.equal(h.flow.snapshot().eventId, null);
  assert.equal(h.reads.length, 0);
});

test('401 na escrita bloqueia o formulário e 404 na retomada oferece nova leitura sem criar outro evento', async () => {
  const denied = fixture({ post: () => { throw { status: 401 }; } });
  denied.flow.editForm(form); denied.next(); await denied.create();
  assert.equal(denied.flow.snapshot().blocked, true);
  assert.equal(denied.flow.snapshot().form.name, '');
  await denied.flow.retry();
  assert.equal(denied.writes.length, 1);
  let missing = true;
  const resumed = fixture({ resume: true, get: () => { if (missing) throw { status: 404 }; } });
  await resumed.settled();
  assert.equal(resumed.flow.snapshot().event, null);
  assert.match(resumed.flow.snapshot().readError, /não encontrado/);
  missing = false; await resumed.flow.refresh();
  assert.equal(resumed.flow.snapshot().event.id, eventId);
  assert.equal(resumed.writes.length, 0);
});
