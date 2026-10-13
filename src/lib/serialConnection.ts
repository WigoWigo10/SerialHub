export interface SerialConnectionState {
  revision: number;
  session_id: number;
  connected: boolean;
  port_name: string | null;
  error: string | null;
}

interface ConnectionMonitor {
  subscribe: (receive: (state: SerialConnectionState) => void) => Promise<() => void>;
  snapshot: () => Promise<SerialConnectionState>;
  apply: (state: SerialConnectionState) => void;
  reportError: (error: unknown) => void;
}

// Subscribe first, then reconcile the snapshot. The store rejects stale revisions.
// Late subscription/snapshot completions must not update an unmounted App.
export function startSerialConnectionMonitor(adapter: ConnectionMonitor): () => void {
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  const receive = (state: SerialConnectionState) => { if (!disposed) adapter.apply(state); };
  void adapter.subscribe(receive).then(async stop => {
    if (disposed) { stop(); return; }
    unsubscribe = stop;
    receive(await adapter.snapshot());
  }).catch(error => { if (!disposed) adapter.reportError(error); });
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
    unsubscribe = undefined;
  };
}
