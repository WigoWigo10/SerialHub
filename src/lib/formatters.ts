export function toHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map(byte => byte.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');
}