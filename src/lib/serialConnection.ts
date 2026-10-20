export interface SerialConnectionState {
  revision: number;
  session_id: number;
  connected: boolean;
  port_name: string | null;
  error: string | null;
}

interface StateMonitor<T> {
  subscribe: (receive: (state: T) => void) => Promise<() => void>;
  snapshot: () => Promise<T>;
  apply: (state: T) => void;
  reportError: (error: unknown) => void;
}

// Subscribe first, then reconcile the snapshot. The store rejects stale revisions.
// Late subscription/snapshot completions must not update an unmounted App.
export function startStateMonitor<T>(adapter: StateMonitor<T>): () => void {
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  const receive = (state: T) => { if (!disposed) adapter.apply(state); };
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

export function startSerialConnectionMonitor(adapter: StateMonitor<SerialConnectionState>): () => void {
  return startStateMonitor(adapter);
}

export interface SerialRecordingState {
  revision: number;
  recording: boolean;
  path: string | null;
  error: string | null;
}
