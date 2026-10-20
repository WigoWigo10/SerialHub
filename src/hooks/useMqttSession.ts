import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import toast from 'react-hot-toast';
import { startMqttMonitor, MqttSnapshot, MqttMessage } from '../lib/mqttSession';
import { useMqttSessionStore } from '../stores/mqttSessionStore';

export function useMqttSession() {
  useEffect(() => startMqttMonitor({
    state: receive => listen<MqttSnapshot>('mqtt-state', event => receive(event.payload)),
    messages: receive => listen<MqttMessage>('mqtt-message', event => receive(event.payload)),
    snapshot: () => invoke<MqttSnapshot>('mqtt_connection_state'),
    apply: snapshot => {
      const before = useMqttSessionStore.getState().snapshot;
      useMqttSessionStore.getState().applySnapshot(snapshot);
      if (useMqttSessionStore.getState().snapshot === snapshot && snapshot.revision > before.revision && snapshot.error) {
        toast.error(snapshot.error, { id: `mqtt-error-${snapshot.session_id}`, duration: 8000 });
      }
    },
    message: message => useMqttSessionStore.getState().applyMessage(message),
    error: error => console.error('Falha ao acompanhar sessão MQTT:', error),
  }), []);
}
