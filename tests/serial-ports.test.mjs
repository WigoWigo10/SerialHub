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
for (const [source, output] of [
  ['src/lib/serialPorts.ts', 'ports'], ['src/lib/usbIds.ts', 'usbIds'], ['src/i18n/translations.ts', 'translations'],
]) {
  const code = compile(await readFile(new URL(`../${source}`, import.meta.url), 'utf8'));
  await writeFile(join(directory, `${output}.mjs`), code
    .replace('./usbIds', './usbIds.mjs')
    .replace('import.meta.env.BASE_URL', '"/"'));
}
const { serialPortLabel, serialPortPresentation } = await import(pathToFileURL(join(directory, 'ports.mjs')).href);
const { parseUsbIds, lookupUsbDevice, hasUsbVendorId, loadUsbIdCatalog } = await import(pathToFileURL(join(directory, 'usbIds.mjs')).href);
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
  assert.equal(serialPortPresentation({ ...base, port_type: 'USB' }, t).description, 'USB · Fabricante USB desconhecido');
  assert.equal(serialPortPresentation({ ...base, port_type: 'Unknown' }, t).description, 'Desconhecida');
});

test('bundled USB catalog resolves bridges, microcontrollers and phones by the exact pair', async () => {
  const catalog = parseUsbIds(await readFile(new URL('../public/usb-ids/usb.ids', import.meta.url), 'utf8'));
  assert.ok(catalog.vendors.size > 2000);
  assert.ok(catalog.products.size > 10000);
  for (const [vid, pid, vendor, product] of [
    ['1A86', '55D3', 'WCH', /CH343/],
    ['0403', '6001', 'FTDI', /FT232/],
    ['10C4', 'EA60', 'Silicon Labs', /CP210x/],
    ['067B', '2303', 'Prolific', /PL2303/],
    ['0x303a', '0x1001', 'Espressif', /Serial\/JTAG/],
    ['0483', '374B', 'STMicroelectronics', /ST-LINK/],
    ['2341', '0043', 'Arduino', /Uno/],
    ['2E8A', '000A', 'Raspberry Pi', /Pico SDK CDC UART/],
    ['04D8', '000A', 'Microchip Technology, Inc.', /CDC RS-232/],
    ['04E8', '685D', 'Samsung', /Galaxy S II/],
    ['05AC', '12A8', 'Apple', /iPhone/],
    ['05C6', '9091', 'Qualcomm, Inc.', /Jolla C Diagnostic/],
  ]) {
    const names = lookupUsbDevice(vid, pid, catalog);
    assert.equal(names.vendor, vendor);
    assert.match(names.product, product);
  }
  assert.equal(lookupUsbDevice('0403', '55d3', catalog).product, undefined);
  assert.deepEqual(lookupUsbDevice('', '55d3', catalog), {});
  assert.equal(hasUsbVendorId('0000'), false);
  assert.equal(hasUsbVendorId('com58'), false);
  assert.equal(hasUsbVendorId(' 0x1A86 '), true);
});

test('USB lookup skips interface names and class definitions in usb.ids', () => {
  const catalog = parseUsbIds('ABCD  Vendor\r\n\t0001  Adapter\r\n\t\t0002  Interface\r\nC 01  Audio\r\n\t0002  Class entry');
  assert.equal(lookupUsbDevice('abcd', '1', catalog).product, 'Adapter');
  assert.equal(lookupUsbDevice('abcd', '2', catalog).product, undefined);
});

test('USB catalog loads from the app once and allows a retry after a failed load', async (context) => {
  let requests = 0;
  const fetch = context.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, '/usb-ids/usb.ids');
    return ++requests === 1
      ? new Response('', { status: 503 })
      : new Response('abcd  Example supplier\n\t0001  Serial adapter');
  });
  await assert.rejects(loadUsbIdCatalog(), /HTTP 503/);
  const left = loadUsbIdCatalog();
  const right = loadUsbIdCatalog();
  assert.equal(left, right);
  assert.equal((await left).vendors.get('abcd'), 'Example supplier');
  assert.equal(await loadUsbIdCatalog(), await right);
  assert.equal(fetch.mock.callCount(), 2);
});

test('connected USB device keeps its identification and retains original metadata in the tooltip', () => {
  const port = Object.freeze({
    ...fixture[1], port_name: 'COM58', vid: '1a86', pid: '55d3',
    manufacturer: 'wch.cn', product: 'USB-Enhanced-SERIAL CH343 (COM58)',
  });
  const t = translator('pt-BR');
  const { description, tooltip } = serialPortPresentation(port, t);
  assert.equal(description, 'USB · WCH CH343');
  assert.match(tooltip, /Fabricante: wch\.cn/);
  assert.match(tooltip, /USB-Enhanced-SERIAL CH343 \(COM58\)/);
  assert.match(tooltip, /VID: 1a86\nPID: 55d3/);
  const markup = renderToStaticMarkup(React.createElement(PortButton, {
    port, activePort: port.port_name, onConnect: () => {}, t,
  }));
  assert.match(markup, /CONECTADO/);
  assert.match(markup, /USB · WCH CH343/);
  assert.equal(port.manufacturer, 'wch.cn');
});

test('USB identification prefers a specific descriptor and falls back for a generic label', () => {
  const catalog = parseUsbIds('abcd  Registered vendor\n\t0001  Catalog model');
  const base = { ...fixture[1], vid: 'abcd', pid: '0001', port_name: 'COM9', manufacturer: '' };
  const t = translator('en-US');
  assert.equal(serialPortPresentation({ ...base, product: 'USB Serial Device (COM9)' }, t, catalog).description,
    'USB · Registered vendor Catalog model');
  assert.equal(serialPortPresentation({ ...base, manufacturer: 'Board maker', product: 'Board maker Lab unit' }, t, catalog).description,
    'USB · Board maker Lab unit');
  assert.equal(serialPortPresentation({ ...base, product: '', pid: 'cafe' }, t, catalog).description,
    'USB · Registered vendor');
  assert.equal(serialPortPresentation({ ...base, product: '', port_type: 'Unknown' }, t, catalog).description,
    'Unknown');
  assert.equal(serialPortPresentation({ ...base, vid: 'ffff', product: 'USB Serial Device (COM9)' }, t, catalog).description,
    'USB · Unknown USB manufacturer');
});

test('Samsung modem label does not repeat the vendor and retains its full name in details', () => {
  const port = {
    ...fixture[1], port_name: 'COM56', vid: '04e8', pid: '6860',
    manufacturer: 'SAMSUNG Electronics Co., Ltd.', product: 'SAMSUNG Mobile USB Modem',
  };
  const { description, tooltip } = serialPortPresentation(port, translator('pt-BR'));
  assert.equal(description, 'USB · SAMSUNG Mobile USB Modem');
  assert.match(tooltip, /Fabricante: SAMSUNG Electronics Co\., Ltd\./);
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
