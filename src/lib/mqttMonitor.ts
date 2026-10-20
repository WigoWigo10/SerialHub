import { MQTT_LIMITS, mqttTopicFits } from './mqttLimits';
import { isMqttPayloadBytes } from './mqttPayload';
import type { MqttMessage, MqttSnapshot } from './mqttSession';

export type MqttMonitorPhase = 'syncing' | 'live' | 'failed' | 'stopped';
export type MqttQueueDrop = 'capacity' | 'oversize' | 'obsolete' | 'duplicate' | 'invalid' | 'closed';
export interface MqttMonitorProgress {
  phase: MqttMonitorPhase;
  queuedMessages: number;
  queuedBytes: number;
  drops: Record<MqttQueueDrop, number>;
  error: string | null;
}
export const initialMqttMonitor = (): MqttMonitorProgress => ({
  phase: 'syncing', queuedMessages: 0, queuedBytes: 0,
  drops: { capacity: 0, oversize: 0, obsolete: 0, duplicate: 0, invalid: 0, closed: 0 }, error: null,
});
interface Adapter {
  state: (receive: (state: MqttSnapshot) => void) => Promise<() => void>;
  messages: (receive: (message: MqttMessage) => void) => Promise<() => void>;
  snapshot: () => Promise<MqttSnapshot>;
  apply: (state: MqttSnapshot) => void;
  message: (message: MqttMessage) => void;
  error: (error: unknown) => void;
  view?: () => { snapshot: MqttSnapshot; lastSequence: number };
  progress?: (progress: MqttMonitorProgress) => void;
  // Injectable deadline scheduler for deterministic tests; one timer per monitor.
  schedule?: (milliseconds: number, callback: () => void) => () => void;
}
type Stop = (() => void) & { done: Promise<'stopped' | 'failed'> };

