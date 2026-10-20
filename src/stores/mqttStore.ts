import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { migrateMqttTransport, MqttTransport } from '../lib/mqttTransport';

export interface MqttProfile {
  id: string;
  name: string; 
  broker: string;
  port: number;
  clientId: string;
  username?: string;
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
  transport: MqttTransport;
  transportNeedsReview: boolean;
  websocketPath?: string;
}

interface MqttStoreState {
  profiles: MqttProfile[];
  addProfile: (profile: Omit<MqttProfile, 'id'>) => void;
  removeProfile: (id: string) => void;
  updateProfile: (id: string, updates: Partial<MqttProfile>) => void;
}

// Also discard passwords supplied by legacy callers or stored profiles.
const withoutPassword = (profile: MqttProfile): MqttProfile => {
  const { password: _password, ...settings } = profile as MqttProfile & { password?: unknown };
  return migrateMqttTransport(settings);
};

export const useMqttStore = create<MqttStoreState>()(
  persist(
    (set) => ({
      profiles: [],
      addProfile: (profile) => set((state) => ({
        profiles: [...state.profiles, withoutPassword({ ...profile, id: crypto.randomUUID() })]
      })),
      removeProfile: (id) => set((state) => ({
        profiles: state.profiles.filter((p) => p.id !== id)
      })),
      updateProfile: (id, updates) => set((state) => ({
        profiles: state.profiles.map((p) => p.id === id ? withoutPassword({ ...p, ...updates }) : p)
      })),
    }),
    {
      name: 'serialhub-mqtt-profiles', 
      storage: createJSONStorage(() => {
        const storage = localStorage;
        return {
          getItem: (name) => {
            const raw = storage.getItem(name);
            if (raw === null) return null;
            const stored = JSON.parse(raw);
            // Rewrite old JSON immediately, even before any profile is edited.
            // Keep the envelope and every other profile field intact.
            if (Array.isArray(stored?.state?.profiles)) {
              const cleanedProfiles = stored.state.profiles.map(withoutPassword);
              if (JSON.stringify(cleanedProfiles) !== JSON.stringify(stored.state.profiles)) {
                stored.state.profiles = cleanedProfiles;
                const cleaned = JSON.stringify(stored);
                storage.setItem(name, cleaned);
                return cleaned;
              }
            }
            return raw;
          },
          setItem: (name, value) => storage.setItem(name, value),
          removeItem: (name) => storage.removeItem(name),
        };
      }),
      partialize: (state) => ({ profiles: state.profiles.map(withoutPassword) }),
    }
  )
);
