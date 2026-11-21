import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const config = JSON.parse(await read('src-tauri/tauri.conf.json'));
const capability = JSON.parse(await read('src-tauri/capabilities/default.json'));

test('the production CSP permits native IPC and only local scripts', () => {
  const { csp, devCsp } = config.app.security;
  assert.equal(csp['default-src'], "'self'");
  assert.equal(csp['script-src'], "'self'");
  assert.equal(csp['frame-src'], "'none'");
  assert.equal(csp['object-src'], "'none'");
  assert.ok(csp['connect-src'].split(' ').includes('http://ipc.localhost'));
  assert.ok(!csp['connect-src'].includes('127.0.0.1'));
  assert.ok(devCsp['connect-src'].includes('ws://127.0.0.1:1420'));
  assert.equal(config.build.devUrl, 'http://127.0.0.1:1420');
});

test('native capabilities are limited to the local main webview', async () => {
  assert.deepEqual(capability.windows, ['main']);
  assert.equal(capability.remote, undefined);
  assert.deepEqual(capability.permissions, [
    'allow-serialhub',
    'core:app:allow-version',
    'core:event:allow-listen',
    'core:event:allow-unlisten',
    'dialog:allow-open',
    'dialog:allow-save',
    {
      identifier: 'opener:allow-open-url',
      allow: [{ url: 'https://github.com/WigoWigo10/SerialHub' }],
    },
  ]);

  const runtime = await read('src-tauri/src/lib.rs');
  const handler = runtime.match(/tauri::generate_handler!\[([\s\S]*?)\]/)[1];
  const registered = [...handler.matchAll(/::([a-z_]+)\s*(?:,|$)/gm)].map(match => match[1]);
  const permission = await read('src-tauri/permissions/serialhub.toml');
  const allowed = [...permission.matchAll(/^\s+"([a-z_]+)",$/gm)].map(match => match[1]);
  assert.ok(registered.length > 0);
  assert.deepEqual(allowed.sort(), registered.sort());
});
