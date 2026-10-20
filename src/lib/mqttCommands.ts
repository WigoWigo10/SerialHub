import { invoke } from '@tauri-apps/api/core';
import { createMqttController, MqttSnapshot } from './mqttSession';
import { useMqttSessionStore } from '../stores/mqttSessionStore';

export const mqttCommands = createMqttController<Record<string, unknown>>({
  begin: () => invoke<MqttSnapshot>('mqtt_begin_attempt'),
  configure: (id, config) => invoke('connect_mqtt', { ...config, expectedSessionId: id }),
  cancel: id => invoke<MqttSnapshot>('cancel_mqtt', { expectedSessionId: id }),
  disconnect: id => invoke<MqttSnapshot>('disconnect_mqtt', { expectedSessionId: id }),
  current: () => useMqttSessionStore.getState().snapshot,
  apply: state => useMqttSessionStore.getState().applySnapshot(state),
  pending: reserving => useMqttSessionStore.setState({ reserving }),
});
