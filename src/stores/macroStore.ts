import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface Macro {
  id: string;
  name: string;
  command: string;
  color: string;
}

interface MacroState {
  macros: Macro[];
  addMacro: (macro: Omit<Macro, 'id'>) => void;
  removeMacro: (id: string) => void;
  editMacro: (id: string, updates: Partial<Macro>) => void;
}

export const useMacroStore = create<MacroState>()(
  persist(
    (set) => ({
      macros: [],
      
      addMacro: (macro) => set((state) => ({
        macros: [...state.macros, { ...macro, id: crypto.randomUUID() }] 
      })),

      removeMacro: (id) => set((state) => ({
        macros: state.macros.filter((m) => m.id !== id)
      })),

      editMacro: (id, updates) => set((state) => ({
        macros: state.macros.map((m) => m.id === id ? { ...m, ...updates } : m)
      })),
    }),
    {
      name: 'serialhub-macros',
      storage: createJSONStorage(() => localStorage),
    }
  )
);