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
  ['src/lib/themeTransition.ts', 'themeTransition.mjs'],
]) {
  const input = await readFile(new URL(`../${source}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText
    .replace('../stores/settingsStore', './settingsStore.mjs')
    .replace('../lib/themeTransition', './themeTransition.mjs')
    .replace('"./themeTransition"', '"./themeTransition.mjs"');
  await writeFile(join(directory, name), code);
}
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { useSettingsStore: store } = await import(pathToFileURL(join(directory, 'settingsStore.mjs')).href);
const { startThemeSync } = await import(pathToFileURL(join(directory, 'theme.mjs')).href);
const { THEME_TRANSITION_MS } = await import(pathToFileURL(join(directory, 'themeTransition.mjs')).href);

function setup({ reduced = false, snapshots = true } = {}) {
  store.setState({ theme: 'dark' });
  const classes = new Set();
  const transitions = [];
  const root = {
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
    },
    style: { setProperty: () => {} },
    offsetWidth: 100,
  };
  globalThis.window = { matchMedia: () => ({ matches: reduced }) };
  globalThis.document = { documentElement: root };
  if (snapshots) document.startViewTransition = (update) => {
    let finish;
    const item = { update, skipped: false };
    item.finished = new Promise(resolve => { finish = resolve; });
    item.finish = finish;
    item.ready = Promise.resolve();
    item.skipTransition = () => { item.skipped = true; finish(); };
    transitions.push(item);
    return item;
  };
  return { classes, root, transitions };
}

async function capture(item) {
  assert.equal(item.update(), undefined, 'snapshot updates must not wait for paused rendering');
}

test('initial theme is synchronized without an entrance animation', () => {
  const { classes, transitions } = setup();
  const stop = startThemeSync();
  try {
    assert.equal(classes.has('dark'), true);
    assert.equal(classes.has('theme-changing'), false);
    assert.equal(transitions.length, 0);
    store.getState().setTheme('dark');
    store.getState().addRxBytes(128);
    store.getState().addTxBytes(32);
    assert.equal(transitions.length, 0);
  } finally { stop(); }
});

test('snapshot update commits theme together and cleanup waits for the animation', async () => {
  const { classes, root, transitions } = setup();
  const stop = startThemeSync();
  try {
    store.getState().setTheme('light');
    assert.equal(root.style.colorScheme, 'dark', 'old snapshot precedes state updates');
    await capture(transitions[0]);
    assert.equal(store.getState().theme, 'light');
    assert.equal(root.style.colorScheme, 'light');
    assert.equal(classes.has('theme-changing'), true);
    transitions[0].finish();
    await Promise.resolve();
    assert.equal(classes.has('theme-changing'), false);
  } finally { stop(); }
});

test('rapid reversal skips an old callback and keeps the last requested theme', async () => {
  const { root, transitions } = setup();
  const stop = startThemeSync();
  try {
    store.getState().setTheme('light');
    store.getState().setTheme('light');
    assert.equal(transitions.length, 1, 'duplicate choice does not restart');
    store.getState().setTheme('dark');
    assert.equal(transitions[0].skipped, true);
    await transitions[0].update();
    assert.equal(store.getState().theme, 'dark', 'stale callback cannot revert selection');
    await capture(transitions[1]);
    assert.equal(root.style.colorScheme, 'dark');
    transitions[1].finish();
    await Promise.resolve();
  } finally { stop(); }
});

test('reduced motion applies immediately without creating snapshots', () => {
  const { classes, root, transitions } = setup({ reduced: true });
  const stop = startThemeSync();
  try {
    store.getState().setTheme('light');
    assert.equal(root.style.colorScheme, 'light');
    assert.equal(transitions.length, 0);
    assert.equal(classes.has('theme-changing'), false);
    assert.equal(classes.has('theme-animating'), false);
  } finally { stop(); }
});

test('unsupported WebView uses a timed CSS fallback and restores normal transitions', async () => {
  const { classes, root } = setup({ snapshots: false });
  const stop = startThemeSync();
  try {
    store.getState().setTheme('light');
    assert.equal(root.style.colorScheme, 'light');
    assert.equal(classes.has('theme-animating'), true);
    await new Promise(resolve => setTimeout(resolve, THEME_TRANSITION_MS + 20));
    assert.equal(classes.has('theme-animating'), false);
  } finally { stop(); }
});

test('cleanup invalidates pending callbacks and permits a StrictMode remount', async () => {
  const { classes, root, transitions } = setup();
  const stop = startThemeSync();
  store.getState().setTheme('light');
  stop();
  assert.equal(transitions[0].skipped, true);
  await transitions[0].update();
  assert.equal(classes.has('theme-changing'), false);
  assert.equal(root.style.colorScheme, 'dark');
  const secondStop = startThemeSync();
  secondStop();
});
