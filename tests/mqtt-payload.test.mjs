import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const directory = await mkdtemp(join(process.cwd(), 'node_modules', '.mqtt-payload-'));
after(() => rm(directory, { recursive: true, force: true }));
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React,
} }).outputText;
const payloadSource = await readFile(new URL('../src/lib/mqttPayload.ts', import.meta.url), 'utf8');
await writeFile(join(directory, 'mqttPayload.mjs'), compile(payloadSource));
await writeFile(join(directory, 'store.mjs'), compile(await readFile(new URL('../src/stores/mqttSessionStore.ts', import.meta.url), 'utf8'))
  .replace(/(?:\.\.\/lib\/|\.\/)(mqttPayload|mqttLimits|mqttTree|mqttRetention|mqttMonitor)(['"])/g, './$1.mjs$2'));
for (const name of ['mqttLimits', 'mqttTree', 'mqttRetention', 'mqttMonitor']) {
  await writeFile(join(directory, `${name}.mjs`), compile(await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8'))
    .replace(/(?:\.\.\/lib\/|\.\/)(mqttPayload|mqttLimits|mqttTree|mqttRetention|mqttMonitor)(['"])/g, './$1.mjs$2'));
}
const { decodeMqttPayload, toMqttHex, isMqttPayloadBytes } = await import(pathToFileURL(join(directory, 'mqttPayload.mjs')).href);
const { useMqttSessionStore: store } = await import(pathToFileURL(join(directory, 'store.mjs')).href);
const treeModule = await import(pathToFileURL(join(directory, 'mqttTree.mjs')).href);
const { emptyMqttRetention, chartValue } = await import(pathToFileURL(join(directory, 'mqttRetention.mjs')).href);
const source = await readFile(new URL('../src/components/mqtt/TopicTree.tsx', import.meta.url), 'utf8');
const toasts = [];
const toast = { success: (...args) => toasts.push(['success', ...args]), error: (...args) => toasts.push(['error', ...args]) };
const icons = Object.fromEntries(['ChevronRight', 'ChevronDown', 'Folder', 'Copy', 'Hash', 'AlignLeft', 'Braces', 'LineChart', 'Binary']
  .map(name => [name, () => React.createElement('i', { 'data-icon': name })]));
const context = vm.createContext({ React, ...icons, useState: React.useState, useMemo: React.useMemo, useEffect: React.useEffect,
  useLanguage: () => ({ t: key => key }), ...treeModule, decodeMqttPayload, toMqttHex, toast, navigator: { clipboard: {} } });
vm.runInContext(compile(source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')), context);
const { buildTree, treeChildren, treeNodeCopyValue } = treeModule;
const TopicTree = vm.runInContext('TopicTree', context);
const bytes = text => [...new TextEncoder().encode(text)];
const msg = (payload_bytes, topic = 'topic') => ({ topic, payload_bytes, timestamp: 'T' });
const cases = [
  ['ASCII', bytes('Hello'), 'Hello', '48 65 6C 6C 6F', true],
  ['accent', [0xc3, 0xa9], 'é', 'C3 A9', true],
  ['emoji', [0xf0, 0x9f, 0x98, 0x80], '😀', 'F0 9F 98 80', true],
  ['empty', [], '', '', true],
  ['zero', [0], '\0', '00', true],
  ['non UTF-8', [0xff, 0x80, 0xc3, 0x28], '���(', 'FF 80 C3 28', false],
  ['line endings', [13, 10, 10, 13], '\r\n\n\r', '0D 0A 0A 0D', true],
  ['BOM', [0xef, 0xbb, 0xbf, 65], '\uFEFFA', 'EF BB BF 41', true],
];

for (const [name, payload, text, hex, isUtf8] of cases) {
  test(`${name}: real decoder, tree and copy retain original bytes`, () => {
    const decoded = decodeMqttPayload(payload);
    assert.deepEqual(decoded, { text, isUtf8 });
    assert.equal(toMqttHex(payload), hex);
    const node = buildTree([msg(payload)]).children.topic;
    assert.deepEqual(Array.from(node.originalBytes), payload);
    assert.equal(node.originalValue, text);
    assert.equal(treeNodeCopyValue(node, 'HEX'), hex);
    assert.equal(treeNodeCopyValue(node, 'ASCII'), text);
    const rendered = renderToStaticMarkup(React.createElement(TopicTree, { tree: buildTree([msg(payload)]), viewMode: 'HEX' }));
    assert.ok(rendered.includes(hex || 'mqtt_payload_empty'));
  });
}

test('all 256 byte values survive JSON IPC, real store and HEX round-trip', () => {
  store.setState({ ...emptyMqttRetention(), snapshot: { revision: 1, session_id: 9, status: 'connected', error: null }, messages: [], lastSequence: 0 });
  const original = Array.from({ length: 256 }, (_, index) => index);
  const received = JSON.parse(JSON.stringify({ session_id: 9, sequence: 1, state_revision: 1, topic: '__proto__', qos: 2, payload_bytes: original }));
  store.getState().applyMessage(received);
  received.payload_bytes.fill(0);
  const saved = store.getState().messages[0];
  assert.deepEqual(saved.payload_bytes, original, 'the store owns its byte array');
  assert.equal(saved.payloadIsUtf8, false);
  assert.equal(saved.session_id, 9);
  assert.equal(saved.sequence, 1);
  assert.equal(saved.qos, 2);
  assert.equal(saved.payload, decodeMqttPayload(original).text);
  const hex = treeNodeCopyValue(buildTree([saved]).children['__proto__'], 'HEX');
  assert.match(hex, /^(?:[0-9A-F]{2} ){255}[0-9A-F]{2}$/);
  assert.deepEqual(hex.split(' ').map(value => parseInt(value, 16)), original);
});

test('each MQTT publication is decoded independently, never as streaming text', () => {
  store.setState({ ...emptyMqttRetention(), snapshot: { revision: 1, session_id: 1, status: 'connected', error: null }, messages: [], lastSequence: 0 });
  for (const [index, payload_bytes] of [[0xc3], [0xa9], [0xc3, 0xa9]].entries()) {
    store.getState().applyMessage({ ...msg(payload_bytes), session_id: 1, state_revision: 1, sequence: index + 1, qos: 0 });
  }
  assert.deepEqual(store.getState().messages.map(message => message.payload), ['�', '�', 'é']);
  assert.deepEqual(store.getState().messages.map(message => message.payload_bytes), [[0xc3], [0xa9], [0xc3, 0xa9]]);
});

test('invalid byte contracts are rejected without consuming a sequence or accepting legacy text', () => {
  store.setState({ ...emptyMqttRetention(), snapshot: { revision: 1, session_id: 1, status: 'connected', error: null }, messages: [], lastSequence: 0 });
  for (const payload_bytes of [undefined, '42', [-1], [256], [1.5], [NaN], [null]]) {
    assert.equal(isMqttPayloadBytes(payload_bytes), false);
    store.getState().applyMessage({ session_id: 1, state_revision: 1, sequence: 1, topic: 'x', payload: 'lossy legacy', payload_bytes, qos: 0 });
  }
  assert.equal(store.getState().messages.length, 0);
  assert.equal(store.getState().lastSequence, 0);
  store.getState().applyMessage({ session_id: 1, state_revision: 1, sequence: 1, topic: 'x', payload_bytes: [], qos: 0 });
  assert.equal(store.getState().messages.length, 1);
});

test('JSON expansion is text-only; HEX copies lexical payload, not reserialized JSON fields', () => {
  const payload = bytes(' { "constructor": {"__proto__": "\\u00e9"}, "prototype": 4 }\r\n');
  const node = buildTree([msg(payload), msg(bytes('42'), 'topic/constructor')]).children.topic;
  assert.equal(node.jsonChildren.constructor.jsonChildren['__proto__'].value, 'é');
  assert.equal(treeChildren(node, 'ASCII').length, 3);
  assert.equal(treeChildren(node, 'HEX').length, 1);
  assert.equal(treeNodeCopyValue(node, 'HEX'), toMqttHex(payload));
  assert.equal(treeNodeCopyValue(node.jsonChildren.constructor, 'HEX'), undefined);
  assert.equal(treeNodeCopyValue(node.jsonChildren.constructor.jsonChildren['__proto__'], 'ASCII'), 'é');
  const markup = renderToStaticMarkup(React.createElement(TopicTree, { tree: buildTree([msg(payload)]), viewMode: 'HEX' }));
  assert.ok(!markup.includes('>constructor<'), 'derived JSON fields do not impersonate MQTT byte payloads');
  assert.equal(Object.getPrototypeOf(node.jsonChildren), null);
  assert.equal(Object.prototype.polluted, undefined);
});

test('binary, invalid JSON and changing display modes do not throw or mutate bytes', () => {
  const messages = [msg([123, 34, 120, 34, 58, 34, 255, 34, 125]), msg(bytes('{invalid'), 'bad'), msg([], 'empty')];
  const before = JSON.stringify(messages);
  assert.equal(buildTree(messages).children.topic.isJson, false, 'replacement text is not interpreted as valid JSON');
  for (const viewMode of ['ASCII', 'HEX', 'ASCII']) {
    assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(TopicTree, { tree: buildTree(messages), viewMode })));
  }
  assert.equal(JSON.stringify(messages), before);
});

test('an empty interpreted JSON string is not labeled as an empty MQTT publication', () => {
  const markup = renderToStaticMarkup(React.createElement(TopicTree, {
    tree: buildTree([msg(bytes('{"value":""}'))]), viewMode: 'ASCII',
  }));
  assert.ok(!markup.includes('mqtt_payload_empty'));
  assert.ok(markup.includes('&quot;&quot;'));
});

// Execute the actual click callback, including clipboard completion/error behavior.
const ast = ts.createSourceFile('TopicTree.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let copyCallback;
function find(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleCopy') copyCallback = node.initializer.getText(ast);
  ts.forEachChild(node, find);
}
find(ast);
vm.runInContext(compile(`const actualCopy = ${copyCallback};`), context);

test('real clipboard callback awaits success, handles empty bytes and reports failures', async () => {
  context.node = buildTree([msg([])]).children.topic;
  context.viewMode = 'HEX'; context.t = key => key;
  let finish; const written = [];
  context.navigator.clipboard.writeText = value => { written.push(value); return new Promise(resolve => { finish = resolve; }); };
  toasts.length = 0;
  const pending = vm.runInContext('actualCopy({stopPropagation(){}})', context);
  assert.deepEqual(written, ['']); assert.equal(toasts.length, 0);
  finish(); await pending; assert.equal(toasts[0][0], 'success');
  toasts.length = 0;
  context.navigator.clipboard.writeText = async () => { throw new Error('denied'); };
  await vm.runInContext('actualCopy({stopPropagation(){}})', context);
  assert.equal(toasts.length, 1); assert.equal(toasts[0][0], 'error');
  assert.equal(toasts[0][1], 'mqtt_copy_failed');
});

test('clipboard uses original bytes in HEX and replacement text only in text mode', async () => {
  context.node = buildTree([msg([0xc3, 0xa9, 0, 255])]).children.topic;
  context.t = key => key;
  const written = [];
  context.navigator.clipboard.writeText = async value => { written.push(value); };
  for (const mode of ['HEX', 'ASCII']) {
    context.viewMode = mode;
    await vm.runInContext('actualCopy({stopPropagation(){}})', context);
  }
  assert.deepEqual(written, ['C3 A9 00 FF', 'é\0�']);
});

test('deep derived JSON copy failures are reported without an unhandled rejection', async () => {
  const json = '{"x":'.repeat(10000) + '1' + '}'.repeat(10000);
  context.node = buildTree([msg(bytes(json))]).children.topic.jsonChildren.x;
  context.viewMode = 'ASCII'; context.t = key => key;
  toasts.length = 0;
  context.navigator.clipboard.writeText = async () => { throw new Error('should not be called'); };
  await assert.doesNotReject(() => vm.runInContext('actualCopy({stopPropagation(){}})', context));
  assert.equal(toasts[0][0], 'error');
});

test('real chart consumer accepts text/JSON and ignores invalid UTF-8 and inherited fields', () => {
  for (const [payload_bytes, fieldPath, expected] of [
    [bytes('42'), [], 42],
    [bytes('{"constructor":{"__proto__":7}}'), ['constructor', '__proto__'], 7],
    [[52, 50, 255], [], undefined],
    [[123, 34, 120, 34, 58, 255, 125], ['x'], undefined],
    [bytes('{invalid'), ['x'], undefined],
    [bytes('{}'), ['constructor', 'prototype'], undefined],
    [[], [], undefined],
  ]) {
    const decoded = decodeMqttPayload(payload_bytes);
    assert.equal(chartValue({ ...msg(payload_bytes), payload: decoded.text, payloadIsUtf8: decoded.isUtf8 }, fieldPath), expected);
  }
});
