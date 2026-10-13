import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { transitionTheme } from '../lib/themeTransition';
import type { DashboardRefreshRate } from '../lib/dashboardRefresh';
import type { SerialConnectionState } from '../lib/serialConnection';

export type ActivityMode = 'SERIAL' | 'SETTINGS' | 'DASHBOARD' | 'monitor' | 'BLUETOOTH' | 'SPY' | 'MQTT';

interface SettingsState {
  theme: 'dark' | 'light';
  viewMode: 'ASCII' | 'HEX';
  localEcho: boolean;
  showTimestamp: boolean;
  language: 'pt-BR' | 'en-US' | 'es';
  dashboardRefreshRate: DashboardRefreshRate;
  setDashboardRefreshRate: (rate: DashboardRefreshRate) => void;

  connected: boolean;
  serialRevision: number;
  serialSessionId: number;
  serialError: string | null;
  applySerialConnection: (snapshot: SerialConnectionState) => void;
  activePort: string | null;
  connectionStartTime: number | null;
  isRecording: boolean;
  
  txBytes: number;
  rxBytes: number;

  activityMode: ActivityMode;
  isSidebarOpen: boolean;

  setTheme: (theme: 'dark' | 'light') => void;
  setLanguage: (lang: 'pt-BR' | 'en-US' | 'es') => void;
  setViewMode: (mode: 'ASCII' | 'HEX') => void;
  toggleLocalEcho: () => void;
  toggleTimestamp: () => void;
  
  setConnected: (status: boolean) => void;
  setActivePort: (port: string | null) => void;
  setRecording: (status: boolean) => void;
  
  addTxBytes: (bytes: number) => void;
  addRxBytes: (bytes: number) => void;
  resetCounters: () => void;

  setActivityMode: (mode: ActivityMode) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (isOpen: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      viewMode: 'ASCII',
      localEcho: false,
      showTimestamp: false,
      language: 'pt-BR',
      dashboardRefreshRate: 'auto',
      setDashboardRefreshRate: (dashboardRefreshRate) => set({ dashboardRefreshRate }),

      connected: false,
      serialRevision: -1,
      serialSessionId: 0,
      serialError: null,
      applySerialConnection: (snapshot) => set(state => {
        if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
          || !Number.isSafeInteger(snapshot.session_id) || snapshot.session_id < 0
          || snapshot.revision <= state.serialRevision) return state;
        const newSession = snapshot.connected && snapshot.session_id !== state.serialSessionId;
        const disconnected = !snapshot.connected && state.connected;
        return {
          serialRevision: snapshot.revision,
          serialSessionId: snapshot.session_id,
          serialError: snapshot.error,
          connected: snapshot.connected,
          activePort: snapshot.connected ? snapshot.port_name : null,
          connectionStartTime: snapshot.connected ? (newSession ? Date.now() : state.connectionStartTime) : null,
          ...((newSession || disconnected) ? { txBytes: 0, rxBytes: 0 } : {}),
        };
      }),
      activePort: null,
      connectionStartTime: null,
      isRecording: false,

      txBytes: 0,
      rxBytes: 0,

      activityMode: 'SERIAL',
      isSidebarOpen: true,

      setTheme: (theme) => transitionTheme(theme, get().theme, () => set({ theme })),
      setLanguage: (lang) => set({ language: lang }),
      setViewMode: (mode) => set({ viewMode: mode }),
      toggleLocalEcho: () => set((state) => ({ localEcho: !state.localEcho })),
      toggleTimestamp: () => set((state) => ({ showTimestamp: !state.showTimestamp })),
      
      setConnected: (status) => set({
        connected: status,
        connectionStartTime: status ? Date.now() : null,
        txBytes: 0,
        rxBytes: 0,
      }),

      setActivePort: (port) => set({ activePort: port }),
      setRecording: (status) => set({ isRecording: status }),

      addTxBytes: (bytes) => set((state) => ({ txBytes: state.txBytes + bytes })),
      addRxBytes: (bytes) => set((state) => ({ rxBytes: state.rxBytes + bytes })),
      resetCounters: () => set({ txBytes: 0, rxBytes: 0 }),

      setActivityMode: (mode) => set({ activityMode: mode }),
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
    }),
    {
      name: 'serialhub-settings',
      partialize: (state) => ({ 
        theme: state.theme,
        viewMode: state.viewMode,
        localEcho: state.localEcho,
        showTimestamp: state.showTimestamp,
        language: state.language,
        dashboardRefreshRate: state.dashboardRefreshRate,
        isSidebarOpen: state.isSidebarOpen
      }),
    }
  )
);
