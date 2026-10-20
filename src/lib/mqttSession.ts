export type MqttStatus = 'idle' | 'connecting' | 'connected' | 'stopping' | 'cancelled' | 'disconnected' | 'timed_out' | 'failed';
export interface MqttSnapshot { revision: number; session_id: number; status: MqttStatus; error: string | null }
export interface MqttMessage { session_id: number; sequence: number; topic: string; payload: string; qos: number }
export interface MqttViewMessage extends MqttMessage { timestamp: string; receivedAt: number }

export function startMqttMonitor(adapter: {
  state: (receive: (state: MqttSnapshot) => void) => Promise<() => void>;
  messages: (receive: (message: MqttMessage) => void) => Promise<() => void>;
  snapshot: () => Promise<MqttSnapshot>;
  apply: (state: MqttSnapshot) => void; message: (message: MqttMessage) => void;
  error: (error: unknown) => void;
}) {
  let disposed = false;
  let reconciled = false;
  let queued: MqttMessage[] = [];
  const stops: (() => void)[] = [];
  const stop = () => { if (!disposed) { disposed = true; queued = []; stops.splice(0).forEach(fn => fn()); } };
  const track = (promise: Promise<() => void>) => promise.then(fn => { if (disposed) fn(); else stops.push(fn); });
  void Promise.all([
    track(adapter.state(state => { if (!disposed) adapter.apply(state); })),
    track(adapter.messages(message => { if (!disposed) { if (reconciled) adapter.message(message); else queued.push(message); } })),
  ]).then(async () => {
    if (!disposed) {
      const state = await adapter.snapshot();
      if (!disposed) {
        adapter.apply(state); reconciled = true;
        queued.splice(0).forEach(message => adapter.message(message));
      }
    }
  }).catch(error => { if (!disposed) { adapter.error(error); stop(); } });
  return stop;
}

export function createMqttController<Config>(adapter: {
  begin: () => Promise<MqttSnapshot>; configure: (id: number, config: Config) => Promise<unknown>;
  cancel: (id: number) => Promise<MqttSnapshot>; disconnect: (id: number) => Promise<MqttSnapshot>;
  current: () => MqttSnapshot; apply: (state: MqttSnapshot) => void; pending: (pending: boolean) => void;
}) {
  interface Attempt { id?: number; cancelled: boolean; done: Promise<void>; stopping?: Promise<void> }
  let active: Attempt | null = null;
  const stopAttempt = (attempt: Attempt) => attempt.stopping ??= (async () => {
    if (attempt.id === undefined) return;
    try { adapter.apply(await adapter.cancel(attempt.id)); }
    catch (error) { if (adapter.current().session_id === attempt.id) throw error; }
    finally { if (active === attempt) { active = null; adapter.pending(false); } }
  })();
  return {
    connect(config: Config): Promise<void> {
      if (active) return active.done;
      const attempt: Attempt = { cancelled: false, done: Promise.resolve() };
      active = attempt; adapter.pending(true);
      attempt.done = (async () => {
        try {
          const state = await adapter.begin();
          attempt.id = state.session_id;
          adapter.apply(state);
          if (attempt.cancelled) { await stopAttempt(attempt); return; }
          if (adapter.current().session_id !== state.session_id || adapter.current().status !== 'connecting') return;
          await adapter.configure(state.session_id, config);
        } catch (error) {
          const relevant = active === attempt && (attempt.id === undefined || adapter.current().session_id === attempt.id);
          if (attempt.id !== undefined) await stopAttempt(attempt);
          if (relevant && !attempt.cancelled) throw error;
        } finally {
          if (active === attempt) { active = null; adapter.pending(false); }
        }
      })();
      return attempt.done;
    },
    async cancel() {
      const attempt = active;
      if (attempt) {
        attempt.cancelled = true;
        if (attempt.id !== undefined) await stopAttempt(attempt);
        else await attempt.done;
      } else {
        const id = adapter.current().session_id;
        try { adapter.apply(await adapter.cancel(id)); }
        catch (error) { if (adapter.current().session_id === id) throw error; }
      }
    },
    async disconnect() {
      const id = adapter.current().session_id;
      try { adapter.apply(await adapter.disconnect(id)); }
      catch (error) { if (adapter.current().session_id === id) throw error; }
    },
  };
}

// A late success/error from an old command must not mutate a replacement page/session.
export async function mqttOperation(id: number, current: () => MqttSnapshot, run: () => Promise<unknown>, success: () => void) {
  try {
    await run();
    const state = current();
    if (state.session_id !== id || state.status !== 'connected') return false;
    success(); return true;
  } catch (error) {
    if (current().session_id === id && current().status === 'connected') throw error;
    return false;
  }
}
