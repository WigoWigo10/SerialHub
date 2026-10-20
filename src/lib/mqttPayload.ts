// The IPC contract is an array of original MQTT payload bytes (not UTF-16 codes).
export function isMqttPayloadBytes(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255);
}

export function decodeMqttPayload(bytes: readonly number[]): { text: string; isUtf8: boolean } {
  const data = Uint8Array.from(bytes);
  // Each publication has its own decoder. Preserve an explicit UTF-8 BOM as U+FEFF.
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data), isUtf8: true };
  } catch {
    return { text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(data), isUtf8: false };
  }
}

export function toMqttHex(bytes: readonly number[]): string {
  return bytes.map(byte => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}
