const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { createRequire } = require('node:module');
const { loadModule } = require('./helpers/questionnaireHarness.cjs');

const qaRequire = createRequire(path.resolve(__dirname, '../../qa/regression/package.json'));
let React, Renderer;
try { React = qaRequire('react'); Renderer = qaRequire('react-test-renderer'); } catch { /* Ambiente QA ausente. */ }
const skip = React && Renderer ? false : 'dependências de qa/regression não instaladas';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture() {
  let focused = true, foreground = 'active', now = 0, serial = 0;
  const timers = new Map(), listeners = new Set();
  const appState = { currentState: foreground, addEventListener: (_, listener) => {
    listeners.add(listener); return { remove: () => listeners.delete(listener) };
  } };
  const { useStaffPolling } = loadModule('screens/staff/useStaffPolling.js', name => {
    if (name === 'react') return React;
    if (name === 'react-native') return { AppState: appState };
    if (name === '@react-navigation/native') return { useIsFocused: () => focused };
    throw new Error(`Import inesperado: ${name}`);
  }).exports;
  const scheduler = { set: (callback, delay) => { const id = ++serial; timers.set(id, { callback, due: now + delay }); return id; },
    clear: id => timers.delete(id) };
  const Component = ({ enabled = true, read, scope = 'event' }) => {
    useStaffPolling(enabled, read, 5000, scope, scheduler); return null;
  };
  return { Component, timers, listeners,
    advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.due <= now) {
      timers.delete(id); timer.callback();
    } },
    focus(value) { focused = value; },
    app(value) { foreground = value; appState.currentState = value; listeners.forEach(listener => listener(value)); },
    restore() { timers.clear(); listeners.clear(); },
  };
}

test('timer aguarda cinco segundos e o fim da leitura; segundo plano durante leitura não duplica ciclos', { skip }, async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const f = fixture(), pending = deferred(); let calls = 0, renderer;
  try {
    await Renderer.act(async () => { renderer = Renderer.create(React.createElement(f.Component, { read: () => {
      calls++; return calls === 1 ? pending.promise : Promise.resolve();
    } })); });
    assert.equal(f.timers.size, 1);
    await Renderer.act(async () => { f.advance(4999); }); assert.equal(calls, 0);
    await Renderer.act(async () => { f.advance(1); }); assert.equal(calls, 1);
    assert.equal(f.timers.size, 0, 'leitura pendente não agenda outra');
    await Renderer.act(async () => { f.app('background'); f.app('active'); f.app('background'); f.app('active'); f.advance(20000); });
    assert.equal(calls, 1, 'retomadas não consultam durante leitura pendente');
    assert.equal(f.timers.size, 0);
    await Renderer.act(async () => { pending.resolve(); await pending.promise; });
    assert.equal(f.timers.size, 1, 'fim da leitura agenda exatamente um ciclo');
    await Renderer.act(async () => { f.advance(5000); await Promise.resolve(); });
    assert.equal(calls, 2);
    await Renderer.act(async () => { renderer.unmount(); });
    assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, 0);
    f.advance(5000); assert.equal(calls, 2);
  } finally { pending.resolve(); try { if (renderer) await Renderer.act(async () => renderer.unmount()); } finally { f.restore(); } }
});

test('foco, primeiro plano, contexto e desmontagem cancelam timers anteriores', { skip }, async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const f = fixture(); let calls = 0, renderer;
  const read = () => { calls++; return Promise.resolve(); };
  try {
    await Renderer.act(async () => { renderer = Renderer.create(React.createElement(f.Component, { read })); });
    f.focus(false);
    await Renderer.act(async () => { renderer.update(React.createElement(f.Component, { read })); });
    assert.equal(f.timers.size, 0); f.advance(10000); assert.equal(calls, 0);
    f.focus(true);
    await Renderer.act(async () => { renderer.update(React.createElement(f.Component, { read })); });
    assert.equal(f.timers.size, 1);
    await Renderer.act(async () => { f.app('background'); }); assert.equal(f.timers.size, 0);
    f.advance(10000); assert.equal(calls, 0);
    await Renderer.act(async () => { f.app('active'); f.app('active'); }); assert.equal(f.timers.size, 1);
    await Renderer.act(async () => { renderer.update(React.createElement(f.Component, { read, scope: 'other-event' })); });
    assert.equal(f.timers.size, 1, 'troca de contexto substitui o timer');
    await Renderer.act(async () => { f.advance(5000); await Promise.resolve(); }); assert.equal(calls, 1);
    await Renderer.act(async () => { renderer.unmount(); });
    assert.equal(f.timers.size, 0); f.advance(5000); assert.equal(calls, 1);
  } finally { try { if (renderer) await Renderer.act(async () => renderer.unmount()); } finally { f.restore(); } }
});

test('leitura de contexto anterior não agenda novo ciclo após troca ou desmontagem', { skip }, async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const f = fixture(), old = deferred(); let calls = 0, renderer;
  const read = () => { calls++; return calls === 1 ? old.promise : Promise.resolve(); };
  try {
    await Renderer.act(async () => { renderer = Renderer.create(React.createElement(f.Component, { read, scope: 'A' })); });
    await Renderer.act(async () => { f.advance(5000); }); assert.equal(calls, 1);
    await Renderer.act(async () => { renderer.update(React.createElement(f.Component, { read, scope: 'B' })); });
    assert.equal(f.timers.size, 1);
    await Renderer.act(async () => { old.resolve(); await old.promise; });
    assert.equal(f.timers.size, 1, 'resposta antiga não cria segundo timer');
    await Renderer.act(async () => { renderer.unmount(); });
    f.advance(5000); assert.equal(calls, 1);
  } finally { old.resolve(); try { if (renderer) await Renderer.act(async () => renderer.unmount()); } finally { f.restore(); } }
});
