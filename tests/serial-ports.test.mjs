import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const directory = await mkdtemp(join(process.cwd(), 'node_modules', '.serial-ports-'));
after(() => rm(directory, { recursive: true, force: true }));
const compile = code => ts.transpileModule(code, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React,
} }).outputText;
for (const [source, output] of [['src/lib/serialPorts.ts', 'ports'], ['src/i18n/translations.ts', 'translations']]) {
  await writeFile(join(directory, `${output}.mjs`), compile(await readFile(new URL(`../${source}`, import.meta.url), 'utf8')));
}
const { serialPortLabel, serialPortPresentation } = await import(pathToFileURL(join(directory, 'ports.mjs')).href);
const { translations } = await import(pathToFileURL(join(directory, 'translations.mjs')).href);
const fixture = JSON.parse(await readFile(new URL('./fixtures/serial-ports.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Sidebar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['portIcon', 'PortButton'].includes(node.name?.text));
assert.equal(functions.length, 2);
const icons = Object.fromEntries(['Usb', 'Bluetooth', 'Cpu', 'HelpCircle'].map(name => [name, () => React.createElement('i', { 'data-icon': name })]));
const context = vm.createContext({ React, ...icons, serialPortPresentation });
vm.runInContext(compile(functions.map(node => node.getText(ast)).join('\n')), context);
const PortButton = vm.runInContext('PortButton', context);
const translator = locale => key => translations[locale][key] ?? key;

test('shared core/CLI fixture renders reliable types and unknown in all GUI locales', () => {
  for (const [locale, unknown] of [['pt-BR', 'Desconhecida'], ['en-US', 'Unknown'], ['es', 'Desconocida']]) {
    const t = translator(locale);
    const expected = [unknown, 'USB', 'Bluetooth', t('serial_native')];
    for (const [index, port] of fixture.entries()) {
      assert.equal(serialPortLabel(port.port_type, t), expected[index]);
      const markup = renderToStaticMarkup(React.createElement(PortButton, { port, activePort: null, onConnect: () => assert.fail(), t }));
      assert.ok(markup.includes(expected[index]));
      assert.ok(!markup.includes('Virtual'));
      assert.ok(markup.includes(`data-icon="${['HelpCircle', 'Usb', 'Bluetooth', 'Cpu'][index]}"`));
    }
  }
});

test('missing USB metadata does not make USB unknown and missing unknown metadata does not imply virtual', () => {
  const base = { port_name: 'COM100', vid: '', pid: '', product: '', manufacturer: '' };
  const t = translator('pt-BR');
  assert.equal(serialPortPresentation({ ...base, port_type: 'USB' }, t).description, 'USB');
  assert.equal(serialPortPresentation({ ...base, port_type: 'Unknown' }, t).description, 'Desconhecida');
});

test('descriptions and names are preserved as data, never used to infer virtualization or Bluetooth', () => {
  for (const product of ['Intel(R) Active Management Technology - SOL', 'Virtual Serial Port', 'Standard serial link over Bluetooth']) {
    const port = Object.freeze({ ...fixture[0], product, manufacturer: 'Fornecedor', vid: '', pid: '' });
    const before = JSON.stringify(port);
    const presentation = serialPortPresentation(port, translator('pt-BR'));
    assert.equal(presentation.label, 'Desconhecida');
    assert.ok(presentation.description.includes(product));
    assert.ok(presentation.tooltip.includes(product) && presentation.tooltip.includes('Fornecedor'));
    const markup = renderToStaticMarkup(React.createElement(PortButton, { port, activePort: null, onConnect: () => {}, t: translator('pt-BR') }));
    assert.ok(markup.includes('Desconhecida') && markup.includes(product));
    assert.equal(JSON.stringify(port), before);
  }
});

test('legacy Virtual is labeled as unverified without changing fields or treating it as a confirmed virtual device', () => {
  const port = Object.freeze({ ...fixture[0], port_type: 'Virtual', product: 'Configuração legada' });
  const before = JSON.stringify(port);
  for (const locale of Object.keys(translations)) {
    const t = translator(locale);
    assert.equal(serialPortPresentation(port, t).label, t('serial_virtual_legacy'));
  }
  const markup = renderToStaticMarkup(React.createElement(PortButton, { port, activePort: null, onConnect: () => {}, t: translator('pt-BR') }));
  assert.ok(markup.includes('legada não verificada') && markup.includes('data-icon="HelpCircle"'));
  assert.equal(JSON.stringify(port), before);
});

test('future unrecognized wire labels remain visible without guessing a type', () => {
  const presentation = serialPortPresentation({ ...fixture[0], port_type: 'OtherKind' }, translator('pt-BR'));
  assert.equal(presentation.label, 'Desconhecida (OtherKind)');
});

test('non-USB filter keeps unknown, PCI and Bluetooth; production entry points delegate to the same core (static wiring)', async () => {
  assert.equal(fixture.filter(port => port.port_type === 'USB').length, 1);
  assert.equal(fixture.filter(port => port.port_type !== 'USB').length, 3);
  assert.ok(source.includes('p.port_type === "USB"') && source.includes('p.port_type !== "USB"'));
  const backend = await readFile(new URL('../src-tauri/src/commands/serial_cmd.rs', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  const cli = await readFile(new URL('../crates/serialhub-cli/src/main.rs', import.meta.url), 'utf8');
  assert.ok(backend.includes('serialhub_core::list_ports().map_err('));
  assert.ok(app.includes('serialhub_core::list_ports()') && app.includes('emit("ports-changed"'));
  assert.ok(cli.includes('serialhub_core::list_ports().map_err('));
  assert.ok(!backend.slice(0, backend.indexOf('pub fn open_port')).includes('WMI'));
});

test('port classifications are not persisted by the settings store (static persistence contract)', async () => {
  const settings = await readFile(new URL('../src/stores/settingsStore.ts', import.meta.url), 'utf8');
  const partial = settings.slice(settings.indexOf('partialize:'));
  assert.ok(!partial.includes('port_type') && !partial.includes('ports:'));
  assert.ok(source.includes('useState<SerialPort[]>([])'));
});
