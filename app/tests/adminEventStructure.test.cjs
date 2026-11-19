const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const events = loadModule('services/adminEventsService.js', require).exports;
const setup = loadModule('services/adminEventSetupService.js', () => events).exports;
const schedule = loadModule('screens/admin/adminScheduleForm.js', require).exports;
const forms = loadModule('screens/admin/adminCreationForm.js', () => schedule).exports;
const shared = loadModule('screens/admin/adminStructureIntents.js', () => setup).exports;
const { createStructureFlow } = loadModule('screens/admin/adminStructureFlow.js', name => {
  if (name === './adminStructureIntents') return shared;
  if (name.endsWith('/adminEventsService')) return events;
  if (name.endsWith('/adminEventSetupService')) return setup;
  assert.equal(name, './adminCreationForm');
  return forms;
}).exports;

const id = n => 'abcdef00-0000-4000-8000-' + String(n).padStart(12, '0');
const eventId = id(1), groupId = id(2), stationId = id(3);
const path = '/admin/events/' + eventId, collection = path + '/experiences';
const groupPath = collection + '/' + groupId;
const stationPath = groupPath + '/stations/' + stationId;
const availabilityPath = '/staff/events/' + eventId + '/stations/' + stationId + '/availability';
const group = (stations = []) => ({ id: groupId, eventId, name: 'Oficina', stations });
const station = () => ({ id: stationId, experienceId: groupId, label: 'Mesa', availability: 'available', pendingServiceSessionId: null });
const copy = value => JSON.parse(JSON.stringify(value));
const change = (kind, value) => ({ kind, value, experienceId: groupId, stationId });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(predicate) {
  for (let attempt = 0; attempt < 16; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('O estado esperado não foi publicado.');
}

function fixture(items = [], selected = eventId) {
  const base = '/admin/events/' + selected;
  const db = { items, eligibleStaff: true, phase: 'open' };
  const reads = [], writes = [], intents = new Map();
  let keys = 0;
  const client = {
    async get(url, options) {
      reads.push(url);
      assert.equal(options.auth, true);
      if (db.read) {
        const override = await db.read(url);
        if (override !== undefined) return override;
      }
      const available = db.items.some(item => item.stations.some(row => row.availability === 'available'));
      const ready = available && db.eligibleStaff;
      if (url === base) return { event: { id: selected, name: 'Evento ' + selected, effectivePhase: db.phase,
        timezone: 'America/Fortaleza', startsAt: '2026-10-01T10:00:00Z', officialEndsAt: '2026-10-01T20:00:00Z',
        readiness: { ready } } };
      if (url === base + '/experiences') return { eventId: selected, items: copy(db.items) };
      assert.equal(url, base + '/readiness');
      return { eventId: selected, statusStored: db.phase, effectivePhase: db.phase, ready, acceptingNewParticipations: false,
        missing: [...(!available ? ['EXPERIENCE_WITH_AVAILABLE_STATION'] : []), ...(!db.eligibleStaff ? ['VERIFIED_ACTIVE_STAFF'] : [])],
        checks: { nameAndAccessCode: true, validScheduleAndTimezone: true, externalQueueConfigured: true,
          hasExperienceWithAvailableStation: available, hasVerifiedActiveStaff: db.eligibleStaff } };
    },
  };
  for (const method of ['post', 'patch']) client[method] = async (url, body, options) => {
    writes.push({ method, url, body: copy(body), key: options.headers?.['Idempotency-Key'] });
    assert.equal(options.auth, true);
    assert.equal(options.retryOnUnauthorized, false);
    assert.equal(options.outcomeUnknownOnNetworkError, true);
    return db.write(body);
  };
  function open(isCurrent = () => true, selectedId = selected) {
    const flow = createStructureFlow({ client, eventId: selectedId, intents, newKey: () => id(++keys), isCurrent });
    const published = [];
    const dispose = flow.mount(state => published.push(state));
    return { flow, dispose, published, ready: () => until(() => !flow.snapshot().loading) };
  }
  return { db, client, reads, writes, intents, open };
}

test('leitura confirma evento, grupos vazios, vínculos, disponibilidade e chamada pendente', async () => {
  const h = fixture(), page = h.open();
  h.db.eligibleStaff = false;
  await page.ready();
  assert.equal(page.flow.snapshot().data.items.length, 0);
  h.db.items = [group(), { ...group(), id: id(4), stations: [
    { ...station(), experienceId: id(4), pendingServiceSessionId: id(6) },
    { ...station(), id: id(5), experienceId: id(4), availability: 'unavailable' },
  ] }];
  await page.flow.refresh();
  const data = page.flow.snapshot().data;
  assert.equal(data.event.id, eventId);
  assert.deepEqual(copy(data.items), h.db.items);
  assert.equal(data.readiness.ready, false);
  assert.deepEqual(h.reads.slice(-3), [path, collection, path + '/readiness']);
  for (const malformed of [{ eventId: id(9), items: [] }, { eventId, items: [group([{ ...station(), experienceId: id(4) }])] },
    { eventId, items: [group([{ ...station(), pendingServiceSessionId: 'inválido' }])] }]) {
    h.db.read = url => url === collection ? malformed : undefined;
    await page.flow.refresh();
    assert.equal(page.flow.snapshot().data, null);
  }
  page.dispose();
});

test('POST de experiência valida caracteres, normaliza o corpo e exige confirmação da leitura', async () => {
  const h = fixture(), page = h.open();
  await page.ready();
  for (const value of [' ', '\ud800', 'a\nb', '🎮'.repeat(161)]) {
    await page.flow.save({ kind: 'addExperience', value });
    assert.match(page.flow.snapshot().message, /160/);
  }
  assert.equal(h.writes.length, 0);
  const name = '🎮'.repeat(160);
  h.db.write = body => {
    const experience = { ...group(), name: body.name };
    h.db.items.push(experience);
    return { experience };
  };
  await page.flow.save({ kind: 'addExperience', value: ' ' + name + ' ' });
  assert.deepEqual(h.writes, [{ method: 'post', url: collection, body: { name }, key: id(1) }]);
  assert.equal(page.flow.snapshot().data.items[0].id, groupId);
  assert.match(page.flow.snapshot().message, /confirmado/);
  page.dispose();
});

test('duplo toque, timeout, remount e replay explícito mantêm chave e corpo', async () => {
  const h = fixture(), first = h.open();
  await first.ready();
  const delay = deferred(), command = { kind: 'addExperience', value: 'Oficina' };
  h.db.write = () => delay.promise;
  const writing = first.flow.save(command);
  await first.flow.save(command);
  first.dispose();
  const next = h.open();
  delay.reject({ outcomeUnknown: true });
  await writing;
  await next.ready();
  assert.equal(next.flow.snapshot().pending[0].kind, command.kind);
  await next.flow.refresh();
  await next.flow.save(command);
  assert.equal(h.writes.length, 1);
  h.db.write = () => { h.db.items = [group()]; return { experience: group() }; };
  await next.flow.retry(next.flow.snapshot().pending[0]);
  assert.equal(h.writes.length, 2);
  assert.deepEqual(h.writes[0], h.writes[1]);
  assert.equal(next.flow.snapshot().pending.length, 0);
  next.dispose();
});

test('histórico bloqueia criação e renomeações, mas cadastro de estação usa apenas a coleção da experiência', async () => {
  const h = fixture([group([station()])]), page = h.open();
  await page.ready();
  h.db.write = () => { throw { status: 409, code: 'EVENT_CONFIGURATION_LOCKED' }; };
  for (const kind of ['addExperience', 'renameExperience', 'renameStation']) {
    await page.flow.save(change(kind, 'Alterado'));
    assert.match(page.flow.snapshot().message, /histórico/);
    assert.deepEqual(copy(page.flow.snapshot().data.items), [group([station()])]);
  }
  const label = '🎮'.repeat(120);
  await page.flow.save(change('addStation', label + 'X'));
  assert.equal(h.writes.length, 3);
  h.db.write = () => {
    const row = { ...station(), id: id(7), label };
    h.db.items[0].stations.push(row);
    return { station: row };
  };
  await page.flow.save(change('addStation', label));
  assert.deepEqual(h.writes.at(-1), { method: 'post', url: groupPath + '/stations', body: { label }, key: id(4) });
  assert.equal(page.flow.snapshot().data.items.length, 1);
  assert.equal(page.flow.snapshot().data.items[0].stations.length, 2);
  assert.ok(h.writes.every(entry => !entry.url.includes('/queue')));
  page.dispose();
});

test('PATCH de nome e identificação preserva UUID, experiência e disponibilidade das estações homônimas', async () => {
  const sibling = { ...station(), id: id(4) };
  const h = fixture([group([sibling, station()])]), page = h.open();
  await page.ready();
  h.db.write = ({ name }) => { h.db.items[0].name = name; return { experience: h.db.items[0] }; };
  await page.flow.save(change('renameExperience', 'Oficina B'));
  assert.deepEqual(h.writes[0], { method: 'patch', url: groupPath, body: { name: 'Oficina B' }, key: id(1) });
  h.db.write = ({ label }) => { const row = h.db.items[0].stations[1]; row.label = label; return { station: row }; };
  await page.flow.save(change('renameStation', 'Mesa B'));
  assert.deepEqual(h.writes[1], { method: 'patch', url: stationPath, body: { label: 'Mesa B' }, key: id(2) });
  assert.deepEqual(copy(page.flow.snapshot().data.items[0].stations), [sibling, { ...station(), label: 'Mesa B' }]);
  assert.equal(h.reads.length, 9);
  page.dispose();
});

test('identidade de resposta e conflito com leitura oficial impedem confirmação fictícia', async () => {
  const h = fixture([group([station()])]), page = h.open();
  await page.ready();
  h.db.write = ({ label }) => ({ station: { ...station(), id: id(7), label } });
  await page.flow.save(change('renameStation', 'Outra'));
  assert.match(page.flow.snapshot().message, /incerto/i);
  assert.equal(page.flow.snapshot().data.items[0].stations[0].label, 'Mesa');
  h.db.write = ({ label }) => ({ station: { ...station(), label } });
  await page.flow.retry(page.flow.snapshot().pending[0]);
  assert.match(page.flow.snapshot().message, /difere/);
  assert.equal(h.writes[0].key, h.writes[1].key);
  page.flow.discard(page.flow.snapshot().pending[0]);
  await page.flow.save({ ...change('renameStation', 'Outra'), original: 'Nome antigo' });
  assert.match(page.flow.snapshot().message, /mudou/);
  assert.equal(h.writes.length, 2);
  page.dispose();
});

test('disponibilidade define estado desejado sem chave, aceita no-op e reconsulta a prontidão oficial', async () => {
  const h = fixture([group([station()])]), page = h.open();
  await page.ready();
  h.db.write = ({ availability }) => {
    h.db.items[0].stations[0].availability = availability;
    return { stationId, availability, pendingServiceSessionId: null };
  };
  for (const value of ['unavailable', 'unavailable', 'available']) {
    await page.flow.save(change('availability', value));
    assert.deepEqual(h.writes.at(-1), { method: 'patch', url: availabilityPath, body: { availability: value }, key: undefined });
    assert.equal(page.flow.snapshot().data.items[0].stations[0].availability, value);
    assert.equal(page.flow.snapshot().data.readiness.ready, value === 'available');
  }
  page.dispose();
});

test('409 de chamada pendente ou encerramento explica a recusa e mantém o estado oficial', async () => {
  const h = fixture([group([station()])]), page = h.open();
  await page.ready();
  h.db.write = () => {
    h.db.items[0].stations[0].pendingServiceSessionId = id(6);
    throw { status: 409, code: 'STATION_HAS_PENDING_CALL' };
  };
  await page.flow.save(change('availability', 'unavailable'));
  assert.match(page.flow.snapshot().message, /chamada pendente/);
  await page.flow.save(change('availability', 'unavailable'));
  assert.equal(h.writes.length, 1);
  h.db.items[0].stations[0].pendingServiceSessionId = null;
  await page.flow.refresh();
  h.db.write = () => { throw { status: 409, code: 'EVENT_OPERATION_ENDED' }; };
  for (const command of [change('availability', 'unavailable'), change('addExperience', 'Laboratório')]) {
    await page.flow.save(command);
    assert.match(page.flow.snapshot().message, /operação do evento já terminou/);
    assert.equal(page.flow.snapshot().data.items[0].stations[0].availability, 'available');
  }
  page.dispose();
});

test('timeout operacional compara o estado observado sem repetir o PATCH em refresh ou remount', async () => {
  for (const persisted of [false, true]) {
    const h = fixture([group([station()])]), page = h.open();
    await page.ready();
    h.db.write = () => {
      if (persisted) h.db.items[0].stations[0].availability = 'unavailable';
      throw { outcomeUnknown: true };
    };
    await page.flow.save(change('availability', 'unavailable'));
    assert.match(page.flow.snapshot().message, persisted ? /confirmado/ : /difere/);
    assert.equal(page.flow.snapshot().pending.length, 0);
    await page.flow.retry(page.flow.snapshot().pending[0]);
    page.dispose();
    const next = h.open(); await next.ready();
    assert.equal(h.writes.length, 1);
    next.dispose();
  }
});

test('401 e 403 em leitura ou escrita removem dados protegidos e bloqueiam novas operações', async () => {
  for (const status of [401, 403]) for (const method of ['get', 'patch']) {
    const h = fixture([group()]), page = h.open();
    await page.ready();
    if (method === 'get') {
      h.db.read = url => { if (url === path) throw { status: 503 }; if (url === collection) throw { status }; };
      await page.flow.refresh();
    } else {
      h.db.write = () => { throw { status }; };
      await page.flow.save(change('renameExperience', 'Outra'));
    }
    assert.equal(page.flow.snapshot().data, null);
    assert.equal(page.flow.snapshot().denied, true);
    await page.flow.save(change('addExperience', 'Outra'));
    assert.equal(h.writes.length, method === 'patch' ? 1 : 0);
    page.dispose();
  }
});

test('404 e falha de rede ocultam o conteúdo e permitem recuperar por leitura', async () => {
  const h = fixture([group()]), page = h.open();
  await page.ready();
  for (const error of [{ status: 404, code: 'RESOURCE_NOT_FOUND' }, { isNetworkError: true }]) {
    h.db.read = url => { if (url === collection) throw error; };
    await page.flow.refresh();
    assert.equal(page.flow.snapshot().data, null);
    assert.match(page.flow.snapshot().message, error.status === 404 ? /não encontrado/ : /conexão/);
    delete h.db.read;
    await page.flow.refresh();
    assert.equal(page.flow.snapshot().data.items[0].id, groupId);
  }
  assert.equal(h.writes.length, 0);
  page.dispose();
});

test('intenção em processamento e retry limitado pelo servidor conservam o mesmo corpo', async () => {
  const h = fixture([group()]), page = h.open();
  await page.ready();
  h.db.write = () => { throw { status: 409, code: 'IDEMPOTENCY_IN_PROGRESS' }; };
  await page.flow.save(change('renameExperience', 'Renomeado'));
  assert.match(page.flow.snapshot().message, /em processamento/);
  h.db.write = () => { throw { status: 429 }; };
  await page.flow.retry(page.flow.snapshot().pending[0]);
  assert.equal(page.flow.snapshot().pending.length, 1);
  assert.deepEqual(h.writes[0], h.writes[1]);
  h.db.write = () => { throw { status: 409, code: 'IDEMPOTENCY_KEY_REUSED' }; };
  await page.flow.retry(page.flow.snapshot().pending[0]);
  assert.equal(page.flow.snapshot().pending.length, 0);
  assert.match(page.flow.snapshot().message, /chave já foi usada/);
  assert.equal(page.flow.snapshot().data.items[0].name, 'Oficina');
  page.dispose();
});

test('logout, troca de conta ou evento e resposta antiga de GET ou PATCH não publicam no contexto atual', async () => {
  for (const method of ['get', 'patch']) {
    const h = fixture([group()]), delay = deferred();
    let current = true;
    const page = h.open(() => current);
    await page.ready();
    if (method === 'get') h.db.read = url => url === collection ? delay.promise : undefined;
    else h.db.write = () => delay.promise;
    const old = method === 'get' ? page.flow.refresh() : page.flow.save(change('renameExperience', 'Antigo'));
    current = false;
    const count = page.published.length;
    await page.flow.save(change('addExperience', 'Não enviar'));
    page.dispose();
    const next = fixture([], id(8)).open();
    await next.ready();
    delay.resolve(method === 'get' ? { eventId, items: [group()] } : { experience: { ...group(), name: 'Antigo' } });
    await old;
    assert.equal(page.published.length, count);
    assert.equal(next.flow.snapshot().data.event.id, id(8));
    assert.equal(next.flow.snapshot().data.items.length, 0);
    assert.equal(h.writes.length, method === 'patch' ? 1 : 0);
    next.dispose();
  }
});

test('gestão recupera a estação do wizard e permite cadastro independente e homônimo em outra experiência', async () => {
  const other = { ...group(), id: id(6), name: 'Pista' };
  const h = fixture([group(), other]);
  const original = { kind: 'addStation', eventId, experienceId: groupId, value: 'Mesa', key: id(8), attempts: 1 };
  original.id = shared.structureIntentId(original);
  h.intents.set(original.id, original);
  const page = h.open();
  await page.ready();
  assert.equal(h.writes.length, 0);
  assert.equal(page.flow.snapshot().pending[0], original);
  await page.flow.save(change('addStation', ' Mesa '));
  assert.equal(h.writes.length, 0);
  assert.match(page.flow.snapshot().message, /pendente/);

  h.db.write = () => { throw { outcomeUnknown: true }; };
  await page.flow.save({ ...change('addStation', 'Mesa'), experienceId: other.id });
  const independent = page.flow.snapshot().pending.find(record => record !== original);
  assert.equal(h.writes[0].url, collection + '/' + other.id + '/stations');
  assert.notEqual(independent.id, original.id);
  assert.notEqual(independent.key, original.key);
  h.db.write = () => {
    const row = station();
    h.db.items[0].stations = [row];
    return { station: row };
  };
  await page.flow.retry(original);
  assert.deepEqual(h.writes[1], { method: 'post', url: groupPath + '/stations', body: { label: 'Mesa' }, key: id(8) });
  assert.equal(page.flow.snapshot().pending.length, 1);
  assert.equal(page.flow.snapshot().pending[0], independent);
  page.flow.discard(original);
  assert.equal(h.intents.get(independent.id), independent);
  page.flow.discard(independent);
  assert.equal(h.intents.size, 0);
  page.dispose();
});

test('GET antigo termina depois da escrita e da releitura sem restaurar a disponibilidade anterior', async () => {
  const h = fixture([group([station()])]), page = h.open();
  await page.ready();
  const delay = deferred();
  let delayed = false;
  h.db.read = url => {
    if (url === collection && !delayed) { delayed = true; return delay.promise; }
  };
  const oldRead = page.flow.refresh();
  await page.flow.refresh();
  h.db.write = ({ availability }) => {
    h.db.items[0].stations[0].availability = availability;
    return { stationId, availability, pendingServiceSessionId: null };
  };
  await page.flow.save(change('availability', 'unavailable'));
  assert.equal(page.flow.snapshot().data.readiness.ready, false);
  const publications = page.published.length;
  delay.resolve({ eventId, items: [group([station()])] });
  await oldRead;
  assert.equal(page.published.length, publications);
  assert.equal(page.flow.snapshot().data.items[0].stations[0].availability, 'unavailable');
  page.dispose();
});

test('trocar o UUID no mesmo cliente e mapa rejeita leitura antiga e mantém a intenção no evento de origem', async () => {
  const h = fixture([group()]);
  let selected = eventId;
  const previous = h.open(() => selected === eventId);
  await previous.ready();
  h.db.write = () => { throw { outcomeUnknown: true }; };
  await previous.flow.save(change('addStation', 'Pendente'));
  const firstEvent = copy(previous.flow.snapshot().data);
  const oldResponse = deferred();
  const otherId = id(8), otherPath = '/admin/events/' + otherId;
  h.db.read = url => {
    if (url === collection) return oldResponse.promise;
    if (url === otherPath) return { event: { ...firstEvent.event, id: otherId, name: 'Outro evento' } };
    if (url === otherPath + '/experiences') return { eventId: otherId, items: [] };
    if (url === otherPath + '/readiness') return { ...firstEvent.readiness, eventId: otherId };
  };
  const old = previous.flow.refresh();
  selected = otherId;
  const publications = previous.published.length;
  const next = h.open(() => selected === otherId, otherId);
  await next.ready();
  oldResponse.resolve({ eventId, items: firstEvent.items });
  await old;
  assert.equal(previous.published.length, publications);
  assert.equal(next.flow.snapshot().data.event.id, otherId);
  assert.equal(next.flow.snapshot().pending.length, 0);
  assert.equal([...h.intents.values()][0].eventId, eventId);
  assert.equal(h.writes.length, 1);
  next.dispose();
  previous.dispose();
});

test('duas instâncias compartilham o envio em voo e um descarte atrasado não remove outra operação', async () => {
  const h = fixture([group()]), first = h.open();
  await first.ready();
  h.db.write = () => { throw { outcomeUnknown: true }; };
  await first.flow.save(change('addStation', 'Mesa'));
  const original = first.flow.snapshot().pending[0];
  const second = h.open();
  await second.ready();
  const delay = deferred();
  h.db.write = () => delay.promise;
  const replay = first.flow.retry(original);
  await second.flow.retry(original);
  second.flow.discard(original);
  assert.equal(h.writes.length, 2);
  assert.equal(h.intents.get(original.id), original);
  h.db.items = [group([station()])];
  delay.resolve({ station: station() });
  await replay;
  assert.equal(h.intents.size, 0);
  second.flow.discard(original);
  assert.equal(h.writes.length, 2);
  first.dispose();
  second.dispose();
});
