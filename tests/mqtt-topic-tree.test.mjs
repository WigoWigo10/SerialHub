import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the production functions, not a duplicate tree implementation.
const source = await readFile(new URL('../src/components/mqtt/TopicTree.tsx', import.meta.url), 'utf8');
const pureSource = source.slice(source.indexOf('const childDictionary'), source.indexOf('const TreeNodeItem'));
assert.ok(pureSource.includes('const buildTree') && pureSource.includes('const processJsonToTree'));
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const code = compile(pureSource);
const page = await readFile(new URL('../src/components/pages/MqttPage.tsx', import.meta.url), 'utf8');
const pageAst = ts.createSourceFile('MqttPage.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const historyUpdaters = [];
function visit(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === 'setChartHistory' && ts.isArrowFunction(node.arguments[0])) {
    historyUpdaters.push(node.arguments[0].getText(pageAst));
  }
  ts.forEachChild(node, visit);
}
visit(pageAst);
assert.ok(historyUpdaters[0].includes('prevHistory') && historyUpdaters[1].includes('initialData'));

function isolated(check) {
  const context = vm.createContext({});
  const descriptors = () => vm.runInContext('[Object.getOwnPropertyDescriptors(Object.prototype), Object.getOwnPropertyDescriptors(Function.prototype)]', context);
  const before = descriptors();
  const hostBefore = Object.getOwnPropertyDescriptors(Object.prototype);
  vm.runInContext(code, context);
  const api = vm.runInContext('({buildTree, treeChildren, treeNodeKey})', context);
  try { check(api, context); }
  finally {
    assert.deepEqual(descriptors(), before, 'VM prototypes must remain unchanged');
    assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), hostBefore, 'host prototype must remain unchanged');
  }
}
const msg = (topic, payload = '42', timestamp = 'T') => ({ topic, payload, timestamp });
const names = ['__proto__', 'proto', 'constructor', 'prototype', 'toString', 'hasOwnProperty'];
function verifyDictionaries(node) {
  assert.equal(Object.getPrototypeOf(node.children), null);
  assert.equal(Object.getPrototypeOf(node.jsonChildren), null);
  for (const child of [...Object.values(node.children), ...Object.values(node.jsonChildren)]) verifyDictionaries(child);
}

test('ordinary topics preserve hierarchy, latest payload, timestamp and JSON expansion', () => isolated(({ buildTree, treeChildren }) => {
  const tree = buildTree([msg('room/temp', '20'), msg('room/humidity', '60'), msg('room/temp', '21', 'later'), msg('room', '{"sensor":{"value":3}}')]);
  assert.equal(tree.children.room.children.temp.value, '21');
  assert.equal(tree.children.room.children.temp.fullName, 'room/temp');
  assert.equal(tree.children.room.children.temp.timestamp, 'later');
  assert.equal(tree.children.room.jsonChildren.sensor.jsonChildren.value.value, '3');
  assert.equal(tree.children.room.jsonChildren.sensor.jsonChildren.value.fullName, 'room.sensor.value');
  assert.equal(treeChildren(tree.children.room).length, 3);
  verifyDictionaries(tree);
}));

for (const name of names) {
  test(`topic segments treat ${name} literally at root and nested levels`, () => isolated(({ buildTree }) => {
    const tree = buildTree([msg(name), msg(`group/${name}/leaf`), msg(`${name}/${name}`, 'updated')]);
    assert.equal(tree.children[name].value, '42');
    assert.equal(tree.children.group.children[name].children.leaf.fullName, `group/${name}/leaf`);
    assert.equal(tree.children[name].children[name].value, 'updated');
    verifyDictionaries(tree);
  }));
  test(`JSON fields treat ${name} literally at multiple levels and inside arrays`, () => isolated(({ buildTree }) => {
    const payload = JSON.stringify({ [name]: { [name]: 7 }, list: [{ [name]: 'ok' }] });
    const node = buildTree([msg('data', payload)]).children.data;
    assert.equal(node.jsonChildren[name].jsonChildren[name].value, '7');
    assert.equal(node.jsonChildren.list.jsonChildren['0'].jsonChildren[name].value, 'ok');
    assert.equal(node.isJson, true);
    verifyDictionaries(node);
  }));
}

test('empty levels keep leading, trailing and consecutive slashes in fullName', () => isolated(({ buildTree }) => {
  const tree = buildTree([msg('/a'), msg('a//b'), msg('a/'), msg('/'), msg('//')]);
  assert.equal(tree.children[''].children.a.fullName, '/a');
  assert.equal(tree.children.a.children[''].children.b.fullName, 'a//b');
  assert.equal(tree.children.a.children[''].fullName, 'a/');
  assert.equal(tree.children[''].children[''].fullName, '/');
  assert.equal(tree.children[''].children[''].children[''].fullName, '//');
  verifyDictionaries(tree);
}));

test('received names cannot overwrite node metadata or child dictionaries', () => isolated(({ buildTree }) => {
  const internalNames = ['name', 'fullName', 'children', 'jsonChildren', 'value', 'originalValue', 'timestamp', 'isJson', 'isVirtual'];
  const payload = JSON.stringify(Object.fromEntries(internalNames.map(name => [name, { [name]: 5 }])));
  const tree = buildTree([msg('data', payload), ...internalNames.map(name => msg(`data/${name}`, 'topic'))]);
  const node = tree.children.data;
  assert.equal(node.name, 'data');
  assert.equal(node.fullName, 'data');
  assert.equal(node.originalValue, payload);
  assert.equal(node.timestamp, 'T');
  assert.equal(node.isJson, true);
  assert.equal(node.isVirtual, undefined);
  for (const name of internalNames) {
    assert.equal(node.children[name].value, 'topic');
    assert.equal(node.jsonChildren[name].jsonChildren[name].value, '5');
  }
  verifyDictionaries(tree);
}));

