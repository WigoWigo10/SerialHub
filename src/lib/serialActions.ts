export interface SerialParameters {
  baud: number; data: number; stop: number; parity: string; flow: string;
}
export function createActionGate() {
  let busy = false;
  return async <T>(action: () => Promise<T>, pending: (value: boolean) => void): Promise<T | undefined> => {
    if (busy) return undefined;
    busy = true;
    try { pending(true); return await action(); }
    finally { busy = false; pending(false); }
  };
}
export const connectionAction = createActionGate();
export const recordingAction = createActionGate();
export const sendAction = createActionGate();

export function prepareSerialText(text: string, ending: 'NONE' | 'LF' | 'CRLF'): string {
  return text + (ending === 'LF' ? '\n' : ending === 'CRLF' ? '\r\n' : '');
}

export async function sendSerialText(content: string, send: (content: string) => Promise<number>): Promise<void> {
  const expected = new TextEncoder().encode(content).length;
  const accepted = await send(content);
  if (accepted !== expected) throw new Error(`${accepted}/${expected} bytes aceitos; envio incompleto, não reenviado automaticamente.`);
}

export async function toggleRecording(adapter: {
  active: () => boolean; choose: () => Promise<string | null>;
  start: (path: string) => Promise<unknown>; stop: () => Promise<unknown>;
}): Promise<'started' | 'stopped' | 'cancelled'> {
  if (adapter.active()) { await adapter.stop(); return 'stopped'; }
  const path = await adapter.choose();
  if (path === null) return 'cancelled';
  await adapter.start(path);
  return 'started';
}