// Pending native promises cannot be forcibly cancelled. Their continuations own
// only this detachable cell after close, not the monitor/adapter/payload queue.
function observe<T>(promise: Promise<T>, success: (value: T) => void, failure: (error: unknown) => void,
  late?: (value: T) => void): () => void {
  const cell: { success?: typeof success; failure?: typeof failure } = { success, failure };
  void Promise.resolve(promise).then(value => {
    const callback = cell.success; cell.success = undefined; cell.failure = undefined;
    if (callback) callback(value); else late?.(value);
  }, error => {
    const callback = cell.failure; cell.success = undefined; cell.failure = undefined; callback?.(error);
  }).catch(() => { /* Adapter exceptions cannot leave an unhandled native continuation. */ });
  return () => { cell.success = undefined; cell.failure = undefined; };
}
const lateUnsubscribe = (stop: () => void) => { try { stop(); } catch { /* already detached */ } };
const scheduleDefault = (milliseconds: number, callback: () => void) => {
  const timer = setTimeout(callback, milliseconds); return () => clearTimeout(timer);
};
const terminal = (state: MqttSnapshot) => !['connecting', 'connected'].includes(state.status);
const safe = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function startMqttMonitor(adapter: Adapter): Stop {
  let target: Adapter | null = adapter;
  let progress = initialMqttMonitor();
  let observed: MqttSnapshot | null = null;
  let reconciled = false;
  let draining = false;
  let queued: MqttMessage[] = [];
  let queuedBytes = 0;
  let deliveredSession = -1;
  let deliveredSequence = 0;
  let deadline: (() => void) | undefined;
  const stops: (() => void)[] = [];
  const detaches = new Set<() => void>();
  let finish!: (reason: 'stopped' | 'failed') => void;
  const done = new Promise<'stopped' | 'failed'>(resolve => { finish = resolve; });
  const report = () => {
    progress = { ...progress, queuedMessages: queued.length, queuedBytes };
    target?.progress?.({ ...progress, drops: { ...progress.drops } });
  };
  const drop = (reason: MqttQueueDrop, count = 1) => {
    progress = { ...progress, drops: { ...progress.drops,
      [reason]: Math.min(Number.MAX_SAFE_INTEGER, progress.drops[reason] + count) } };
  };
  const close = (reason: 'stopped' | 'failed') => {
    if (!target) return;
    drop('closed', queued.length); queued = []; queuedBytes = 0;
    deadline?.(); deadline = undefined;
    detaches.forEach(detach => detach()); detaches.clear();
    stops.splice(0).forEach(lateUnsubscribe);
    observed = null;
    progress = { ...progress, phase: reason }; report();
    target = null; finish(reason);
  };
  const fail = (error: unknown) => {
    if (!target) return;
    const reportError = target.error;
    progress = { ...progress, error: String(error).slice(0, 500) };
    close('failed'); reportError(error);
  };
  const arm = () => {
    if (deadline || !target) return;
    deadline = (target.schedule ?? scheduleDefault)(MQTT_LIMITS.syncTimeoutMs,
      () => fail(new Error('MQTT synchronization deadline exceeded')));
  };
  const view = () => {
    const external = target?.view?.();
    if (external && (!observed || (external.snapshot.session_id >= observed.session_id && external.snapshot.revision >= observed.revision))) {
      observed = external.snapshot;
    }
    const sequence = observed?.session_id === deliveredSession ? deliveredSequence : 0;
    return { snapshot: observed, lastSequence: Math.max(sequence,
      external?.snapshot.session_id === observed?.session_id ? external?.lastSequence ?? 0 : 0) };
  };
  const classify = (message: MqttMessage): 'ready' | 'future' | 'obsolete' | 'duplicate' => {
    const current = view();
    if (!current.snapshot || message.session_id > current.snapshot.session_id) return 'future';
    if (message.session_id < current.snapshot.session_id || terminal(current.snapshot)) return 'obsolete';
    if (message.sequence <= current.lastSequence) return 'duplicate';
    return current.snapshot.status === 'connected' && message.state_revision <= current.snapshot.revision ? 'ready' : 'future';
  };
  const drain = () => {
    if (!target || draining) return;
    draining = true;
    try {
      for (let index = 0; index < queued.length && target;) {
        const message = queued[index];
        const disposition = classify(message);
        if (disposition === 'future' || (!reconciled && disposition === 'ready')) { index++; continue; }
        queued.splice(index, 1); queuedBytes -= message.payload_bytes.length;
        if (disposition === 'ready') {
          deliveredSession = message.session_id; deliveredSequence = message.sequence;
          target.message(message);
        } else drop(disposition);
      }
    } finally { draining = false; }
    if (reconciled && !queued.length) { deadline?.(); deadline = undefined; }
    else arm();
    report();
  };
  const receiveState = (state: MqttSnapshot) => {
    if (!target) return;
    if (!safe(state.session_id) || !safe(state.revision)) { fail(new Error('Invalid MQTT snapshot identity')); return; }
    const current = view().snapshot;
    if (!current || (state.session_id >= current.session_id && state.revision > current.revision)) {
      observed = state; target.apply(state);
    }
    drain();
  };
  const receiveMessage = (message: MqttMessage) => {
    if (!target) return;
    if (!safe(message.session_id) || !safe(message.sequence) || message.sequence === 0 || !safe(message.state_revision)
      || typeof message.topic !== 'string' || !isMqttPayloadBytes(message.payload_bytes)) {
      drop('invalid'); report(); return;
    }
    const disposition = classify(message);
    if (disposition === 'obsolete' || disposition === 'duplicate') { drop(disposition); report(); return; }
    if (reconciled && disposition === 'ready' && !draining && !queued.length) {
      deliveredSession = message.session_id; deliveredSequence = message.sequence;
      target.message(message); return;
    }
    if (!mqttTopicFits(message.topic)) { drop('invalid'); report(); return; }
    if (queued.some(item => item.session_id === message.session_id && item.sequence === message.sequence)) {
      drop('duplicate'); report(); return;
    }
    if (message.payload_bytes.length > Math.min(MQTT_LIMITS.payloadBytes, MQTT_LIMITS.syncBytes)) {
      drop('oversize'); report(); return;
    }
    queued.push(message); queuedBytes += message.payload_bytes.length;
    queued.sort((a, b) => a.session_id - b.session_id || a.sequence - b.sequence);
    while (queued.length > MQTT_LIMITS.syncMessages || queuedBytes > MQTT_LIMITS.syncBytes) {
      queuedBytes -= queued.shift()!.payload_bytes.length; drop('capacity');
    }
    drain();
  };
  const watch = <T,>(promise: Promise<T>, success: (value: T) => void, late?: (value: T) => void) => {
    let detach!: () => void;
    detach = observe(promise, value => {
      detaches.delete(detach);
      if (target) { try { success(value); } catch (error) { fail(error); } }
    },
      error => { detaches.delete(detach); fail(error); }, late);
    detaches.add(detach);
  };
  let registered = 0;
  const registeredListener = (stop: () => void) => {
    stops.push(stop);
    if (++registered === 2 && target) watch(target.snapshot(), snapshot => {
      receiveState(snapshot);
      if (!target) return;
      reconciled = true; progress = { ...progress, phase: 'live' };
      deadline?.(); deadline = undefined; drain();
    });
  };
  report(); arm();
  const guarded = <T,>(receive: (value: T) => void) => (value: T) => {
    if (!target) return;
    try { receive(value); } catch (error) { fail(error); }
  };
  try {
    watch(adapter.state(guarded(receiveState)), registeredListener, lateUnsubscribe);
    watch(adapter.messages(guarded(receiveMessage)), registeredListener, lateUnsubscribe);
  } catch (error) { fail(error); }
  return Object.assign(() => close('stopped'), { done });
}
