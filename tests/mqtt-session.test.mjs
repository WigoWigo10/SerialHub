import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const directory = await mkdtemp(join(process.cwd(), 'node_modules', '.mqtt-session-'));
after(() => rm(directory, { recursive: true, force: true }));
for (const [source, output] of [['src/lib/mqttSession.ts', 'session.mjs'], ['src/stores/mqttSessionStore.ts', 'store.mjs']]) {
  await writeFile(join(directory, output), ts.transpileModule(await readFile(new URL(`../${source}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText);
}
const { startMqttMonitor, createMqttController, mqttOperation } = await import(pathToFileURL(join(directory, 'session.mjs')).href);
const { useMqttSessionStore: store } = await import(pathToFileURL(join(directory, 'store.mjs')).href);
const snapshot = (revision, session_id, status, error = null) => ({ revision, session_id, status, error });
const message = (session_id, sequence) => ({ session_id, sequence, topic: 'topic', payload: '42', qos: 0 });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const current = () => store.getState().snapshot;
const apply = state => store.getState().applySnapshot(state);
const reset = () => store.setState({ snapshot: snapshot(-1, 0, 'idle'), reserving: false, messages: [], subscriptions: [], lastSequence: 0 });

test('ordered global snapshots reject old sessions, errors and late ConnAck after timeout', () => {
  reset(); apply(snapshot(1, 1, 'connecting')); apply(snapshot(3, 1, 'timed_out', 'timeout'));
  apply(snapshot(2, 1, 'connected'));
  assert.equal(current().status, 'timed_out');
  apply(snapshot(4, 2, 'connecting')); apply(snapshot(5, 2, 'connected'));
  apply(snapshot(100, 1, 'failed', 'old error'));
  assert.equal(current().session_id, 2); assert.equal(current().status, 'connected'); assert.equal(current().error, null);
});

test('messages require connected identity, reject duplicate sequence and survive page changes in global memory', () => {
  reset(); apply(snapshot(1, 1, 'connecting')); store.getState().applyMessage(message(1, 1));
  assert.equal(store.getState().messages.length, 0);
  apply(snapshot(2, 1, 'connected')); store.getState().applyMessage(message(1, 1));
  store.getState().applyMessage(message(1, 1));
  assert.equal(store.getState().messages.length, 1);
  apply(snapshot(3, 1, 'cancelled')); store.getState().applyMessage(message(1, 2));
  apply(snapshot(4, 2, 'connected')); store.getState().applyMessage(message(1, 3));
  store.getState().applyMessage(message(2, 1));
  assert.deepEqual(store.getState().messages.map(m => m.session_id), [1, 2]);
  store.getState().clearMessages(); store.getState().applyMessage(message(2, 1));
  assert.equal(store.getState().messages.length, 0, 'clear must not allow event replay');
});

test('subscriptions clear at stop/new session and stale operation results cannot repopulate them', () => {
  reset(); apply(snapshot(1, 1, 'connected')); store.getState().subscription(1, 'a', true);
  apply(snapshot(2, 1, 'stopping')); assert.deepEqual(store.getState().subscriptions, []);
  apply(snapshot(3, 2, 'connected')); store.getState().subscription(1, 'old', true);
  store.getState().subscription(2, 'new', true); assert.deepEqual(store.getState().subscriptions, ['new']);
  apply(snapshot(4, 2, 'connected')); assert.deepEqual(store.getState().subscriptions, ['new']);
});

test('cancellation during reservation cancels its eventual identity without configuring it', async () => {
  reset(); const begin = deferred(); const configured = []; const cancelled = [];
  const commands = createMqttController({ begin: () => begin.promise,
    configure: async id => configured.push(id), cancel: async id => { cancelled.push(id); return snapshot(2, id, 'cancelled'); },
    disconnect: async id => snapshot(3, id, 'disconnected'), current, apply, pending: reserving => store.setState({ reserving }) });
  const connection = commands.connect({ password: 'FAKE-memory-only' });
  assert.equal(store.getState().reserving, true);
  const cancellation = commands.cancel();
  begin.resolve(snapshot(1, 1, 'connecting'));
  await Promise.all([connection, cancellation]);
  assert.deepEqual(configured, []); assert.deepEqual(cancelled, [1]);
  assert.equal(current().status, 'cancelled'); assert.equal(store.getState().reserving, false);
});

test('cancel reaches backend during pending configure and old failure cannot affect a new attempt', async () => {
  reset(); const configuration = deferred(); let id = 0; let revision = 0; const cancelled = [];
  const commands = createMqttController({ begin: async () => snapshot(++revision, ++id, 'connecting'),
    configure: async attempt => { if (attempt === 1) return configuration.promise; },
    cancel: async attempt => { cancelled.push(attempt); return snapshot(++revision, attempt, 'cancelled'); },
    disconnect: async attempt => snapshot(++revision, attempt, 'disconnected'), current, apply, pending: reserving => store.setState({ reserving }) });
  const old = commands.connect({}); await flush();
  await commands.cancel(); assert.deepEqual(cancelled, [1]);
  await commands.connect({}); apply(snapshot(++revision, 2, 'connected'));
  configuration.reject(new Error('late configure rejection'));
  await old;
  assert.equal(current().session_id, 2); assert.equal(current().status, 'connected');
  assert.deepEqual(cancelled, [1]); assert.equal(store.getState().reserving, false);
});

test('a late reservation result after backend timeout does not dispatch configure', async () => {
  reset(); const begin = deferred(); let configured = 0;
  const commands = createMqttController({ begin: () => begin.promise, configure: async () => configured++,
    cancel: async id => snapshot(4, id, 'cancelled'), disconnect: async id => snapshot(4, id, 'disconnected'),
    current, apply, pending: reserving => store.setState({ reserving }) });
  const pending = commands.connect({}); apply(snapshot(3, 1, 'timed_out', 'timeout'));
  begin.resolve(snapshot(1, 1, 'connecting')); await pending;
  assert.equal(configured, 0); assert.equal(current().status, 'timed_out');
});

test('duplicate connect shares the same reservation and configure failure performs backend cleanup', async () => {
  reset(); let begins = 0; let stops = 0; const begin = deferred();
  const commands = createMqttController({ begin: () => { begins++; return begin.promise; }, configure: async () => { throw new Error('IPC failed'); },
    cancel: async id => { stops++; return snapshot(2, id, 'cancelled'); }, disconnect: async id => snapshot(3, id, 'disconnected'),
    current, apply, pending: reserving => store.setState({ reserving }) });
  const first = commands.connect({}); const duplicate = commands.connect({});
  assert.equal(first, duplicate); begin.resolve(snapshot(1, 1, 'connecting'));
  await assert.rejects(first, /IPC failed/); assert.equal(begins, 1); assert.equal(stops, 1);
  assert.equal(store.getState().reserving, false);
});

test('late publish/subscribe success or failure does not mutate a replacement session', async () => {
  reset(); apply(snapshot(1, 1, 'connected')); let successes = 0;
  const success = deferred(); const failure = deferred();
  const first = mqttOperation(1, current, () => success.promise, () => successes++);
  const second = mqttOperation(1, current, () => failure.promise, () => successes++);
  apply(snapshot(2, 2, 'connected')); success.resolve(); failure.reject(new Error('old failure'));
  assert.deepEqual(await Promise.all([first, second]), [false, false]); assert.equal(successes, 0);
  assert.equal(await mqttOperation(2, current, async () => {}, () => successes++), true);
  await assert.rejects(mqttOperation(2, current, async () => { throw new Error('current'); }, () => {}), /current/);
  assert.equal(successes, 1);
});

test('old cancel/disconnect results and errors cannot replace a later connection', async () => {
  for (const operation of ['cancel', 'disconnect']) for (const fails of [false, true]) {
    reset(); apply(snapshot(1, 1, 'connected')); const old = deferred();
    const commands = createMqttController({ begin: async () => snapshot(3, 2, 'connecting'), configure: async () => {},
      cancel: () => old.promise, disconnect: () => old.promise, current, apply, pending: reserving => store.setState({ reserving }) });
    const stop = commands[operation]();
    await commands.connect({}); apply(snapshot(4, 2, 'connected'));
    if (fails) old.reject(new Error('old stop failed')); else old.resolve(snapshot(2, 1, 'disconnected'));
    await stop;
    assert.equal(current().session_id, 2); assert.equal(current().status, 'connected');
  }
});

test('subscribe before snapshot keeps newer events and cleans both listeners on unmount', async () => {
  reset(); const pending = deferred(); let receiveState, receiveMessage; let stopped = 0;
  const stop = startMqttMonitor({ state: async receive => { receiveState = receive; return () => stopped++; },
    messages: async receive => { receiveMessage = receive; return () => stopped++; }, snapshot: () => pending.promise,
    apply, message: message => store.getState().applyMessage(message), error: error => { throw error; } });
  await flush(); receiveState(snapshot(2, 1, 'connected')); receiveMessage(message(1, 1));
  pending.resolve(snapshot(1, 1, 'connecting')); await flush();
  assert.equal(current().status, 'connected'); assert.equal(store.getState().messages.length, 1);
  stop(); stop(); receiveState(snapshot(3, 1, 'failed', 'late')); receiveMessage(message(1, 2));
  assert.equal(stopped, 2); assert.equal(current().status, 'connected'); assert.equal(store.getState().messages.length, 1);
});

test('messages arriving during initial snapshot reconciliation wait for current identity', async () => {
  reset(); const pending = deferred(); let receive;
  const stop = startMqttMonitor({ state: async () => () => {},
    messages: async callback => { receive = callback; return () => {}; }, snapshot: () => pending.promise,
    apply, message: message => store.getState().applyMessage(message), error: error => { throw error; } });
  await flush(); receive(message(1, 1)); receive(message(0, 99));
  assert.equal(store.getState().messages.length, 0);
  pending.resolve(snapshot(2, 1, 'connected')); await flush();
  assert.equal(store.getState().messages.length, 1);
  assert.equal(store.getState().messages[0].session_id, 1);
  stop();
});

test('late subscriptions/snapshots from a disposed mount cannot affect a remount', async () => {
  reset(); const stateListener = deferred(); const msgListener = deferred(); let staleState, staleMessage; let stops = 0;
  const stop = startMqttMonitor({ state: receive => { staleState = receive; return stateListener.promise; },
    messages: receive => { staleMessage = receive; return msgListener.promise; }, snapshot: async () => { throw new Error('snapshot after unmount'); },
    apply, message: () => { throw new Error('late message'); }, error: error => { throw error; } });
  stop(); stateListener.resolve(() => stops++); msgListener.resolve(() => stops++); await flush();
  const newStop = startMqttMonitor({ state: async () => () => {}, messages: async () => () => {}, snapshot: async () => snapshot(2, 2, 'connected'),
    apply, message: () => {}, error: error => { throw error; } });
  await flush(); staleState(snapshot(99, 3, 'failed')); staleMessage(message(3, 1));
  assert.equal(stops, 2); assert.equal(current().session_id, 2); newStop();
});

test('partial listener registration failure unsubscribes late completions without reconciliation', async () => {
  const late = deferred(); let errors = 0; let stops = 0; let snapshots = 0;
  const stop = startMqttMonitor({ state: async () => { throw new Error('listen failed'); }, messages: () => late.promise,
    snapshot: async () => { snapshots++; return snapshot(0, 0, 'idle'); }, apply: () => {}, message: () => {}, error: () => errors++ });
  await flush(); late.resolve(() => stops++); await flush(); stop();
  assert.equal(errors, 1); assert.equal(stops, 1); assert.equal(snapshots, 0);
});

test('snapshot resolving after unmount cannot overwrite a subsequent mount', async () => {
  reset(); const pending = deferred(); let stops = 0;
  const stop = startMqttMonitor({ state: async () => () => stops++, messages: async () => () => stops++, snapshot: () => pending.promise,
    apply, message: () => {}, error: error => { throw error; } });
  await flush(); stop();
  const next = startMqttMonitor({ state: async () => () => {}, messages: async () => () => {}, snapshot: async () => snapshot(2, 2, 'connected'),
    apply, message: () => {}, error: error => { throw error; } });
  await flush(); pending.resolve(snapshot(99, 3, 'failed', 'old snapshot')); await flush();
  assert.equal(stops, 2); assert.equal(current().session_id, 2); assert.equal(current().status, 'connected'); next();
});

test('root owns MQTT listeners; cancel and all operations carry backend session identity (static wiring)', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const page = await readFile(new URL('../src/components/pages/MqttPage.tsx', import.meta.url), 'utf8');
  const commands = await readFile(new URL('../src/lib/mqttCommands.ts', import.meta.url), 'utf8');
  assert.ok(app.includes('useMqttSession();'));
  assert.ok(!page.includes('mqtt-status') && !page.includes('mqtt-error'));
  assert.ok(page.includes('await mqttCommands.cancel()'));
  assert.ok(!page.includes('safetyTimeoutRef') && !page.includes('setIsConnected'));
  assert.equal((page.match(/expectedSessionId: id/g) || []).length, 3);
  assert.ok(commands.includes("invoke<MqttSnapshot>('cancel_mqtt', { expectedSessionId: id })"));
  assert.ok(!((await readFile(new URL('../src/stores/mqttSessionStore.ts', import.meta.url), 'utf8')).includes('persist(')));
});
