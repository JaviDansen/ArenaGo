const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mount } = require('../helpers/react-app.cjs');

test('B01 persisted questionnaire reaches rendered MainTabs through real React Navigation', async (t) => {
  const h = await mount({ routed: true });
  t.after(() => h.dispose());
  assert.equal(h.manager.getSnapshot().user.hasCompletedQuestionnaire, false);
  assert.deepEqual(h.routeNames, ['ProfileQuestionnaire', 'Questionario']);
  assert.equal(h.navRef.getCurrentRoute().name, 'ProfileQuestionnaire');
  await h.toFinish();
  await h.press('Concluir questionário');
  assert.equal(h.requests.put.length, 1);
  assert.equal(h.navRef.getCurrentRoute().name, 'ProfileQuestionnaire', 'must wait for persistence');

  await h.complete(h.requests.put[0]);
  assert.equal(h.manager.getSnapshot().user.hasCompletedQuestionnaire, true);
  assert.ok(h.routeNames.includes('MainTabs'), 'context update must expose the operational route');
  t.diagnostic(JSON.stringify({
    trace: h.trace,
    unhandledActions: h.unhandled,
    focusedRoute: h.navRef.getCurrentRoute().name,
    renderedTexts: h.texts(),
  }));
  assert.equal(h.navRef.getCurrentRoute().name, 'MainTabs',
    'successful PUT must leave the questionnaire after route reconfiguration');
  assert.ok(h.hasText('MainTabs'), 'assert rendered destination, not only a reset spy');
  assert.equal(h.unhandled.length, 0, 'no RESET action may be lost');
});

test('B02 failed persistence keeps questionnaire rendered and routes restricted', async (t) => {
  const h = await mount({ routed: true });
  t.after(() => h.dispose());
  await h.toFinish();
  await h.press('Concluir questionário');
  await h.reject(h.requests.put[0], { detail: 'Persistence failed in fixture' });
  assert.equal(h.manager.getSnapshot().user.hasCompletedQuestionnaire, false);
  assert.deepEqual(h.routeNames, ['ProfileQuestionnaire', 'Questionario']);
  assert.equal(h.navRef.getCurrentRoute().name, 'ProfileQuestionnaire');
  assert.ok(h.hasText('Persistence failed in fixture'));
  assert.equal(h.unhandled.length, 0);
});
