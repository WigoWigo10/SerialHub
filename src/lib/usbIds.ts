/// <reference types="vite/client" />

export interface UsbIdCatalog {
  vendors: ReadonlyMap<string, string>;
  products: ReadonlyMap<string, string>;
}

export function parseUsbIds(text: string): UsbIdCatalog {
  const vendors = new Map<string, string>();
  const products = new Map<string, string>();
  let vendorId: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (/^C\s/.test(line)) break;
    const vendor = /^([\da-f]{4})[ \t]+(.+\S|\S)\s*$/i.exec(line);
    if (vendor) {
      vendorId = vendor[1].toLowerCase();
      vendors.set(vendorId, vendor[2].trim());
      continue;
    }
    const product = /^\t([\da-f]{4})[ \t]+(.+\S|\S)\s*$/i.exec(line);
    if (vendorId && product) {
      products.set(`${vendorId}:${product[1].toLowerCase()}`, product[2].trim());
    }
  }
  return { vendors, products };
}

// Vendor documentation supplements the shared database for these models.
const vendorAliases = new Map([
  ['0403', 'FTDI'],
  ['0483', 'STMicroelectronics'],
  ['04e8', 'Samsung'],
  ['05ac', 'Apple'],
  ['067b', 'Prolific'],
  ['0e8d', 'MediaTek'],
  ['18d1', 'Google'],
  ['1a86', 'WCH'],
  ['22b8', 'Motorola'],
  ['2341', 'Arduino'],
  ['2e8a', 'Raspberry Pi'],
  ['303a', 'Espressif'],
]);

const documentedProducts = new Map([
  ['1a86:55d2', 'CH342'],
  ['1a86:55d3', 'CH343'],
  ['1a86:55d4', 'CH9102'],
  ['1a86:55d5', 'CH344'],
  ['1a86:55d7', 'CH9103'],
  ['1a86:55d8', 'CH9101'],
  ['1a86:55da', 'CH347T'],
  ['1a86:55db', 'CH347T'],
  ['1a86:55dd', 'CH347T'],
  ['1a86:55de', 'CH347F'],
  ['2e8a:0005', 'Pico MicroPython (CDC)'],
  ['2e8a:0009', 'Pico SDK CDC UART'],
  ['2e8a:000a', 'Pico SDK CDC UART (RP2040)'],
  ['2e8a:000b', 'Pico CircuitPython'],
  ['2e8a:000c', 'Debug Probe'],
  ['303a:0002', 'ESP32-S2 USB OTG'],
  ['303a:1001', 'USB Serial/JTAG'],
  ['303a:4001', 'TinyUSB CDC'],
]);

function canonicalId(id: string) {
  const value = id.trim().toLowerCase();
  return /^(?:0x)?[\da-f]{1,4}$/.test(value) ? value.replace(/^0x/, '').padStart(4, '0') : '';
}

export function hasUsbVendorId(vid: string) {
  const id = canonicalId(vid);
  return id !== '' && id !== '0000';
}

export function lookupUsbDevice(vid: string, pid: string, catalog?: UsbIdCatalog) {
  const vendorId = canonicalId(vid);
  if (!vendorId || vendorId === '0000') return {};
  const productId = canonicalId(pid);
  const pair = `${vendorId}:${productId}`;
  return {
    vendor: vendorAliases.get(vendorId) ?? catalog?.vendors.get(vendorId),
    product: documentedProducts.get(pair) ?? catalog?.products.get(pair),
  };
}

let pendingCatalog: Promise<UsbIdCatalog> | undefined;

export function loadUsbIdCatalog(): Promise<UsbIdCatalog> {
  pendingCatalog ??= fetch(`${import.meta.env.BASE_URL}usb-ids/usb.ids`)
    .then(async response => {
      if (!response.ok) throw new Error(`USB catalog: HTTP ${response.status}`);
      const catalog = parseUsbIds(await response.text());
      if (catalog.vendors.size === 0) throw new Error('USB catalog is empty');
      return catalog;
    })
    .catch(error => {
      pendingCatalog = undefined;
      throw error;
    });
  return pendingCatalog;
}
