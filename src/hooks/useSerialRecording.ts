import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import toast from 'react-hot-toast';
import { startStateMonitor, SerialRecordingState } from '../lib/serialConnection';
import { useSettingsStore } from '../stores/settingsStore';

export function useSerialRecording() {
  useEffect(() => startStateMonitor<SerialRecordingState>({
    subscribe: receive => listen<SerialRecordingState>('serial-recording-state', event => receive(event.payload)),
    snapshot: () => invoke<SerialRecordingState>('serial_recording_state'),
    apply: snapshot => {
      const before = useSettingsStore.getState().recordingRevision;
      useSettingsStore.getState().applySerialRecording(snapshot);
      if (snapshot.revision > before && snapshot.error) toast.error(snapshot.error, { duration: 8000, id: 'serial-recording-error' });
    },
    reportError: error => console.error('Falha ao acompanhar gravação Serial:', error),
  }), []);
}
