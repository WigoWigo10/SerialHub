import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const directory = await mkdtemp(join(process.cwd(), 'node_modules', '.mqtt-transport-'));
after(() => rm(directory, { recursive: true, force: true }));
for (const [source, output] of [['src/lib/mqttTransport.ts', 'mqttTransport.mjs'], ['src/stores/mqttStore.ts', 'mqttStore.mjs']]) {
  const input = await readFile(new URL(`../${source}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
    .replace('../lib/mqttTransport', './mqttTransport.mjs');
  await writeFile(join(directory, output), code);
}
const { migrateMqttTransport, mqttConfigurationError, isSecureTransport, mqttTransports } = await import(pathToFileURL(join(directory, 'mqttTransport.mjs')).href);
const values = new Map(); const writes = [];
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value); writes.push(value); },
  removeItem: key => values.delete(key),
};
const { useMqttStore: store } = await import(pathToFileURL(join(directory, 'mqttStore.mjs')).href);
const storageKey = 'serialhub-mqtt-profiles';
const base = { id: 'old', name: 'PAIC', broker: 'localhost', port: 1883, clientId: 'test', username: 'test', savedTopics: ['a/#'], futureSetting: { preserve: true } };
const config = (transport, extra = {}) => ({ transport, broker: 'localhost', caPath: '', certPath: '', keyPath: '', websocketPath: '/mqtt', ...extra });

test('four explicit modes stay independent of conventional or custom port numbers', () => {
  for (const transport of mqttTransports) for (const port of [1883, 8883, 443, 8000, 12345]) {
    const profile = migrateMqttTransport({ ...base, transport, transportNeedsReview: false, port });
    assert.equal(profile.transport, transport);
    assert.equal(profile.port, port);
    assert.equal(profile.transportNeedsReview, false);
    assert.equal(isSecureTransport(transport), transport === 'tls' || transport === 'wss');
  }
});

for (const [name, extra, expected] of [
  ['plain TCP', {}, 'tcp'], ['plain WS', { useWebsockets: true }, 'ws'],
  ['CA only', { caFilePath: 'ca.pem' }, 'tls'],
  ['client cert only', { certFilePath: 'client.pem' }, 'tls'],
  ['key only WS', { keyFilePath: 'key.pem', useWebsockets: true }, 'wss'],
  ['complete mTLS', { caFilePath: 'ca.pem', certFilePath: 'client.pem', keyFilePath: 'key.pem' }, 'tls'],
  ['8883 TCP', { port: 8883 }, 'tls'], ['8883 WS', { port: 8883, useWebsockets: true }, 'wss'],
  ['443 WS', { port: 443, useWebsockets: true }, 'wss'],
  ['secure URL', { broker: 'wss://localhost/mqtt' }, 'wss'],
  ['unrecognized mode', { transport: 'broken' }, 'tcp'],
  ['old uppercase secure mode', { transport: 'WSS' }, 'wss'],
]) {
  test(`legacy migration requires review and preserves every field: ${name}`, () => {
    const before = { ...base, ...extra };
    const profile = migrateMqttTransport(before);
    assert.equal(profile.transport, expected);
    assert.equal(profile.transportNeedsReview, true);
    const { transport: _transport, transportNeedsReview: _review, ...rest } = profile;
    const { transport: _oldTransport, ...expectedRest } = before;
    assert.deepEqual(rest, expectedRest);
    assert.deepEqual(before, { ...base, ...extra }, 'migration cannot mutate its input');
    assert.equal(mqttConfigurationError(config(profile.transport, { transportNeedsReview: true })), 'mqtt_transport_review');
    assert.deepEqual(migrateMqttTransport(profile), profile, 'migration must be idempotent');
  });
}

test('TLS accepts default system roots, CA only and optional complete client identity', () => {
  for (const mode of ['tls', 'wss']) {
    assert.equal(mqttConfigurationError(config(mode)), null);
    assert.equal(mqttConfigurationError(config(mode, { caPath: 'ca.pem' })), null);
    assert.equal(mqttConfigurationError(config(mode, { certPath: 'cert.pem', keyPath: 'key.pem' })), null);
    assert.equal(mqttConfigurationError(config(mode, { caPath: 'ca.pem', certPath: 'cert.pem', keyPath: 'key.pem' })), null);
    assert.equal(mqttConfigurationError(config(mode, { certPath: 'cert.pem' })), 'mqtt_transport_pair');
    assert.equal(mqttConfigurationError(config(mode, { keyPath: 'key.pem' })), 'mqtt_transport_pair');
  }
});

test('configured TLS files cannot be silently ignored in plaintext modes', () => {
  for (const mode of ['tcp', 'ws']) {
    assert.equal(mqttConfigurationError(config(mode, { caPath: 'ca.pem' })), 'mqtt_transport_plain_files');
    assert.equal(mqttConfigurationError(config(mode, { certPath: 'cert.pem', keyPath: 'key.pem' })), 'mqtt_transport_plain_files');
  }
});

test('WebSocket path and original host must be explicit, without URL reinterpretation', () => {
  for (const broker of ['wss://localhost/mqtt', 'localhost/path', 'host@other', 'host bad']) {
    assert.equal(mqttConfigurationError(config('wss', { broker })), 'mqtt_transport_host');
  }
  for (const websocketPath of ['mqtt', '/mqtt#bad', '/bad path', '/\\evil']) {
    assert.equal(mqttConfigurationError(config('wss', { websocketPath })), 'mqtt_transport_path');
  }
  assert.equal(mqttConfigurationError(config('wss', { broker: 'original.example', websocketPath: '/custom?site=1' })), null);
});

test('real store migrates legacy envelopes and passwords once, then retains explicit review', async () => {
  store.setState({ profiles: [] }); writes.length = 0;
  const secret = 'FAKE-not-persisted-8271';
  const old = { state: { profiles: [{ ...base, caFilePath: 'ca.pem', password: secret }], extra: 'keep' }, version: 0, extraEnvelope: 'keep' };
  values.set(storageKey, JSON.stringify(old));
  await store.persist.rehydrate();
  assert.equal(store.persist.hasHydrated(), true);
  const expected = { ...base, caFilePath: 'ca.pem', transport: 'tls', transportNeedsReview: true };
  assert.deepEqual(store.getState().profiles, [expected]);
  assert.deepEqual(JSON.parse(values.get(storageKey)), { ...old, state: { ...old.state, profiles: [expected] } });
  assert.equal(writes.length, 1);
  await store.persist.rehydrate();
  assert.equal(writes.length, 1);
  store.getState().updateProfile(base.id, { transport: 'wss', transportNeedsReview: false, websocketPath: '/mqtt' });
  assert.deepEqual(store.getState().profiles[0], { ...expected, transport: 'wss', transportNeedsReview: false, websocketPath: '/mqtt' });
  assert.ok(!values.get(storageKey).includes(secret));
  assert.ok(!values.get(storageKey).includes('"password"'));
});

test('explicit mode is authoritative despite legacy flags and password stripping remains at persistence boundary', () => {
  const value = { ...base, transport: 'tls', transportNeedsReview: false, useWebsockets: true, password: 'FAKE-secret' };
  store.setState({ profiles: [value] });
  const persisted = JSON.parse(values.get(storageKey)).state.profiles[0];
  assert.equal(persisted.transport, 'tls');
  assert.equal(persisted.useWebsockets, true, 'legacy field preserved, but not used to select mode');
  assert.equal(Object.hasOwn(persisted, 'password'), false);
});

test('UI and IPC wiring require explicit reviewed transport and show trust policy (static check)', async () => {
  const page = await readFile(new URL('../src/components/pages/MqttPage.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes("useState<MqttTransport>('tcp')"));
  assert.ok(page.includes('setTransportNeedsReview(p.transportNeedsReview)'));
  assert.ok(page.includes('const error = configurationError();'));
  assert.ok(page.includes("'mqtt_transport_trust'"));
  assert.ok(page.includes("'mqtt_transport_client_optional'"));
  assert.ok(!page.includes('setUseWebsockets('));
  const backend = await readFile(new URL('../src-tauri/src/commands/mqtt_cmd.rs', import.meta.url), 'utf8');
  assert.ok(backend.indexOf('mqtt_transport::options(') < backend.indexOf('AsyncClient::new('));
  assert.ok(!backend.includes('resolve_dns_to_ipv4'));
  assert.ok(!backend.includes('port == 8883'));
});
