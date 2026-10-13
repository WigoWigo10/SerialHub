import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const directory = await mkdtemp(join(process.cwd(), 'node_modules', '.serial-state-test-'));
after(() => rm(directory, { recursive: true, force: true }));
for (const [source, name] of [
  ['src/lib/serialConnection.ts', 'serialConnection.mjs'],
  ['src/stores/settingsStore.ts', 'settingsStore.mjs'],
  ['src/lib/themeTransition.ts', 'themeTransition.mjs'],
]) {
  const input = await readFile(new URL(`../${source}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText.replace('../lib/themeTransition', './themeTransition.mjs');
  await writeFile(join(directory, name), code);
}
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { useSettingsStore: store } = await import(pathToFileURL(join(directory, 'settingsStore.mjs')).href);
const { startSerialConnectionMonitor } = await import(pathToFileURL(join(directory, 'serialConnection.mjs')).href);
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const status = (revision, session = 1, connected = true, error = null) => ({
  revision, session_id: session, connected, port_name: connected ? 'TEST-VIRTUAL' : null, error,
});
function reset() {
  store.setState({ serialRevision: -1, serialSessionId: 0, serialError: null,
    connected: false, activePort: null, connectionStartTime: null, rxBytes: 0, txBytes: 0 });
}
function fixture(snapshot = Promise.resolve(status(0, 0, false))) {
  const subscribed = deferred();
  let receive, unsubscriptions = 0, snapshots = 0;
  const errors = [];
  const stop = startSerialConnectionMonitor({
    subscribe: callback => { receive = callback; return subscribed.promise; },
    snapshot: () => { snapshots++; return snapshot; },
    apply: value => store.getState().applySerialConnection(value),
    reportError: error => errors.push(error),
  });
  return { stop, errors, subscribed, emit: value => receive(value),
    activate: () => subscribed.resolve(() => { unsubscriptions++; }),
    get unsubscriptions() { return unsubscriptions; }, get snapshots() { return snapshots; } };
}

test('fatal state updates globally on every page and stale states cannot disconnect a new session', async () => {
  reset();
  const f = fixture(); f.activate(); await flush();
  for (const [index, page] of ['SERIAL', 'DASHBOARD', 'SETTINGS', 'MQTT', 'BLUETOOTH', 'SPY'].entries()) {
    store.setState({ activityMode: page });
    f.emit(status(index * 2 + 1, index + 1));
    assert.equal(store.getState().connected, true);
    assert.equal(store.getState().activePort, 'TEST-VIRTUAL');
    f.emit(status(index * 2 + 2, index + 1, false, 'simulated fatal read'));
    assert.equal(store.getState().connected, false);
    assert.equal(store.getState().activePort, null);
    assert.equal(store.getState().connectionStartTime, null);
    assert.equal(store.getState().serialError, 'simulated fatal read');
  }
  f.emit(status(20, 10));
  f.emit(status(12, 6, false, 'late old failure'));
  assert.equal(store.getState().connected, true);
  assert.equal(store.getState().serialSessionId, 10);
  assert.equal(store.getState().serialError, null);
  f.stop();
});

test('subscribe-before-snapshot preserves a newer event delivered during reconciliation', async () => {
  reset();
  const snapshot = deferred();
  const f = fixture(snapshot.promise); f.activate(); await flush();
  assert.equal(f.snapshots, 1);
  f.emit(status(2, 1, false, 'fatal before snapshot response'));
  snapshot.resolve(status(1)); await flush();
  assert.equal(store.getState().connected, false);
  assert.equal(store.getState().serialRevision, 2);
  f.stop();
});

test('late subscription completion is unsubscribed once after an early unmount', async () => {
  reset();
  const f = fixture();
  f.stop(); f.stop(); f.activate(); await flush();
  assert.equal(f.unsubscriptions, 1);
  assert.equal(f.snapshots, 0);
  f.emit(status(10));
  assert.equal(store.getState().serialRevision, -1);
});

test('pending snapshots and callbacks cannot update after unmount or affect a remount', async () => {
  reset();
  const oldSnapshot = deferred();
  const old = fixture(oldSnapshot.promise); old.activate(); await flush(); old.stop();
  const current = fixture(Promise.resolve(status(4, 2))); current.activate(); await flush();
  oldSnapshot.resolve(status(20, 1, false)); old.emit(status(30, 1, false)); await flush();
  assert.equal(store.getState().serialRevision, 4);
  assert.equal(store.getState().connected, true);
  assert.equal(old.unsubscriptions, 1);
  current.stop(); current.stop();
  assert.equal(current.unsubscriptions, 1);
});

test('duplicate snapshots preserve counters and a session replacement resets them', () => {
  reset();
  store.getState().applySerialConnection(status(1));
  store.getState().addRxBytes(7); store.getState().addTxBytes(3);
  const started = store.getState().connectionStartTime;
  store.getState().applySerialConnection(status(1));
  assert.equal(store.getState().rxBytes, 7);
  assert.equal(store.getState().connectionStartTime, started);
  store.getState().applySerialConnection(status(3, 2));
  assert.equal(store.getState().rxBytes, 0);
  assert.equal(store.getState().txBytes, 0);
  store.getState().applySerialConnection(status(4, 2, false));
  assert.equal(store.getState().activePort, null);
});

test('subscription/snapshot failures are reported and cleanup still unsubscribes', async () => {
  const f = fixture(Promise.reject(new Error('query failed')));
  f.activate(); await flush();
  assert.equal(f.errors.length, 1);
  f.stop(); assert.equal(f.unsubscriptions, 1);
  const rejected = fixture();
  rejected.subscribed.reject(new Error('listen failed')); await flush();
  assert.equal(rejected.errors.length, 1);
  rejected.stop();
});

test('root hook owns lifecycle and Sidebar no longer writes optimistic connection state (static wiring)', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const sidebar = await readFile(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
  const hook = await readFile(new URL('../src/hooks/useSerialConnection.ts', import.meta.url), 'utf8');
  assert.match(app, /useSerialConnection\(\)/);
  assert.match(hook, /useEffect\(\(\) => startSerialConnectionMonitor/);
  assert.match(hook, /serial-connection-state/);
  assert.doesNotMatch(sidebar, /connection-lost|setConnected|setActivePort/);
});