test('topic and JSON field with the same name coexist in either arrival order', () => isolated(({ buildTree, treeChildren, treeNodeKey }) => {
  for (const reverse of [false, true]) {
    const messages = [msg('root', '{"value":1,"__proto__":2}'), msg('root/value', 'topic'), msg('root/__proto__', 'other')];
    const tree = buildTree(reverse ? messages.reverse() : messages);
    const node = tree.children.root;
    assert.equal(node.children.value.value, 'topic');
    assert.equal(node.jsonChildren.value.value, '1');
    assert.equal(node.children.__proto__.value, 'other');
    assert.equal(node.jsonChildren.__proto__.value, '2');
    const keys = treeChildren(node).map(treeNodeKey);
    assert.equal(new Set(keys).size, 4, 'React sibling keys must be unique');
    verifyDictionaries(tree);
  }
}));

test('a literal topic and JSON field may share fullName without sharing React identity', () => isolated(({ buildTree, treeNodeKey }) => {
  const tree = buildTree([msg('a', '{"b":1}'), msg('a.b', '2')]);
  assert.equal(tree.children['a.b'].fullName, tree.children.a.jsonChildren.b.fullName);
  assert.notEqual(treeNodeKey(tree.children['a.b']), treeNodeKey(tree.children.a.jsonChildren.b));
}));

test('replacing a JSON payload removes stale fields but preserves real subtopics', () => isolated(({ buildTree }) => {
  const tree = buildTree([msg('a/value', 'topic'), msg('a', '{"value":{"old":1},"gone":2}'), msg('a', '{"value":3}')]);
  assert.equal(tree.children.a.children.value.value, 'topic');
  assert.equal(tree.children.a.jsonChildren.value.value, '3');
  assert.equal(Object.keys(tree.children.a.jsonChildren.value.jsonChildren).length, 0);
  assert.equal(Object.hasOwn(tree.children.a.jsonChildren, 'gone'), false);
  const text = buildTree([msg('a/value'), msg('a', '{"value":1}'), msg('a', 'plain')]).children.a;
  assert.equal(Object.keys(text.jsonChildren).length, 0);
  assert.equal(text.children.value.value, '42');
}));

test('primitive, null, malformed and empty JSON keep the existing display contract', () => isolated(({ buildTree }) => {
  for (const payload of ['null', 'true', '7', '"text"', '{invalid']) {
    const node = buildTree([msg('a', payload)]).children.a;
    assert.equal(node.value, payload);
    assert.equal(node.isJson, false);
    assert.equal(Object.keys(node.jsonChildren).length, 0);
  }
  for (const payload of ['{}', '[]']) {
    assert.equal(buildTree([msg('a', payload)]).children.a.value, '{ JSON }');
  }
  assert.equal(Object.keys(buildTree([]).children).length, 0);
}));

test('numeric-looking keys retain names and renderer traversal includes both namespaces', () => isolated(({ buildTree, treeChildren }) => {
  const node = buildTree([msg('a/01'), msg('a/1'), msg('a', '{"01":1,"1":2,"":3}')]).children.a;
  const names = treeChildren(node).map(child => child.name).sort();
  assert.deepEqual(Array.from(names), ['', '01', '01', '1', '1']);
  verifyDictionaries(node);
}));

test('chart consumers ignore inherited history and preserve literal own keys when appending', () => isolated((_, context) => {
  vm.runInContext(compile(`const initial = ${historyUpdaters[1]}; const receive = ${historyUpdaters[0]};`), context);
  for (const topic of names) {
    context.topic = topic;
    context.messages = [msg(topic, '1')];
    context.event = { payload: { topic, payload: '2' } };
    context.timeStr = 'T'; context.now = new Date(0);
    const check = vm.runInContext(`(() => {
      const empty = receive({});
      if (Object.hasOwn(empty, topic)) throw new Error('inherited topic treated as recorded');
      const history = receive(initial({}));
      return Object.hasOwn(history, topic) && history[topic].length === 2 && history[topic][1].value === 2;
    })()`, context);
    assert.equal(check, true, topic);
  }
}));

test('chart JSON traversal uses only own fields, including explicit __proto__ fields', () => isolated((_, context) => {
  context.timeStr = 'T'; context.now = new Date(0);
  vm.runInContext(compile(`const receive = ${historyUpdaters[0]}; const initial = ${historyUpdaters[1]};`), context);
  for (const name of names) {
    const fieldTopic = `sensor.${name}.value`;
    context.topic = 'sensor';
    context.event = { payload: { topic: 'sensor', payload: JSON.stringify({ [name]: { value: 9 } }) } };
    context.history = { [fieldTopic]: [] };
    const result = vm.runInContext('receive(history)', context);
    assert.equal(result[fieldTopic][0].value, 9);
    context.messages = [msg('sensor', context.event.payload.payload)];
    context.topic = fieldTopic;
    const initial = vm.runInContext('initial({})', context);
    assert.equal(initial[fieldTopic][0].value, 9);
  }
  context.topic = 'sensor';
  context.event = { payload: { topic: 'sensor', payload: '{}' } };
  const inherited = vm.runInContext(`receive({['sensor.constructor.prototype']: []})`, context);
  assert.equal(inherited['sensor.constructor.prototype'].length, 0);
}));

test('renderer uses combined children and namespace-aware keys at both levels (static wiring)', () => {
  assert.equal((source.match(/key=\{treeNodeKey\(child\)\}/g) || []).length, 2);
  assert.ok(source.includes('const children = treeChildren(node)'));
  assert.ok(source.includes('const children = treeChildren(tree)'));
});
