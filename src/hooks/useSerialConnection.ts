import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { startSerialConnectionMonitor, SerialConnectionState } from '../lib/serialConnection';
import { useSettingsStore } from '../stores/settingsStore';

export function useSerialConnection() {
  useEffect(() => startSerialConnectionMonitor({
    subscribe: receive => listen<SerialConnectionState>('serial-connection-state', event => receive(event.payload)),
    snapshot: () => invoke<SerialConnectionState>('serial_connection_state'),
    apply: state => useSettingsStore.getState().applySerialConnection(state),
    reportError: error => console.error('Falha ao acompanhar conexão Serial:', error),
  }), []);
}
