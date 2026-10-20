// Payload byte budgets are not estimates of total JavaScript/process memory.
export const MQTT_LIMITS = Object.freeze({
  syncMessages: 128,
  syncBytes: 1024 * 1024,
  syncTimeoutMs: 5000,
  historyMessages: 500,
  historyBytes: 2 * 1024 * 1024,
  latestTopics: 256,
  latestBytes: 4 * 1024 * 1024,
  payloadBytes: 256 * 1024,
  topicBytes: 1024,
  topicLevels: 32,
  charts: 3,
  chartSamples: 100,
  subscriptions: 128,
  jsonNodes: 256,
  jsonDepth: 8,
});
export const mqttTopicFits = (topic: string): boolean =>
  new TextEncoder().encode(topic).length <= MQTT_LIMITS.topicBytes && topic.split('/').length <= MQTT_LIMITS.topicLevels;
