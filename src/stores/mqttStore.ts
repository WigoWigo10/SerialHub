import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface MqttProfile {
  id: string;
  name: string; 
  broker: string;
  port: number;
  clientId: string;
  username?: string;
  password?: string;
  savedTopics?: string[]; 
  
  // Segurança (mTLS)
  caFilePath?: string;
  certFilePath?: string;
  keyFilePath?: string;

  // LWT (Last Will)
  lwtTopic?: string;
  lwtPayload?: string;
  lwtQos?: number;
  lwtRetain?: boolean;
  
  useWebsockets?: boolean;
}

interface MqttStoreState {
  profiles: MqttProfile[];
  addProfile: (profile: Omit<MqttProfile, 'id'>) => void;
  removeProfile: (id: string) => void;
  updateProfile: (id: string, updates: Partial<MqttProfile>) => void;
}

export const useMqttStore = create<MqttStoreState>()(
  persist(
    (set) => ({
      profiles: [],
      addProfile: (profile) => set((state) => ({
        profiles: [...state.profiles, { ...profile, id: crypto.randomUUID() }]
      })),
      removeProfile: (id) => set((state) => ({
        profiles: state.profiles.filter((p) => p.id !== id)
      })),
      updateProfile: (id, updates) => set((state) => ({
        profiles: state.profiles.map((p) => p.id === id ? { ...p, ...updates } : p)
      })),
    }),
    {
      name: 'serialhub-mqtt-profiles', 
      storage: createJSONStorage(() => localStorage),
    }
  )
);