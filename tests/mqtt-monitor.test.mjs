import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const directory = await mkdtemp(join(process.cwd(), 'node_modules', '.mqtt-monitor-'));
after(() => rm(directory, { recursive: true, force: true }));
for (const [source, output] of [
  ...['mqttPayload', 'mqttLimits', 'mqttTree', 'mqttRetention', 'mqttMonitor'].map(name => [`src/lib/${name}.ts`, name]),
  ['src/stores/mqttSessionStore.ts', 'store'],
]) {
  await writeFile(join(directory, `${output}.mjs`), ts.transpileModule(await readFile(new URL(`../${source}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/(?:\.\.\/lib\/|\.\/)(mqttPayload|mqttLimits|mqttTree|mqttRetention|mqttMonitor)(['"])/g, './$1.mjs$2'));
}
const load = name => import(pathToFileURL(join(directory, `${name}.mjs`)).href);
const { startMqttMonitor } = await load('mqttMonitor');
const { MQTT_LIMITS: limits } = await load('mqttLimits');
const { emptyMqttRetention } = await load('mqttRetention');
const { useMqttSessionStore: store } = await load('store');
const state = (revision, session_id = 1, status = 'connected', error = null) => ({ revision, session_id, status, error });
const message = (sequence, payload_bytes = [sequence % 256], session_id = 1, state_revision = 2) => ({
  sequence, payload_bytes, session_id, state_revision, topic: 'topic', qos: 0,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
function clock() {
  let now = 0, id = 0;
  const timers = new Map();
  return {
    timers,
    schedule(milliseconds, callback) {
      const key = ++id; timers.set(key, { at: now + milliseconds, callback });
      return () => timers.delete(key);
    },
    advance(milliseconds) {
      now += milliseconds;
      for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.callback(); }
    },
  };
}
function harness({ listenersPending = false, reset = true, onMessage } = {}) {
  if (reset) store.setState({ ...emptyMqttRetention(), snapshot: state(-1, 0, 'idle'), lastSequence: 0, subscriptions: [] });
  const generation = store.getState().beginMonitor();
  const time = clock(); const pending = deferred(); const stateListener = deferred(); const messageListener = deferred();
  const errors = [], publications = [], applied = [], progress = [];
  let receiveState, receiveMessage, stopped = 0, snapshots = 0;
  const stop = startMqttMonitor({
    state: receive => { receiveState = receive; return listenersPending ? stateListener.promise : Promise.resolve(() => stopped++); },
    messages: receive => { receiveMessage = receive; return listenersPending ? messageListener.promise : Promise.resolve(() => stopped++); },
    snapshot: () => { snapshots++; return pending.promise; },
    view: () => ({ snapshot: store.getState().snapshot, lastSequence: store.getState().lastSequence }),
    apply: snapshot => { applied.push(snapshot); store.getState().applySnapshot(snapshot); },
    message: message => { publications.push(message); store.getState().applyMessage(message); onMessage?.(message, { receiveState, receiveMessage }); },
    error: error => errors.push(String(error)),
    progress: value => { progress.push(value); store.getState().monitorProgress(generation, value); },
    schedule: time.schedule,
  });
  const result = { stop, pending, stateListener, messageListener, time, errors, publications, applied, progress,
    state: receiveState, message: receiveMessage,
    get stopped() { return stopped; }, get snapshots() { return snapshots; },
    get current() { return store.getState(); },
    get metrics() { return progress.at(-1); },
    resolveListeners() { stateListener.resolve(() => stopped++); messageListener.resolve(() => stopped++); },
  };
  return result;
}

test('listeners register before snapshot; publications before registration and resolution are ordered once', async () => {
  const h = harness({ listenersPending: true });
  h.message(message(2, [0xc3, 0xa9])); h.message(message(1, [0, 255]));
  assert.equal(h.snapshots, 0); assert.equal(h.metrics.queuedMessages, 2);
  h.resolveListeners(); await flush(); assert.equal(h.snapshots, 1);
  h.message(message(3, [])); h.pending.resolve(state(2));
  // A callback delivered before the promise continuation still belongs to the buffer.
  h.message(message(4, [13, 10])); await flush();
  assert.deepEqual(h.publications.map(item => item.sequence), [1, 2, 3, 4]);
  assert.deepEqual(h.current.latest.get('topic').payload_bytes, [13, 10]);
  assert.equal(h.metrics.phase, 'live'); assert.equal(h.metrics.queuedBytes, 0);
  assert.equal(h.time.timers.size, 0);
  h.stop(); await h.stop.done; assert.equal(h.stopped, 2);
});

test('count overflow keeps newest logical sequences, including zero-byte messages', async () => {
  const h = harness(); await flush();
  for (let i = limits.syncMessages + 5; i >= 1; i--) h.message(message(i, []));
  assert.equal(h.metrics.queuedMessages, limits.syncMessages);
  assert.equal(h.metrics.queuedBytes, 0);
  assert.equal(h.metrics.drops.capacity, 5);
  h.pending.resolve(state(2)); await flush();
  assert.equal(h.publications[0].sequence, 6);
  assert.equal(h.publications.at(-1).sequence, limits.syncMessages + 5);
  assert.equal(h.current.discards.history, 0, 'buffer discard is not a history discard');
  h.stop();
});

test('byte overflow removes whole publications without copying or decoding buffered payloads', async () => {
  const h = harness(); await flush();
  const payloads = Array.from({ length: 5 }, (_, i) => Array(limits.payloadBytes).fill(250 + i));
  for (const [i, payload] of payloads.entries()) h.message(message(i + 1, payload));
  assert.equal(h.metrics.queuedMessages, 4);
  assert.equal(h.metrics.queuedBytes, limits.syncBytes);
  assert.equal(h.metrics.drops.capacity, 1);
  assert.equal(h.current.messages.length, 0);
  h.pending.resolve(state(2)); await flush();
  assert.equal(h.publications[0].payload_bytes, payloads[1], 'buffer passes through the original event reference');
  assert.notEqual(h.current.messages[0].payload_bytes, payloads[1], 'retained store still takes ownership');
  assert.deepEqual(h.current.latest.get('topic').payload_bytes, payloads[4]);
  h.stop();
});

test('individual oversized/invalid events have explicit counters; no truncated payload is queued', async () => {
  const h = harness(); await flush();
  h.message(message(1, Array(limits.payloadBytes + 1).fill(255)));
  h.message({ ...message(2), payload_bytes: [256] });
  h.message({ ...message(3), state_revision: undefined });
  h.message({ ...message(4), topic: 'x'.repeat(limits.topicBytes + 1) });
  assert.equal(h.metrics.queuedMessages, 0);
  assert.equal(h.metrics.drops.oversize, 1); assert.equal(h.metrics.drops.invalid, 3);
  h.pending.resolve(state(2)); await flush();
  assert.equal(h.publications.length, 0);
  // After sync, ready messages go directly to A04, whose rejection has its own counter.
  h.message(message(5, Array(limits.payloadBytes + 1).fill(255)));
  assert.equal(h.current.discards.payloads, 1);
  assert.equal(h.metrics.drops.oversize, 1);
  h.message({ ...message(6), topic: 'x'.repeat(limits.topicBytes + 1) });
  assert.equal(h.current.discards.topicShape, 1);
  assert.equal(h.metrics.drops.invalid, 3);
  h.stop();
});

test('duplicate/out-of-order data never overwrites newer values across buffer and live phases', async () => {
  const h = harness(); await flush();
  h.message(message(2, [50])); h.message(message(2, [99])); h.message(message(1, [49]));
  h.pending.resolve(state(2)); await flush();
  h.message(message(2, [98])); h.message(message(4, [52])); h.message(message(3, [51]));
  assert.deepEqual(h.publications.map(item => item.sequence), [1, 2, 4]);
  assert.deepEqual(h.current.latest.get('topic').payload_bytes, [52]);
  assert.equal(h.metrics.drops.duplicate, 3); h.stop();
});

test('state/error events are not subject to data capacity or snapshot delay', async () => {
  const h = harness(); await flush();
  for (let i = 1; i <= limits.syncMessages + 2; i++) h.message(message(i, []));
  h.state(state(3, 1, 'failed', 'fatal MQTT read'));
  assert.equal(h.current.snapshot.status, 'failed');
  assert.equal(h.current.snapshot.error, 'fatal MQTT read');
  assert.equal(h.metrics.queuedMessages, 0);
  assert.equal(h.metrics.drops.capacity, 2);
  assert.equal(h.metrics.drops.obsolete, limits.syncMessages);
  h.pending.resolve(state(2)); await flush();
  assert.equal(h.current.snapshot.status, 'failed');
  assert.equal(h.publications.length, 0); h.stop();
});

test('disconnect and reconnect while awaiting snapshot purge old-session data and preserve new data', async () => {
  const h = harness(); await flush();
  h.state(state(2)); h.message(message(1));
  h.state(state(3, 1, 'disconnected'));
  h.state(state(4, 2, 'connecting'));
  h.message(message(2, [255], 1, 2)); h.message(message(1, [0, 255], 2, 5));
  h.state(state(5, 2));
  h.pending.resolve(state(2)); await flush();
  assert.equal(h.current.snapshot.session_id, 2);
  assert.deepEqual(h.current.messages.map(item => item.session_id), [2]);
  assert.deepEqual(h.current.latest.get('topic').payload_bytes, [0, 255]);
  assert.equal(h.metrics.drops.obsolete, 2); h.stop();
});

test('message received before its connection revision waits for the matching live state', async () => {
  const h = harness(); await flush();
  h.pending.resolve(state(1, 1, 'connecting')); await flush();
  h.message(message(1, [195, 169], 1, 2));
  assert.equal(h.publications.length, 0); assert.equal(h.time.timers.size, 1);
  h.state(state(2));
  assert.equal(h.publications.length, 1); assert.equal(h.current.messages[0].payload, 'é');
  assert.equal(h.time.timers.size, 0); h.stop();
});

test('late state events and stale command snapshots cannot resurrect a terminal session', async () => {
  const h = harness(); await flush();
  h.state(state(3, 1, 'disconnected'));
  h.pending.resolve(state(2)); await flush();
  h.state(state(2)); h.message(message(1));
  assert.equal(h.current.snapshot.status, 'disconnected');
  assert.equal(h.publications.length, 0);
  assert.equal(h.metrics.drops.obsolete, 1); h.stop();
});

test('snapshot rejection terminates monitor, drops references/counters separately and allows manual remount', async () => {
  const h = harness(); await flush(); h.message(message(1, [255]));
  h.pending.reject(new Error('snapshot unavailable')); await flush();
  assert.equal(await h.stop.done, 'failed');
  assert.equal(h.metrics.phase, 'failed'); assert.equal(h.metrics.queuedBytes, 0);
  assert.equal(h.metrics.drops.closed, 1); assert.equal(h.stopped, 2);
  assert.equal(h.time.timers.size, 0); assert.equal(h.errors.length, 1);
  const next = harness({ reset: false }); await flush();
  next.pending.resolve(state(5, 2)); await flush();
  h.state(state(100, 3)); h.message(message(1, [255], 3, 100));
  assert.equal(next.current.snapshot.session_id, 2); assert.equal(next.current.monitor.phase, 'live');
  next.stop();
});

test('slow snapshot has a fixed deadline not extended by incoming data; late response cannot update', async () => {
  const h = harness(); await flush();
  h.time.advance(limits.syncTimeoutMs - 1); h.message(message(1));
  h.time.advance(1);
  assert.equal(await h.stop.done, 'failed'); assert.equal(h.metrics.drops.closed, 1);
  assert.equal(h.metrics.queuedMessages, 0); assert.equal(h.stopped, 2);
  const before = h.current;
  h.pending.resolve(state(999, 9)); await flush();
  assert.equal(h.current, before); assert.equal(h.snapshots, 1); assert.equal(h.errors.length, 1);
});

test('a missing future live state has a bounded wait and finalizes its monitor', async () => {
  const h = harness(); await flush(); h.pending.resolve(state(2)); await flush();
  h.message(message(1, [1], 2, 5));
  h.time.advance(limits.syncTimeoutMs);
  assert.equal(await h.stop.done, 'failed');
  assert.equal(h.metrics.drops.closed, 1); assert.equal(h.metrics.queuedBytes, 0);
  h.state(state(5, 2)); assert.equal(h.current.snapshot.session_id, 1);
});

test('registration timeout finishes without waiting for native promises and unsubscribes late listeners once', async () => {
  const h = harness({ listenersPending: true }); h.message(message(1));
  h.time.advance(limits.syncTimeoutMs);
  assert.equal(await h.stop.done, 'failed'); assert.equal(h.snapshots, 0);
  h.stop(); h.stop(); h.resolveListeners(); await flush();
  assert.equal(h.stopped, 2); assert.equal(h.errors.length, 1);
  h.state(state(99)); assert.equal(h.current.snapshot.session_id, 0);
});

test('dispose before snapshot releases queue/timer and ignores late snapshot after remount', async () => {
  const h = harness(); await flush(); h.message(message(1, [0, 255])); h.stop();
  assert.equal(await h.stop.done, 'stopped'); assert.equal(h.metrics.queuedBytes, 0);
  assert.equal(h.metrics.drops.closed, 1); assert.equal(h.time.timers.size, 0);
  const next = harness({ reset: false }); await flush(); next.pending.resolve(state(5, 2)); await flush();
  h.pending.resolve(state(100, 3)); h.state(state(100, 3)); await flush();
  assert.equal(next.current.snapshot.session_id, 2); next.stop();
});

test('messages arriving reentrantly during drain are ordered and do not run a second drain', async () => {
  let added = false;
  const h = harness({ onMessage: (_, callbacks) => {
    if (!added) { added = true; callbacks.receiveMessage(message(3)); callbacks.receiveMessage(message(2)); }
  } });
  await flush(); h.message(message(1)); h.pending.resolve(state(2)); await flush();
  assert.deepEqual(h.publications.map(item => item.sequence), [1, 2, 3]);
  assert.equal(h.metrics.queuedMessages, 0); h.stop();
});

test('store watermark prevents replay on monitor remount and command state updates participate in reconciliation', async () => {
  const h = harness(); await flush(); h.pending.resolve(state(2)); await flush(); h.message(message(7)); h.stop();
  const next = harness({ reset: false }); await flush();
  next.message(message(7)); next.message(message(8));
  // Command responses can update the same global store before the listener event.
  store.getState().applySnapshot(state(4, 2, 'connecting'));
  next.message(message(1, [0], 2, 5));
  store.getState().applySnapshot(state(5, 2));
  next.pending.resolve(state(2)); await flush();
  assert.deepEqual(next.current.messages.map(item => [item.session_id, item.sequence]), [[2, 1]]);
  assert.equal(next.metrics.drops.duplicate, 1); assert.equal(next.metrics.drops.obsolete, 1); next.stop();
});

test('progress is fenced by registration generation and UI separates queue failures/discards', async () => {
  const old = store.getState().beginMonitor(); const next = store.getState().beginMonitor();
  const before = store.getState().monitor;
  store.getState().monitorProgress(old, { ...before, phase: 'failed', error: 'late', queuedBytes: 999 });
  assert.equal(store.getState().monitor, before); assert.equal(before.generation, next);
  const page = await readFile(new URL('../src/components/pages/MqttPage.tsx', import.meta.url), 'utf8');
  const hook = await readFile(new URL('../src/hooks/useMqttSession.ts', import.meta.url), 'utf8');
  assert.ok(page.includes('mqtt_sync_drops') && page.includes('mqtt_discards_help'));
  assert.ok(page.includes('restartMonitor()') && page.includes("monitor.phase !== 'live'"));
  assert.ok(hook.includes('monitorProgress(generation, progress)') && hook.includes('[epoch]'));
});

test('a terminal state during drain prevents remaining queued data from being delivered', async () => {
  let ended = false;
  const h = harness({ onMessage: (_, callbacks) => {
    if (!ended) { ended = true; callbacks.receiveState(state(3, 1, 'failed', 'during drain')); }
  } });
  await flush(); h.message(message(1)); h.message(message(2));
  h.pending.resolve(state(2)); await flush();
  assert.deepEqual(h.publications.map(item => item.sequence), [1]);
  assert.equal(h.current.snapshot.status, 'failed');
  assert.equal(h.metrics.drops.obsolete, 1); h.stop();
});

test('synchronous snapshot failure also closes listeners and settles lifecycle completion', async () => {
  const errors = []; let stops = 0; const time = clock();
  const stop = startMqttMonitor({ state: async () => () => stops++, messages: async () => () => stops++,
    snapshot: () => { throw new Error('synchronous IPC failure'); }, apply: () => {}, message: () => {},
    error: error => errors.push(String(error)), schedule: time.schedule });
  await flush(); assert.equal(await stop.done, 'failed');
  assert.equal(stops, 2); assert.equal(errors.length, 1); assert.equal(time.timers.size, 0);
});

test('store independently rejects a future/missing message revision without consuming its sequence', () => {
  store.setState({ ...emptyMqttRetention(), snapshot: state(2), lastSequence: 0 });
  store.getState().applyMessage(message(1, [255], 1, 3));
  store.getState().applyMessage({ ...message(1), state_revision: undefined });
  assert.equal(store.getState().lastSequence, 0); assert.equal(store.getState().messages.length, 0);
  store.getState().applyMessage(message(1, [0, 255], 1, 2));
  assert.equal(store.getState().messages.length, 1);
  assert.deepEqual(store.getState().messages[0].payload_bytes, [0, 255]);
});
