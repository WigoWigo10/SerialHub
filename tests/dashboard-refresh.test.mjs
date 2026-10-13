import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const directory = await mkdtemp(join(process.cwd(), 'node_modules', '.dashboard-test-'));
after(() => rm(directory, { recursive: true, force: true }));
for (const [source, name] of [
  ['src/lib/dashboardRefresh.ts', 'dashboardRefresh.mjs'],
  ['src/stores/settingsStore.ts', 'settingsStore.mjs'],
  ['src/lib/themeTransition.ts', 'themeTransition.mjs'],
]) {
  const input = await readFile(new URL(`../${source}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText.replace('../lib/themeTransition', './themeTransition.mjs');
  await writeFile(join(directory, name), code);
}
const { animateValue, normalizeRefreshRate, DASHBOARD_REFRESH_RATES, isRefreshRateAvailable, effectiveRefreshRate } =
  await import(pathToFileURL(join(directory, 'dashboardRefresh.mjs')).href);

function fakeClock() {
  let time = 0;
  let id = 0;
  const callbacks = new Map();
  return {
    callbacks,
    now: () => time,
    request: (callback) => { callbacks.set(++id, callback); return id; },
    cancel: (key) => callbacks.delete(key),
    tick: (nextTime) => {
      time = nextTime;
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(time);
    },
  };
}

test('supports automatic and rates below/above 60; invalid persisted values fall back to auto', () => {
  assert.deepEqual(DASHBOARD_REFRESH_RATES, ['auto', 15, 30, 60, 120]);
  for (const rate of DASHBOARD_REFRESH_RATES) assert.equal(normalizeRefreshRate(rate), rate);
  for (const value of [undefined, null, 0, -1, 144, 240, 1000, '60']) assert.equal(normalizeRefreshRate(value), 'auto');
});

test('numeric rates cap publication and interpolation preserves endpoints', () => {
  for (const rate of [15, 30, 60, 120]) {
    const clock = fakeClock();
    const values = [];
    animateValue(10, 110, rate, value => values.push(value), clock);
    for (let time = 1; time <= 500; time++) clock.tick(time);
    assert.ok(values.length <= Math.ceil(rate / 2) + 1, `${rate}: ${values.length}`);
    assert.equal(values.at(-1), 110);
    assert.ok(values.every(value => value >= 10 && value <= 110));
    assert.equal(clock.callbacks.size, 0);
  }
});

test('display modes disable unsupported rates and old preferences safely use auto', () => {
  assert.equal(isRefreshRateAvailable(120, 60), false);
  assert.equal(isRefreshRateAvailable(60, 59), true);
  assert.equal(isRefreshRateAvailable(120, 120), true);
  assert.equal(isRefreshRateAvailable(15, null), false);
  assert.equal(isRefreshRateAvailable(60, NaN), false);
  assert.equal(isRefreshRateAvailable('auto', null), true);
  assert.equal(effectiveRefreshRate(120, 60), 'auto');
  assert.equal(effectiveRefreshRate(120, 120), 120);
  assert.equal(effectiveRefreshRate(144, 144), 'auto');
  assert.equal(effectiveRefreshRate(240, 240), 'auto');
});

test('automatic animation never exceeds the 120 Hz ceiling', () => {
  const clock = fakeClock();
  const values = [];
  animateValue(0, 100, 'auto', value => values.push(value), clock);
  for (let time = 1; time <= 500; time++) clock.tick(time);
  assert.ok(values.length <= 61);
  assert.equal(values.at(-1), 100);
});

test('auto follows every display callback; high rate cannot exceed display callbacks', () => {
  for (const rate of ['auto', 120]) {
    const clock = fakeClock();
    const values = [];
    animateValue(100, 0, rate, value => values.push(value), clock);
    for (const time of [17, 34, 51, 500]) clock.tick(time);
    assert.equal(values.length, 4);
    assert.equal(values.at(-1), 0);
  }
});

test('cancellation removes scheduled work and invalidates a late callback', () => {
  const clock = fakeClock();
  const values = [];
  const cancel = animateValue(0, 100, 60, value => values.push(value), clock);
  const pending = [...clock.callbacks.values()][0];
  clock.tick(20);
  cancel();
  const count = values.length;
  pending(500);
  assert.equal(values.length, count);
  assert.equal(clock.callbacks.size, 0);
});

test('unchanged values do not schedule animation', () => {
  const clock = fakeClock();
  animateValue(20, 20, 'auto', () => assert.fail('Unexpected update'), clock)();
  assert.equal(clock.callbacks.size, 0);
});

test('refresh preference defaults to automatic and is persisted by the real store', async () => {
  const entries = new Map();
  globalThis.localStorage = {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: key => entries.delete(key),
  };
  const { useSettingsStore: store } = await import(pathToFileURL(join(directory, 'settingsStore.mjs')).href);
  assert.equal(store.getState().dashboardRefreshRate, 'auto');
  store.getState().setDashboardRefreshRate(120);
  assert.equal(JSON.parse(entries.get('serialhub-settings')).state.dashboardRefreshRate, 120);
  const saved = entries.get('serialhub-settings');
  store.setState({ dashboardRefreshRate: 15 });
  entries.set('serialhub-settings', saved);
  await store.persist.rehydrate();
  assert.equal(store.getState().dashboardRefreshRate, 120);
});
