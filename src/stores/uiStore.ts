import { create } from 'zustand';

type SidebarView = 'CONNECTIONS' | 'MACROS' | 'SETTINGS';

interface UiState {
  activeView: SidebarView;
  setActiveView: (view: SidebarView) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeView: 'CONNECTIONS',
  setActiveView: (view) => set({ activeView: view }),
}));