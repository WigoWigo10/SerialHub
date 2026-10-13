import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const directory = await mkdtemp(join(process.cwd(), 'node_modules', '.theme-test-'));
after(() => rm(directory, { recursive: true, force: true }));
for (const [source, name] of [
  ['src/stores/settingsStore.ts', 'settingsStore.mjs'],
  ['src/lib/theme.ts', 'theme.mjs'],
]) {
  const input = await readFile(new URL(`../${source}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText.replace('../stores/settingsStore', './settingsStore.mjs');
  await writeFile(join(directory, name), code);
}
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { useSettingsStore: store } = await import(pathToFileURL(join(directory, 'settingsStore.mjs')).href);
const { startThemeSync } = await import(pathToFileURL(join(directory, 'theme.mjs')).href);
let nextFrame = 0;
const frames = new Map();
globalThis.requestAnimationFrame = (callback) => { frames.set(++nextFrame, callback); return nextFrame; };
globalThis.cancelAnimationFrame = (id) => frames.delete(id);

function setup(theme = 'dark') {
  frames.clear();
  store.setState({ theme });
  const classes = new Set();
  const root = {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
    },
    style: {},
  };
  globalThis.document = { documentElement: root };
  return { classes, root };
}

function paint() {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback();
}

test('theme is applied synchronously and transitions resume after two frames', () => {
  const { classes, root } = setup('light');
  const stop = startThemeSync();
  try {
    assert.equal(root.style.colorScheme, 'light');
    assert.equal(classes.has('light'), true);
    assert.equal(classes.has('dark'), false);
    assert.equal(classes.has('theme-changing'), true);
    paint();
    assert.equal(classes.has('theme-changing'), true);
    paint();
    assert.equal(classes.has('theme-changing'), false);
    store.getState().setTheme('dark');
    assert.equal(classes.has('dark'), true);
    assert.equal(classes.has('light'), false);
    assert.equal(root.style.colorScheme, 'dark');
  } finally { stop(); }
});

test('rapid switches cancel old frames and keep the final selected theme', () => {
  const { classes, root } = setup();
  const stop = startThemeSync();
  try {
    paint();
    store.getState().setTheme('light');
    store.getState().setTheme('dark');
    assert.equal(frames.size, 1);
    paint();
    assert.equal(classes.has('theme-changing'), true);
    paint();
    assert.equal(classes.has('theme-changing'), false);
    assert.equal(root.style.colorScheme, 'dark');
  } finally { stop(); }
});

test('traffic counters and selecting the current theme do not restart transitions', () => {
  const { classes } = setup();
  const stop = startThemeSync();
  try {
    paint(); paint();
    store.getState().addRxBytes(128);
    store.getState().addTxBytes(32);
    store.getState().setTheme('dark');
    assert.equal(frames.size, 0);
    assert.equal(classes.has('theme-changing'), false);
  } finally { stop(); }
});

test('cleanup unsubscribes and cancels frames, including a StrictMode remount', () => {
  const { classes, root } = setup();
  const firstStop = startThemeSync();
  firstStop();
  assert.equal(frames.size, 0);
  assert.equal(classes.has('theme-changing'), false);
  store.getState().setTheme('light');
  assert.equal(root.style.colorScheme, 'dark');
  const secondStop = startThemeSync();
  assert.equal(root.style.colorScheme, 'light');
  secondStop();
  paint(); paint();
  assert.equal(classes.has('theme-changing'), false);
});
