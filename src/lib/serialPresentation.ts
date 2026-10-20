import { toHex } from './formatters';

// Display conversion only: the logger continues to receive the original bytes.
export class SerialPresentation {
  private decoder = new TextDecoder();
  private lineStart = true;
  private mode: 'ASCII' | 'HEX' = 'ASCII';

  reset() { this.decoder = new TextDecoder(); this.lineStart = true; }

  finish(timestamps: boolean, badge: () => string): string {
    const text = this.text(this.decoder.decode(), timestamps, badge);
    this.reset();
    return text;
  }

  private text(value: string, timestamps: boolean, badge: () => string) {
    let output = '';
    for (const char of value) {
      if (char === '\r' || char === '\n') {
        output += char;
        this.lineStart = true;
      } else {
        if (this.lineStart && timestamps) output += badge();
        output += char;
        this.lineStart = false;
      }
    }
    return output;
  }

  receive(bytes: Uint8Array, mode: 'ASCII' | 'HEX', timestamps: boolean, badge: () => string): string {
    let output = '';
    if (mode !== this.mode) {
      if (this.mode === 'ASCII') output = this.text(this.decoder.decode(), timestamps, badge);
      this.decoder = new TextDecoder();
      this.mode = mode;
    }
    if (mode === 'HEX') return output + `\x1b[38;5;46m${toHex(bytes)} \x1b[0m`;
    return output + this.text(this.decoder.decode(bytes, { stream: true }), timestamps, badge);
  }

  echo(bytes: Uint8Array, mode: 'ASCII' | 'HEX'): string {
    this.lineStart = true;
    // Echo only the accepted prefix; preserve CR/LF instead of deleting them.
    const value = mode === 'HEX' ? toHex(bytes) : new TextDecoder().decode(bytes);
    return `\r\n\x1b[1;37;45m TX \x1b[0m \x1b[1;35m ${value}\x1b[0m\r\n`;
  }
}

export function listenSafely<T>(
  subscribe: (receive: (event: T) => void) => Promise<() => void>, receive: (event: T) => void,
  report: (error: unknown) => void = console.error,
): () => void {
  let disposed = false;
  let stop: (() => void) | undefined;
  void subscribe(event => { if (!disposed) receive(event); }).then(unsubscribe => {
    if (disposed) unsubscribe(); else stop = unsubscribe;
  }).catch(error => { if (!disposed) report(error); });
  return () => { if (!disposed) { disposed = true; stop?.(); } };
}
