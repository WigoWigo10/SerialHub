import { create } from 'zustand';
import type { MqttSnapshot, MqttMessage, MqttViewMessage } from '../lib/mqttSession';

interface SessionState {
  snapshot: MqttSnapshot;
  reserving: boolean;
  messages: MqttViewMessage[];
  subscriptions: string[];
  lastSequence: number;
  applySnapshot: (state: MqttSnapshot) => void;
  applyMessage: (message: MqttMessage) => void;
  clearMessages: () => void;
  subscription: (id: number, topic: string, active: boolean) => void;
}

// Ephemeral global state: connection, traffic and credentials are never persisted.
export const useMqttSessionStore = create<SessionState>((set) => ({
  snapshot: { revision: -1, session_id: 0, status: 'idle', error: null },
  reserving: false, messages: [], subscriptions: [], lastSequence: 0,
  applySnapshot: snapshot => set(state => {
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || snapshot.revision <= state.snapshot.revision
      || !Number.isSafeInteger(snapshot.session_id) || snapshot.session_id < state.snapshot.session_id) return state;
    const changedSession = snapshot.session_id !== state.snapshot.session_id;
    return { snapshot, ...(changedSession ? { lastSequence: 0 } : {}),
      ...((changedSession || snapshot.status !== 'connected') ? { subscriptions: [] } : {}) };
  }),
  applyMessage: message => set(state => {
    if (message.session_id !== state.snapshot.session_id || state.snapshot.status !== 'connected'
      || !Number.isSafeInteger(message.sequence) || message.sequence <= state.lastSequence) return state;
    const receivedAt = Date.now();
    return { lastSequence: message.sequence, messages: [...state.messages, { ...message, receivedAt, timestamp: new Date(receivedAt).toLocaleTimeString() }] };
  }),
  clearMessages: () => set({ messages: [] }),
  subscription: (id, topic, active) => set(state => {
    if (state.snapshot.session_id !== id || state.snapshot.status !== 'connected') return state;
    return { subscriptions: active ? [...new Set([...state.subscriptions, topic])] : state.subscriptions.filter(item => item !== topic) };
  }),
}));
