import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { format } from 'node:util';
import ts from 'typescript';

// Exercise the actual Zustand store with a browser-compatible storage double.
// Use the installed TypeScript compiler; no new test dependency is required.
const directory = await mkdtemp(join(process.cwd(), 'node_modules', '.mqtt-credentials-'));
after(() => rm(directory, { recursive: true, force: true }));
const source = await readFile(new URL('../src/stores/mqttStore.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText.replace('../lib/mqttTransport', './mqttTransport.mjs');
await writeFile(join(directory, 'mqttTransport.mjs'), ts.transpileModule(
  await readFile(new URL('../src/lib/mqttTransport.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } },
).outputText);
const modulePath = join(directory, 'store.mjs');
await writeFile(modulePath, compiled);
const values = new Map();
const writes = [];
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value); writes.push(value); },
  removeItem: (key) => values.delete(key),
};
const { useMqttStore: store } = await import(pathToFileURL(modulePath).href);
const key = 'serialhub-mqtt-profiles';
const secret = 'FAKE-MQTT-password-731!';
const profile = {
  id: 'legacy-id', name: 'Teste PAIC', broker: 'localhost', port: 8883,
  clientId: 'paic-test', username: 'fake-user', savedTopics: ['sensor/#', 'status'],
  caFilePath: 'C:/fake/ca.pem', certFilePath: 'C:/fake/cert.pem', keyFilePath: 'C:/fake/key.pem',
  lwtTopic: 'status/offline', lwtPayload: 'offline', lwtQos: 2, lwtRetain: true,
  useWebsockets: true, futureSetting: { preserve: true },
  transport: 'wss', transportNeedsReview: false,
};

async function load(value) {
  store.setState({ profiles: [] });
  values.clear();
  writes.length = 0;
  if (value !== undefined) values.set(key, JSON.stringify(value));
  await store.persist.rehydrate();
}

for (const version of [0, undefined]) {
  test(`legacy hydration removes only password and rewrites storage (version ${version})`, async () => {
    const legacy = { state: { profiles: [{ ...profile, password: secret }, { ...profile, id: 'no-password' }], otherState: 'keep' }, extraEnvelope: 'keep' };
    if (version !== undefined) legacy.version = version;
    await load(legacy);
    const expected = structuredClone(legacy);
    delete expected.state.profiles[0].password;
    assert.equal(store.persist.hasHydrated(), true);
    assert.deepEqual(store.getState().profiles, expected.state.profiles);
    assert.deepEqual(JSON.parse(values.get(key)), expected);
    assert.equal(writes.length, 1);
    assert.equal(values.get(key).includes(secret), false);
    await store.persist.rehydrate();
    assert.equal(writes.length, 1, 'clean hydration is idempotent');
  });
}

test('add/update/remove preserve settings without persisting or logging a supplied password', async () => {
  await load();
  const logs = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  for (const method of Object.keys(original)) console[method] = (...args) => logs.push(format(...args));
  try {
    const { id: _id, ...settings } = profile;
    store.getState().addProfile({ ...settings, password: secret });
    const added = store.getState().profiles[0];
    assert.deepEqual(added, { ...settings, id: added.id });
    store.getState().updateProfile(added.id, { port: 8000, password: secret });
    assert.deepEqual(store.getState().profiles[0], { ...added, port: 8000 });
    assert.deepEqual(JSON.parse(values.get(key)).state.profiles, [{ ...added, port: 8000 }]);
    store.getState().removeProfile(added.id);
    assert.deepEqual(JSON.parse(values.get(key)).state.profiles, []);
  } finally {
    Object.assign(console, original);
  }
  assert.equal(writes.some((value) => value.includes(secret) || value.includes('"password"')), false);
  assert.equal(logs.join('\n').includes(secret), false);
});

test('persistence boundary strips passwords even from direct setState', async () => {
  await load();
  store.setState({ profiles: [{ ...profile, password: secret }] });
  assert.deepEqual(JSON.parse(values.get(key)).state.profiles, [profile]);
  assert.equal(values.get(key).includes(secret), false);
});

test('already clean profiles are preserved without a rewrite', async () => {
  const clean = { state: { profiles: [profile] }, version: 0 };
  await load(clean);
  assert.deepEqual(store.getState().profiles, [profile]);
  assert.deepEqual(JSON.parse(values.get(key)), clean);
  assert.equal(writes.length, 0);
});

test('invalid JSON is not overwritten or logged', async () => {
  await load();
  values.set(key, '{invalid JSON');
  await store.persist.rehydrate();
  assert.equal(store.persist.hasHydrated(), false);
  assert.equal(values.get(key), '{invalid JSON');
  assert.equal(writes.length, 0);
});

test('page keeps password input/IPC but never passes connection credentials to console (static check)', async () => {
  const page = await readFile(new URL('../src/components/pages/MqttPage.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('MqttPage.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function inspect(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(ast) === 'console') {
      for (const argument of node.arguments) {
        assert.doesNotMatch(argument.getText(ast), /\b(connectionParams|password|username)\b/);
      }
    }
    ts.forEachChild(node, inspect);
  }
  inspect(ast);
  assert.match(page, /setPassword\(""\)/);
  assert.match(page, /password: password \|\| null/);
  assert.ok(page.includes('mqttCommands.connect(connectionParams)'), 'credentials must reach the session controller');
  const commands = await readFile(new URL('../src/lib/mqttCommands.ts', import.meta.url), 'utf8');
  assert.ok(commands.includes("invoke('connect_mqtt', { ...config, expectedSessionId: id })"));
  assert.doesNotMatch(page, /p\.password/);
});
