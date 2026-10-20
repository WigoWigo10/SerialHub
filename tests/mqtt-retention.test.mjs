import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const directory = await mkdtemp(join(process.cwd(), 'node_modules', '.mqtt-retention-'));
after(() => rm(directory, { recursive: true, force: true }));
for (const name of ['mqttPayload', 'mqttLimits', 'mqttTree', 'mqttRetention', 'mqttMonitor']) {
  const text = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
  await writeFile(join(directory, `${name}.mjs`), ts.transpileModule(text, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
  } }).outputText.replace(/(?:\.\.\/lib\/|\.\/)(mqttPayload|mqttLimits|mqttTree|mqttRetention|mqttMonitor)(['"])/g, './$1.mjs$2'));
}
await writeFile(join(directory, 'store.mjs'), ts.transpileModule(await readFile(new URL('../src/stores/mqttSessionStore.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText.replace(/(?:\.\.\/lib\/|\.\/)(mqttPayload|mqttLimits|mqttTree|mqttRetention|mqttMonitor)(['"])/g, './$1.mjs$2'));
const load = name => import(pathToFileURL(join(directory, `${name}.mjs`)).href);
const { MQTT_LIMITS: limits, mqttTopicFits } = await load('mqttLimits');
const { emptyMqttRetention, retainMqttMessage, addMqttChart } = await load('mqttRetention');
const { treeNodeCopyValue, treeChildren, removeTopicTree } = await load('mqttTree');
const { useMqttSessionStore: store } = await load('store');
const bytes = text => [...new TextEncoder().encode(text)];
const event = (sequence, topic = 'topic', payload_bytes = bytes(String(sequence)), session_id = 1) => ({ sequence, state_revision: 1, topic, payload_bytes, session_id, qos: 0 });
const reset = () => store.setState({ ...emptyMqttRetention(), snapshot: { revision: 1, session_id: 1, status: 'connected', error: null }, lastSequence: 0, subscriptions: [] });
const send = (...args) => store.getState().applyMessage(event(...args));
const nodeAt = (tree, topic) => topic.split('/').reduce((node, part) => node?.children[part], tree);
function bounded(state) {
  assert.ok(state.messages.length <= limits.historyMessages);
  assert.ok(state.historyBytes <= limits.historyBytes);
  assert.equal(state.historyBytes, state.messages.reduce((sum, message) => sum + message.payload_bytes.length, 0));
  assert.ok(state.latest.size <= limits.latestTopics);
  assert.ok(state.latestBytes <= limits.latestBytes);
  assert.equal(state.latestBytes, [...state.latest.values()].reduce((sum, message) => sum + message.payload_bytes.length, 0));
  assert.ok(state.charts.size <= limits.charts);
  for (const series of state.charts.values()) assert.ok(series.samples.length <= limits.chartSamples);
  for (const [topic, message] of state.latest) assert.equal(nodeAt(state.tree, topic).originalBytes, message.payload_bytes);
}

test('FIFO history count and latest state are independent; repeated topic stays bounded', () => {
  let state = emptyMqttRetention();
  for (let i = 1; i <= limits.historyMessages + 7; i++) {
    state = retainMqttMessage(state, event(i), i); bounded(state);
  }
  assert.equal(state.messages[0].sequence, 8);
  assert.equal(state.discards.history, 7);
  assert.equal(state.latest.size, 1);
  assert.equal(state.latest.get('topic').sequence, limits.historyMessages + 7);
});

test('a last value survives the removal of its message from history', () => {
  let state = retainMqttMessage(emptyMqttRetention(), event(1, 'stable', [0, 255, 195, 169]));
  const stable = state.latest.get('stable');
  for (let i = 2; i <= limits.historyMessages + 2; i++) state = retainMqttMessage(state, event(i, 'busy'));
  assert.ok(!state.messages.includes(stable));
  assert.equal(state.latest.get('stable'), stable);
  assert.equal(treeNodeCopyValue(nodeAt(state.tree, 'stable'), 'HEX'), '00 FF C3 A9');
  bounded(state);
});

test('history byte budget evicts complete messages, never byte prefixes', () => {
  let state = emptyMqttRetention();
  const payload = Array(limits.payloadBytes).fill(255);
  const count = limits.historyBytes / limits.payloadBytes;
  for (let i = 1; i <= count + 1; i++) state = retainMqttMessage(state, event(i, 'binary', payload));
  assert.equal(state.messages.length, count);
  assert.equal(state.messages[0].sequence, 2);
  assert.equal(state.historyBytes, limits.historyBytes);
  assert.equal(state.discards.history, 1);
  assert.deepEqual(state.latest.get('binary').payload_bytes, payload);
  bounded(state);
});

test('new zero-byte topics obey topic count and LRU-by-update eviction', () => {
  let state = emptyMqttRetention();
  for (let i = 0; i < limits.latestTopics; i++) state = retainMqttMessage(state, event(i + 1, `t/${i}`, []));
  state = retainMqttMessage(state, event(1000, 't/0', []));
  state = retainMqttMessage(state, event(1001, 'new', []));
  assert.ok(state.latest.has('t/0'));
  assert.ok(!state.latest.has('t/1'));
  assert.equal(nodeAt(state.tree, 't/1'), undefined);
  assert.equal(state.discards.topics, 1);
  assert.equal(state.latestBytes, 0);
  bounded(state);
});

test('latest byte budget evicts whole topics and their derived JSON/graphs', () => {
  let state = emptyMqttRetention();
  state = retainMqttMessage(state, event(1, 'first', bytes('{"value":7}')));
  state.charts = addMqttChart(state, 'first.value');
  const payload = Array(limits.payloadBytes).fill(255);
  const count = limits.latestBytes / limits.payloadBytes;
  for (let i = 0; i < count; i++) state = retainMqttMessage(state, event(i + 2, `large/${i}`, payload));
  assert.ok(!state.latest.has('first'));
  assert.equal(nodeAt(state.tree, 'first'), undefined);
  assert.equal(state.charts.size, 0);
  assert.equal(state.latestBytes, limits.latestBytes);
  assert.equal(state.discards.topics, 1);
  bounded(state);
});

test('an oversized publication is rejected atomically, consumes its sequence and keeps the last retained value', () => {
  reset(); send(1, 'topic', [0, 255]);
  const before = store.getState();
  send(2, 'topic', Array(limits.payloadBytes + 1).fill(1));
  const after = store.getState();
  assert.equal(after.messages, before.messages);
  assert.equal(after.latest, before.latest);
  assert.equal(after.tree, before.tree);
  assert.equal(after.discards.payloads, 1);
  assert.equal(after.lastSequence, 2);
  send(2, 'topic', []);
  assert.equal(store.getState().messages.length, 1);
  send(3, 'topic', []);
  assert.equal(store.getState().latestBytes, 0);
  assert.equal(treeNodeCopyValue(nodeAt(store.getState().tree, 'topic'), 'HEX'), '');
  bounded(store.getState());
});

test('topic UTF-8 bytes and depth are bounded without blocking special names or valid empty levels', () => {
  reset();
  const long = 'é'.repeat(limits.topicBytes / 2 + 1);
  assert.equal(mqttTopicFits(long), false);
  send(1, long, []);
  send(2, Array(limits.topicLevels + 1).fill('').join('/'), []);
  assert.equal(store.getState().discards.topicShape, 2);
  assert.equal(store.getState().latest.size, 0);
  for (const [i, topic] of ['__proto__/constructor/toString', '/a//', 'prototype/hasOwnProperty'].entries()) send(i + 3, topic, [255, 0]);
  assert.equal(store.getState().latest.size, 3);
  assert.equal(Object.getPrototypeOf(store.getState().tree.children), null);
  bounded(store.getState());
});

test('incremental tree retains unrelated branches and prunes evicted paths without touching real children', () => {
  let state = retainMqttMessage(emptyMqttRetention(), event(1, 'a/child', [49]));
  state = retainMqttMessage(state, event(2, 'a', bytes('{"child":2}')));
  state = retainMqttMessage(state, event(3, 'other', [51]));
  const other = state.tree.children.other;
  const prior = state.tree;
  state = retainMqttMessage(state, event(4, 'a', bytes('{"constructor":4}')));
  assert.equal(state.tree.children.other, other);
  assert.equal(prior.children.a.jsonChildren.child.value, '2', 'previous snapshots are immutable');
  assert.equal(state.tree.children.a.jsonChildren.child, undefined);
  let tree = removeTopicTree(state.tree, 'a');
  assert.equal(tree.children.a.originalBytes, undefined);
  assert.equal(tree.children.a.children.child.value, '1');
  assert.equal(Object.keys(tree.children.a.jsonChildren).length, 0);
  tree = removeTopicTree(tree, 'a/child');
  assert.equal(tree.children.a, undefined);
  assert.equal(tree.children.other, other);
});

test('graph count and samples stay bounded; hidden/removed series do not accumulate', () => {
  reset();
  for (let i = 0; i < limits.charts + 1; i++) send(i + 1, `g${i}`, [49]);
  for (let i = 0; i < limits.charts; i++) assert.equal(store.getState().addChart(`g${i}`), true);
  assert.equal(store.getState().addChart(`g${limits.charts}`), false);
  for (let i = 0; i < limits.chartSamples + 5; i++) send(i + 10, 'g0', bytes(String(i)));
  let series = store.getState().charts.get('g0');
  assert.equal(series.samples.length, limits.chartSamples);
  assert.equal(series.samples.at(-1).value, limits.chartSamples + 4);
  assert.ok(!('payload_bytes' in series));
  store.getState().removeChart('g0');
  assert.equal(store.getState().charts.has('g0'), false);
  assert.equal(store.getState().addChart(`g${limits.charts}`), true);
  bounded(store.getState());
});

test('JSON-derived graph is released when its field disappears or becomes invalid UTF-8', () => {
  reset(); send(1, 'data', bytes('{"__proto__":{"value":9}}'));
  assert.equal(store.getState().addChart('data.__proto__.value'), true);
  send(2, 'data', bytes('{}'));
  assert.equal(store.getState().charts.size, 0);
  send(3, 'data', bytes('{"value":3}'));
  assert.equal(store.getState().addChart('data.value'), true);
  send(4, 'data', [255]);
  assert.equal(store.getState().charts.size, 0);
});

test('a numeric field replaced by an object with coercion-name collisions cannot break ingestion', () => {
  reset(); send(1, 'json', bytes('{"value":42}'));
  assert.equal(store.getState().addChart('json.value'), true);
  assert.doesNotThrow(() => send(2, 'json', bytes('{"value":{"toString":null,"constructor":1,"__proto__":2}}')));
  assert.equal(store.getState().charts.size, 0);
  bounded(store.getState());
});

test('bounded JSON expansion indicates its limit while copy/HEX preserve full original bytes', () => {
  const text = JSON.stringify(Object.fromEntries(Array.from({ length: limits.jsonNodes + 10 }, (_, i) => [`k${i}`, i])));
  let state = retainMqttMessage(emptyMqttRetention(), event(1, 'json', bytes(text)));
  let node = state.tree.children.json;
  assert.equal(node.jsonTruncated, true);
  assert.equal(treeChildren(node).length, limits.jsonNodes);
  assert.equal(treeNodeCopyValue(node, 'ASCII'), text);
  assert.deepEqual(node.originalBytes, bytes(text));
  let nested = 1;
  for (let i = 0; i < limits.jsonDepth + 5; i++) nested = { x: nested };
  state = retainMqttMessage(state, event(2, 'json', bytes(JSON.stringify(nested))));
  node = state.tree.children.json;
  assert.equal(node.jsonTruncated, true);
  let count = 0;
  while (node.jsonChildren.x) { count++; node = node.jsonChildren.x; }
  assert.equal(count, limits.jsonDepth);
  assert.equal(state.tree.children.json.originalValue, JSON.stringify(nested));
});

test('a graph for a field no longer in the bounded JSON expansion is released', () => {
  reset(); send(1, 'json', bytes('{"target":42}'));
  assert.equal(store.getState().addChart('json.target'), true);
  const fields = Object.fromEntries(Array.from({ length: limits.jsonNodes }, (_, i) => [`k${i}`, i]));
  fields.target = 7;
  send(2, 'json', bytes(JSON.stringify(fields)));
  assert.equal(store.getState().charts.size, 0);
  assert.equal(store.getState().addChart('json.target'), false);
});

test('history clear and latest clear are separate and never permit replay', () => {
  reset(); send(1); store.getState().addChart('topic');
  const tree = store.getState().tree;
  store.getState().clearMessages();
  assert.equal(store.getState().historyBytes, 0);
  assert.equal(store.getState().tree, tree);
  assert.equal(store.getState().charts.size, 1);
  send(1); assert.equal(store.getState().messages.length, 0);
  send(2);
  const history = store.getState().messages;
  store.getState().clearLatest();
  assert.equal(store.getState().messages, history);
  assert.equal(store.getState().latest.size, 0);
  assert.equal(store.getState().latestBytes, 0);
  assert.equal(Object.keys(store.getState().tree.children).length, 0);
  assert.equal(store.getState().charts.size, 0);
  send(2); assert.equal(store.getState().latest.size, 0);
  send(3); assert.equal(store.getState().latest.size, 1);
});

test('disconnect freezes inspection state; a new attempt clears it and rejects all old-session events', () => {
  reset(); send(1); store.getState().addChart('topic');
  store.getState().applySnapshot({ revision: 2, session_id: 1, status: 'disconnected', error: null });
  send(2); assert.equal(store.getState().messages.length, 1);
  assert.equal(store.getState().charts.size, 1);
  store.getState().applySnapshot({ revision: 3, session_id: 2, status: 'connecting', error: null });
  assert.equal(store.getState().messages.length, 0);
  assert.equal(store.getState().latest.size, 0);
  assert.equal(store.getState().charts.size, 0);
  assert.deepEqual(store.getState().discards, { history: 0, topics: 0, payloads: 0, topicShape: 0 });
  store.getState().applySnapshot({ revision: 4, session_id: 2, status: 'connected', error: null });
  const before = store.getState();
  send(999, 'old', [], 1);
  store.getState().applySnapshot({ revision: 1000, session_id: 1, status: 'failed', error: 'old' });
  assert.equal(store.getState(), before);
  send(1, 'new', [0, 255], 2); bounded(store.getState());
});

test('subscriptions are finite, session fenced, and released on disconnect', () => {
  reset();
  for (let i = 0; i < limits.subscriptions + 5; i++) store.getState().subscription(1, `s/${i}`, true);
  assert.equal(store.getState().subscriptions.length, limits.subscriptions);
  store.getState().subscription(1, 's/0', true);
  store.getState().subscription(0, 'old', true);
  assert.equal(store.getState().subscriptions.length, limits.subscriptions);
  store.getState().subscription(1, 's/0', false);
  store.getState().subscription(1, 'new', true);
  assert.equal(store.getState().subscriptions.length, limits.subscriptions);
  store.getState().applySnapshot({ revision: 2, session_id: 1, status: 'disconnected', error: null });
  assert.equal(store.getState().subscriptions.length, 0);
});

test('page consumes retained tree and global series, never replays historical messages (static wiring)', async () => {
  const page = await readFile(new URL('../src/components/pages/MqttPage.tsx', import.meta.url), 'utf8');
  const tree = await readFile(new URL('../src/components/mqtt/TopicTree.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes('tree={tree}') && page.includes('charts.get(topic)?.samples'));
  assert.ok(!page.includes('processedMessages') && !page.includes('setChartHistory') && !page.includes('messages.slice('));
  assert.ok(!tree.includes('buildTree') && !tree.includes('messages'));
  assert.ok(page.includes('mqtt_discards_help') && page.includes('.clearMessages()') && page.includes('.clearLatest()'));
});
