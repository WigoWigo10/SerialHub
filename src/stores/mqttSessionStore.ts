import { create } from 'zustand';
import { MqttMonitorProgress, initialMqttMonitor } from '../lib/mqttMonitor';
import { isMqttPayloadBytes } from '../lib/mqttPayload';
import { MQTT_LIMITS, mqttTopicFits } from '../lib/mqttLimits';
import { MqttRetention, emptyMqttRetention, retainMqttMessage, addMqttChart } from '../lib/mqttRetention';
import { createNode } from '../lib/mqttTree';
import type { MqttSnapshot, MqttMessage } from '../lib/mqttSession';

interface SessionState extends MqttRetention {
  snapshot: MqttSnapshot;
  reserving: boolean;
  monitor: MqttMonitorProgress & { generation: number };
  monitorEpoch: number;
  beginMonitor: () => number;
  monitorProgress: (generation: number, progress: MqttMonitorProgress) => void;
  restartMonitor: () => void;
  subscriptions: string[];
  lastSequence: number;
  applySnapshot: (state: MqttSnapshot) => void;
  applyMessage: (message: MqttMessage) => void;
  clearMessages: () => void;
  clearLatest: () => void;
  addChart: (key: string) => boolean;
  removeChart: (key: string) => void;
  subscription: (id: number, topic: string, active: boolean) => void;
}

// Ephemeral global state: connection, traffic and credentials are never persisted.
export const useMqttSessionStore = create<SessionState>((set, get) => ({
  snapshot: { revision: -1, session_id: 0, status: 'idle', error: null },
  monitor: { ...initialMqttMonitor(), phase: 'stopped', generation: 0 }, monitorEpoch: 0,
  beginMonitor: () => {
    const generation = get().monitor.generation + 1;
    set({ monitor: { ...initialMqttMonitor(), generation } }); return generation;
  },
  monitorProgress: (generation, progress) => set(state => state.monitor.generation === generation ? { monitor: { ...progress, generation } } : state),
  restartMonitor: () => set(state => ({ monitorEpoch: state.monitorEpoch + 1 })),
  ...emptyMqttRetention(), reserving: false, subscriptions: [], lastSequence: 0,
  applySnapshot: snapshot => set(state => {
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || snapshot.revision <= state.snapshot.revision
      || !Number.isSafeInteger(snapshot.session_id) || snapshot.session_id < state.snapshot.session_id) return state;
    const changedSession = snapshot.session_id !== state.snapshot.session_id;
    return { snapshot, ...(changedSession ? { ...emptyMqttRetention(), lastSequence: 0 } : {}),
      ...((changedSession || snapshot.status !== 'connected') ? { subscriptions: [] } : {}) };
  }),
  applyMessage: message => set(state => {
    if (message.session_id !== state.snapshot.session_id || state.snapshot.status !== 'connected'
      || !Number.isSafeInteger(message.state_revision) || message.state_revision < 0 || message.state_revision > state.snapshot.revision
      || !Number.isSafeInteger(message.sequence) || message.sequence <= state.lastSequence || !isMqttPayloadBytes(message.payload_bytes)) return state;
    return { ...retainMqttMessage(state, message), lastSequence: message.sequence };
  }),
  clearMessages: () => set({ messages: [], historyBytes: 0 }),
  clearLatest: () => set({ latest: new Map(), latestBytes: 0, tree: createNode('root', ''), charts: new Map() }),
  addChart: key => {
    const charts = addMqttChart(get(), key);
    if (!charts) return false;
    set({ charts }); return true;
  },
  removeChart: key => set(state => { const charts = new Map(state.charts); charts.delete(key); return { charts }; }),
  subscription: (id, topic, active) => set(state => {
    if (state.snapshot.session_id !== id || state.snapshot.status !== 'connected') return state;
    if (active && (!mqttTopicFits(topic) || (!state.subscriptions.includes(topic) && state.subscriptions.length >= MQTT_LIMITS.subscriptions))) return state;
    return { subscriptions: active ? [...new Set([...state.subscriptions, topic])] : state.subscriptions.filter(item => item !== topic) };
  }),
}));
