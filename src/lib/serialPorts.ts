import { lookupUsbDevice, type UsbIdCatalog } from './usbIds';

// Wire values are shared by core, Tauri enumeration and CLI JSON.
export type SerialPortType = 'USB' | 'Bluetooth' | 'Native' | 'Unknown';
export interface SerialPortInfo {
  port_name: string;
  // Accept legacy/future labels for presentation without rewriting source data.
  port_type: SerialPortType | (string & {});
  vid: string;
  pid: string;
  manufacturer: string;
  product: string;
}

export function serialPortLabel(type: string, t: (key: any) => string): string {
  switch (type) {
    case 'USB': return 'USB';
    case 'Bluetooth': return 'Bluetooth';
    case 'Native': return t('serial_native');
    case 'Unknown': return t('serial_unknown');
    case 'Virtual': return t('serial_virtual_legacy');
    default: return `${t('serial_unknown')} (${type})`;
  }
}

function startsWithName(value: string, name: string): boolean {
  const lowerValue = value.toLowerCase();
  const lowerName = name.toLowerCase();
  return lowerValue === lowerName || lowerValue.startsWith(`${lowerName} `);
}

export function serialPortPresentation(port: SerialPortInfo, t: (key: any) => string, catalog?: UsbIdCatalog) {
  const label = serialPortLabel(port.port_type, t);
  const details = [label];
  if (port.product) details.push(`${t('product')}: ${port.product}`);
  if (port.manufacturer) details.push(`${t('manufacturer')}: ${port.manufacturer}`);
  if (port.vid) details.push(`VID: ${port.vid}`);
  if (port.pid) details.push(`PID: ${port.pid}`);

  if (port.port_type !== 'USB') {
    return { label, description: port.product ? `${label} — ${port.product}` : label, tooltip: details.join('\n') };
  }

  const names = lookupUsbDevice(port.vid, port.pid, catalog);
  const reportedVendor = port.manufacturer.trim();
  const vendor = names.vendor === 'WCH' && /^(wch\.cn|qinheng electronics)$/i.test(reportedVendor)
    ? names.vendor
    : reportedVendor || names.vendor;
  const suffix = ` (${port.port_name})`;
  const reportedProduct = port.product.trim();
  const productName = reportedProduct.toLowerCase().endsWith(suffix.toLowerCase())
    ? reportedProduct.slice(0, -suffix.length)
    : reportedProduct;
  const genericProduct = /^(usb serial device|dispositivo de s[ée]rie usb|dispositivo serial usb|dispositivo serie usb|usb cdc serial port)$/i.test(productName);
  const windowsBridgeLabel = names.vendor === 'WCH' && names.product
    && productName.toLowerCase() === `usb-enhanced-serial ${names.product.toLowerCase()}`;
  const product = !productName || genericProduct || windowsBridgeLabel
    ? names.product ?? ''
    : productName;
  const productIncludesVendor = vendor && (startsWithName(product, vendor)
    || (names.vendor && startsWithName(vendor, names.vendor) && startsWithName(product, names.vendor)));
  const identity = [productIncludesVendor ? undefined : vendor, product].filter(Boolean).join(' ');
  const unknownVendor = t('serial_usb_manufacturer_unknown');

  if (names.vendor && names.vendor !== reportedVendor) details.push(`${t('serial_usb_catalog_vendor')}: ${names.vendor}`);
  if (!vendor) details.push(unknownVendor);
  if (names.product && names.product !== reportedProduct) details.push(`${t('serial_usb_catalog_product')}: ${names.product}`);
  return { label, description: `${label} · ${identity || unknownVendor}`, tooltip: details.join('\n') };
}
