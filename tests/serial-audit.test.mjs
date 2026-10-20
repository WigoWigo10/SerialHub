import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const directory = await mkdtemp(join(process.cwd(), 'node_modules', '.serial-audit-test-'));
after(() => rm(directory, { recursive: true, force: true }));
for (const [source, name] of [
  ['src/lib/serialPresentation.ts', 'serialPresentation.mjs'], ['src/lib/formatters.ts', 'formatters.mjs'],
  ['src/lib/serialActions.ts', 'serialActions.mjs'], ['src/lib/serialConnection.ts', 'serialConnection.mjs'],
  ['src/stores/settingsStore.ts', 'settingsStore.mjs'], ['src/lib/themeTransition.ts', 'themeTransition.mjs'],
]) {
  const input = await readFile(new URL(`../${source}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
    .replace("'./formatters'", "'./formatters.mjs'").replace('../lib/themeTransition', './themeTransition.mjs');
  await writeFile(join(directory, name), code);
}
const { SerialPresentation, listenSafely } = await import(pathToFileURL(join(directory, 'serialPresentation.mjs')).href);
const { createActionGate, toggleRecording, prepareSerialText, sendSerialText } = await import(pathToFileURL(join(directory, 'serialActions.mjs')).href);
const { startStateMonitor } = await import(pathToFileURL(join(directory, 'serialConnection.mjs')).href);
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { useSettingsStore: store } = await import(pathToFileURL(join(directory, 'settingsStore.mjs')).href);
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const bytes = text => new TextEncoder().encode(text);

test('UTF-8 divided across RX packets is decoded once, with timestamps only on actual line starts', () => {
  const formatter = new SerialPresentation();
  assert.equal(formatter.receive(new Uint8Array([0xc3]), 'ASCII', true, () => '[T]'), '');
  assert.equal(formatter.receive(new Uint8Array([0xa9, 10]), 'ASCII', true, () => '[T]'), '[T]é\n');
  assert.equal(formatter.receive(bytes('next'), 'ASCII', true, () => '[T]'), '[T]next');
});

test('CRLF divided between packets, CR, LF and NUL retain their bytes in presentation text', () => {
  const formatter = new SerialPresentation();
  const chunks = ['one\r', '\n', 'two\n', 'three\r', 'four\0'];
  const result = chunks.map(chunk => formatter.receive(bytes(chunk), 'ASCII', true, () => '[T]')).join('');
  assert.equal(result, '[T]one\r\n[T]two\n[T]three\r[T]four\0');
});

test('binary data remains exact in HEX and invalid UTF-8 has a visible replacement only in ASCII', () => {
  const formatter = new SerialPresentation();
  const input = new Uint8Array([0, 255, 128, 13, 10]);
  assert.ok(formatter.receive(input, 'HEX', true, () => assert.fail()).includes('00 FF 80 0D 0A'));
  assert.equal(formatter.receive(new Uint8Array([255]), 'ASCII', false, () => ''), '\uFFFD');
  assert.deepEqual(input, new Uint8Array([0, 255, 128, 13, 10]));
});

test('clear resets the pending decoder; mode changes flush incomplete text and do not erase previous output', () => {
  const formatter = new SerialPresentation();
  formatter.receive(new Uint8Array([0xc3]), 'ASCII', false, () => '');
  formatter.reset();
  assert.equal(formatter.receive(bytes('A'), 'ASCII', false, () => ''), 'A');
  formatter.receive(new Uint8Array([0xc3]), 'ASCII', false, () => '');
  assert.ok(formatter.receive(new Uint8Array([255]), 'HEX', false, () => '').startsWith('\uFFFD'));
});

test('local echo keeps accepted data and line endings without adding unsent bytes', () => {
  const formatter = new SerialPresentation();
  assert.ok(formatter.echo(bytes('AB\r\n'), 'ASCII').includes('AB\r\n'));
  assert.ok(formatter.echo(new Uint8Array([65, 0]), 'HEX').includes('41 00'));
});

test('a new Serial session cannot complete an old incomplete UTF-8 sequence', () => {
  const formatter = new SerialPresentation();
  formatter.receive(new Uint8Array([0xc3]), 'ASCII', false, () => '');
  assert.equal(formatter.finish(false, () => ''), '\uFFFD');
  assert.equal(formatter.receive(new Uint8Array([0xa9]), 'ASCII', false, () => ''), '\uFFFD');
});

test('text sending preserves Unicode/NUL and applies the chosen ending exactly once', async () => {
  assert.equal(prepareSerialText('é\0', 'NONE'), 'é\0');
  assert.equal(prepareSerialText('é', 'LF'), 'é\n');
  assert.equal(prepareSerialText('é', 'CRLF'), 'é\r\n');
  await sendSerialText('é\r\n', async content => bytes(content).length);
  await assert.rejects(sendSerialText('é\r\n', async () => 2), /2\/4/);
  await assert.rejects(sendSerialText('A', async () => { throw Error('failed write'); }), /failed write/);
});

test('action gates reject rapid duplicate operations and release on errors or completion', async () => {
  const gate = createActionGate(), wait = deferred(); const pending = []; let calls = 0;
  const first = gate(async () => { calls++; await wait.promise; }, value => pending.push(value));
  await gate(async () => { calls++; }, () => assert.fail('duplicate pending update'));
  assert.equal(calls, 1); wait.resolve(); await first; assert.deepEqual(pending, [true, false]);
  await assert.rejects(gate(async () => { throw Error('failure'); }, () => {}), /failure/);
  await gate(async () => { calls++; }, () => {}); assert.equal(calls, 2);
});

test('recording cancellation and failed start/finish do not return a success outcome', async () => {
  const adapter = { active: () => false, choose: async () => null,
    start: async () => assert.fail('cancelled dialog started a file'), stop: async () => {} };
  assert.equal(await toggleRecording(adapter), 'cancelled');
  adapter.choose = async () => 'pasta com espaço/é.log';
  adapter.start = async () => { throw Error('open denied'); };
  await assert.rejects(toggleRecording(adapter), /open denied/);
  adapter.active = () => true; adapter.stop = async () => { throw Error('flush failed'); };
  await assert.rejects(toggleRecording(adapter), /flush failed/);
});

test('recording failure is global, ordered and not persisted as an active recording', async () => {
  store.setState({ recordingRevision: -1, isRecording: false });
  const snapshot = deferred(); let receive, stopped = 0;
  const cleanup = startStateMonitor({ subscribe: callback => { receive = callback; return Promise.resolve(() => stopped++); },
    snapshot: () => snapshot.promise, apply: value => store.getState().applySerialRecording(value), reportError: assert.fail });
  await flush();
  receive({ revision: 2, recording: false, path: 'é.log', error: 'simulated disk failure' });
  snapshot.resolve({ revision: 1, recording: true, path: 'é.log', error: null }); await flush();
  assert.equal(store.getState().isRecording, false); assert.equal(store.getState().recordingError, 'simulated disk failure');
  cleanup(); assert.equal(stopped, 1);
});

test('pending widget listeners are unsubscribed once and cannot call a disposed terminal', async () => {
  const ready = deferred(); let receive, stopped = 0, calls = 0;
  const cleanup = listenSafely(callback => { receive = callback; return ready.promise; }, () => calls++);
  cleanup(); cleanup(); ready.resolve(() => stopped++); await flush(); receive({ payload: [] });
  assert.equal(stopped, 1); assert.equal(calls, 0);
});

function closure(source, name, bindings) {
  const file = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) initializer = node.initializer.getText(file); ts.forEachChild(node, visit); }
  visit(file); assert.ok(initializer, name);
  const js = ts.transpileModule(`const action = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(...Object.keys(bindings), `${js}\nreturn action;`)(...Object.values(bindings));
}

test('port scans ignore out-of-order responses and an unmounted Sidebar', async () => {
  const source = await readFile(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
  const first = deferred(), second = deferred(), late = deferred(); const requests = [first, second, late]; const ports = [];
  const mounted = { current: true }, scanVersion = { current: 0 };
  const scan = closure(source, 'scanPorts', { invoke: () => requests.shift().promise, mounted, scanVersion,
    setScanning: () => {}, setPorts: value => ports.push(value), toast: { error: assert.fail } });
  const a = scan(), b = scan(); second.resolve(['new']); await b; first.resolve(['old']); await a;
  assert.deepEqual(ports, [['new']]); const c = scan(); mounted.current = false; late.resolve(['late']); await c;
  assert.deepEqual(ports, [['new']]);
});

test('failed connection attempts do not clear terminal history', async () => {
  const source = await readFile(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
  let reported = 0;
  const connect = closure(source, 'handleConnect', { open: async () => { throw Error('no device'); },
    useSettingsStore: store, connectionAction: createActionGate(), t: key => key,
    toast: { error: () => reported++ }, window: { dispatchEvent: () => assert.fail('history erased') } });
  await connect('SIMULATED'); assert.equal(reported, 1);
});

test('TX has one global counter owner and terminal cleanup releases its observer (static wiring)', async () => {
  const dashboard = await readFile(new URL('../src/components/pages/DashboardPage.tsx', import.meta.url), 'utf8');
  const terminal = await readFile(new URL('../src/components/layout/TerminalArea.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(dashboard, /serial-sent|addTxBytes/);
  assert.match(terminal, /resizeObserver\.disconnect\(\)/);
  assert.match(terminal, /term\.write\('', \(\) =>/); assert.match(terminal, /term\.reset\(\)/);
  assert.doesNotMatch(terminal, /term\.clear\(|new TextDecoder/);
});
