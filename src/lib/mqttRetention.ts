import { MQTT_LIMITS, mqttTopicFits } from './mqttLimits';
import { decodeMqttPayload } from './mqttPayload';
import { createNode, removeTopicTree, updateTopicTree, TreeNode } from './mqttTree';
import type { MqttMessage, MqttViewMessage } from './mqttSession';

export interface ChartDataPoint { time: string; value: number; originalTime: number }
export interface MqttChartSeries { sourceTopic: string; fieldPath: string[]; samples: ChartDataPoint[] }
export interface MqttDiscards { history: number; topics: number; payloads: number; topicShape: number }
export interface MqttRetention {
  messages: MqttViewMessage[];
  historyBytes: number;
  latest: Map<string, MqttViewMessage>;
  latestBytes: number;
  tree: TreeNode;
  charts: Map<string, MqttChartSeries>;
  discards: MqttDiscards;
}
export const emptyMqttRetention = (): MqttRetention => ({
  messages: [], historyBytes: 0, latest: new Map(), latestBytes: 0,
  tree: createNode('root', ''), charts: new Map(),
  discards: { history: 0, topics: 0, payloads: 0, topicShape: 0 },
});
const increment = (value: number) => Math.min(Number.MAX_SAFE_INTEGER, value + 1);

// Only own JSON fields are traversed; these series never retain messages/payloads.
export function chartValue(message: MqttViewMessage, fieldPath: readonly string[]): number | undefined {
  if (!message.payloadIsUtf8) return undefined;
  let value: unknown = message.payload;
  if (fieldPath.length) {
    try {
      value = JSON.parse(message.payload);
      for (const key of fieldPath) {
        if (value === null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
        value = (value as Record<string, unknown>)[key];
      }
    } catch { return undefined; }
  }
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const number = parseFloat(String(value));
  return Number.isFinite(number) ? number : undefined;
}
const sample = (message: MqttViewMessage, value: number): ChartDataPoint => ({
  time: message.timestamp, value, originalTime: message.receivedAt,
});
function retainedField(tree: TreeNode, topic: string, fieldPath: readonly string[]): boolean {
  let node: TreeNode | undefined = tree;
  for (const segment of topic.split('/')) node = node?.children[segment];
  for (const field of fieldPath) node = node?.jsonChildren[field];
  return node !== undefined;
}

export function addMqttChart(state: MqttRetention, key: string): Map<string, MqttChartSeries> | undefined {
  if (state.charts.has(key)) return state.charts;
  if (state.charts.size >= MQTT_LIMITS.charts) return undefined;
  let sourceTopic = key;
  let message = state.latest.get(key);
  let fieldPath: string[] = [];
  if (!message) {
    // Preserve the textual chart identifier; prefer the longest retained parent.
    const parent = [...state.latest.keys()].filter(topic => key.startsWith(`${topic}.`)).sort((a, b) => b.length - a.length)[0];
    if (parent === undefined) return undefined;
    sourceTopic = parent; message = state.latest.get(parent)!;
    fieldPath = key.slice(parent.length + 1).split('.');
  }
  if (!retainedField(state.tree, sourceTopic, fieldPath)) return undefined;
  const value = chartValue(message, fieldPath);
  if (value === undefined) return undefined;
  return new Map(state.charts).set(key, { sourceTopic, fieldPath, samples: [sample(message, value)] });
}

// Called once per accepted, ordered event, independently of React mounting/rendering.
export function retainMqttMessage(state: MqttRetention, event: MqttMessage, receivedAt = Date.now()): MqttRetention {
  const size = event.payload_bytes.length;
  if (size > MQTT_LIMITS.payloadBytes) return { ...state, discards: { ...state.discards, payloads: increment(state.discards.payloads) } };
  if (!mqttTopicFits(event.topic)) return { ...state, discards: { ...state.discards, topicShape: increment(state.discards.topicShape) } };
  const payload_bytes = event.payload_bytes.slice();
  const decoded = decodeMqttPayload(payload_bytes);
  const message: MqttViewMessage = { ...event, payload_bytes, payload: decoded.text, payloadIsUtf8: decoded.isUtf8,
    receivedAt, timestamp: new Date(receivedAt).toLocaleTimeString() };
  const discards = { ...state.discards };
  const messages = [...state.messages, message];
  let historyBytes = state.historyBytes + size;
  while (messages.length > MQTT_LIMITS.historyMessages || historyBytes > MQTT_LIMITS.historyBytes) {
    historyBytes -= messages.shift()!.payload_bytes.length;
    discards.history = increment(discards.history);
  }
  const latest = new Map(state.latest);
  let latestBytes = state.latestBytes - (latest.get(event.topic)?.payload_bytes.length ?? 0) + size;
  latest.delete(event.topic); latest.set(event.topic, message);
  let tree = state.tree;
  const charts = new Map(state.charts);
  while (latest.size > MQTT_LIMITS.latestTopics || latestBytes > MQTT_LIMITS.latestBytes) {
    const topic = latest.keys().next().value!;
    latestBytes -= latest.get(topic)!.payload_bytes.length;
    latest.delete(topic); tree = removeTopicTree(tree, topic);
    for (const [key, series] of charts) if (series.sourceTopic === topic) charts.delete(key);
    discards.topics = increment(discards.topics);
  }
  tree = updateTopicTree(tree, message);
  for (const [key, series] of charts) {
    if (series.sourceTopic !== message.topic) continue;
    if (!retainedField(tree, series.sourceTopic, series.fieldPath)) { charts.delete(key); continue; }
    const value = chartValue(message, series.fieldPath);
    if (value === undefined) {
      if (series.fieldPath.length) charts.delete(key);
      continue;
    }
    charts.set(key, { ...series, samples: [...series.samples, sample(message, value)].slice(-MQTT_LIMITS.chartSamples) });
  }
  return { messages, historyBytes, latest, latestBytes, tree, charts, discards };
}
