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

export function serialPortPresentation(port: SerialPortInfo, t: (key: any) => string) {
  const label = serialPortLabel(port.port_type, t);
  const details = [label];
  if (port.product) details.push(`${t('product')}: ${port.product}`);
  if (port.manufacturer) details.push(`${t('manufacturer')}: ${port.manufacturer}`);
  if (port.vid) details.push(`VID: ${port.vid}`);
  if (port.pid) details.push(`PID: ${port.pid}`);
  return { label, description: port.product ? `${label} — ${port.product}` : label, tooltip: details.join('\n') };
}
