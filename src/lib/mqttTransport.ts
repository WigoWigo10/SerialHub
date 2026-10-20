export type MqttTransport = 'tcp' | 'tls' | 'ws' | 'wss';
export const mqttTransports: MqttTransport[] = ['tcp', 'tls', 'ws', 'wss'];
export const isMqttTransport = (value: unknown): value is MqttTransport => mqttTransports.includes(value as MqttTransport);
export const isSecureTransport = (mode: MqttTransport) => mode === 'tls' || mode === 'wss';

interface ProfileTransport {
  transport?: unknown; transportNeedsReview?: boolean; websocketPath?: string;
  useWebsockets?: boolean; port?: number; broker?: string;
  caFilePath?: string; certFilePath?: string; keyFilePath?: string;
}

// A guessed mode is never permission to connect: all legacy/unknown profiles
// require explicit review. Preserve every original field for that decision.
export function migrateMqttTransport<T extends ProfileTransport>(profile: T) {
  if (isMqttTransport(profile.transport)) return {
    ...profile, transport: profile.transport, transportNeedsReview: profile.transportNeedsReview === true,
  };
  const oldMode = String(profile.transport || '').toLowerCase();
  const ws = profile.useWebsockets === true || /^wss?:\/\//i.test(profile.broker || '') || oldMode === 'ws' || oldMode === 'wss';
  const secure = [profile.caFilePath, profile.certFilePath, profile.keyFilePath].some(p => !!p?.trim())
    || profile.port === 8883 || profile.port === 443 || /^(wss|mqtts|tls):\/\//i.test(profile.broker || '')
    || ['tls', 'wss', 'ssl', 'mqtts'].includes(oldMode);
  return {
    ...profile, transport: (ws ? (secure ? 'wss' : 'ws') : (secure ? 'tls' : 'tcp')) as MqttTransport,
    transportNeedsReview: true,
  };
}

export function mqttConfigurationError(config: {
  transport: MqttTransport; transportNeedsReview?: boolean; broker?: string;
  caPath: string; certPath: string; keyPath: string; websocketPath: string;
}) {
  if (config.transportNeedsReview) return 'mqtt_transport_review' as const;
  if (!!config.certPath.trim() !== !!config.keyPath.trim()) return 'mqtt_transport_pair' as const;
  if (!isSecureTransport(config.transport) && [config.caPath, config.certPath, config.keyPath].some(p => !!p.trim())) return 'mqtt_transport_plain_files' as const;
  if (config.broker !== undefined && (!config.broker || /[\s/\\?#@]/.test(config.broker))) return 'mqtt_transport_host' as const;
  if ((config.transport === 'ws' || config.transport === 'wss')
    && (!config.websocketPath.startsWith('/') || /[\s#\\]/.test(config.websocketPath))) return 'mqtt_transport_path' as const;
  return null;
}
