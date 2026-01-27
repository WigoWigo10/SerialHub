import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  theme: 'dark' | 'light';
  viewMode: 'ASCII' | 'HEX';
  localEcho: boolean;
  showTimestamp: boolean;
  language: 'pt-BR' | 'en-US' | 'es';

  connected: boolean;
  activePort: string | null;
  connectionStartTime: number | null;
  isRecording: boolean;
  
  txBytes: number;
  rxBytes: number;

  activityMode: string;
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

  setActivityMode: (mode: string) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (isOpen: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      viewMode: 'ASCII',
      localEcho: false,
      showTimestamp: false,
      language: 'pt-BR',

      connected: false,
      activePort: null,
      connectionStartTime: null,
      isRecording: false,

      txBytes: 0,
      rxBytes: 0,

      activityMode: 'SERIAL',
      isSidebarOpen: true,

      setTheme: (theme) => set({ theme }),
      setLanguage: (lang) => set({ language: lang }),
      setViewMode: (mode) => set({ viewMode: mode }),
      toggleLocalEcho: () => set((state) => ({ localEcho: !state.localEcho })),
      toggleTimestamp: () => set((state) => ({ showTimestamp: !state.showTimestamp })),
      
      setConnected: (status) => set({ 
        connected: status,
        connectionStartTime: status ? Date.now() : null,
        txBytes: status ? 0 : 0, 
        rxBytes: status ? 0 : 0
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
        isSidebarOpen: state.isSidebarOpen
      }),
    }
  )
);