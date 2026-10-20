import { decodeMqttPayload, toMqttHex } from "./mqttPayload";
import { MQTT_LIMITS } from "./mqttLimits";

export interface TreeNode {
  name: string;
  fullName: string;
  value?: string;
  originalValue?: string;
  originalBytes?: readonly number[];
  payloadIsUtf8?: boolean;
  jsonTruncated?: boolean;
  jsonSource?: { text: string; path: string[] };
  timestamp?: string;
  isJson?: boolean;
  isVirtual?: boolean;
  children: Record<string, TreeNode>;
  jsonChildren: Record<string, TreeNode>;
}

// Received names are keys in data dictionaries, never properties of a node.
export const childDictionary = (): Record<string, TreeNode> => Object.create(null);
export const createNode = (name: string, fullName: string): TreeNode => ({
  name, fullName, children: childDictionary(), jsonChildren: childDictionary(),
});
const hasChild = (children: Record<string, TreeNode>, name: string) =>
  Object.prototype.hasOwnProperty.call(children, name);
export const treeChildren = (node: TreeNode, viewMode: 'ASCII' | 'HEX' = 'ASCII'): TreeNode[] => [
  ...Object.values(node.children), ...(viewMode === 'HEX' ? [] : Object.values(node.jsonChildren)),
];
// JSON fields are interpreted values, not byte ranges of the publication.
export const treeNodeCopyValue = (node: TreeNode, viewMode: 'ASCII' | 'HEX'): string | undefined => {
  if (viewMode === 'HEX') return node.originalBytes === undefined ? undefined : toMqttHex(node.originalBytes);
  if (!node.jsonSource) return node.originalValue;
  // Parse/serialize a derived object only on copy, never retain the parsed subtree.
  let value: unknown = JSON.parse(node.jsonSource.text);
  for (const key of node.jsonSource.path) {
    if (value === null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return JSON.stringify(value);
};

// A topic segment and JSON field may have the same literal name and fullName.
export const treeNodeKey = (node: TreeNode): string => JSON.stringify([node.isVirtual ? 'json' : 'topic', node.name]);

export const buildTree = (messages: Array<{topic: string; payload_bytes: readonly number[]; timestamp: string}>) => {
  const root = createNode("root", "");

  messages.forEach((msg) => {
    const parts = msg.topic.split("/");
    let current = root;
    let pathSoFar = "";

    parts.forEach((part, index) => {
      pathSoFar += (index > 0 ? "/" : "") + part;

      if (!hasChild(current.children, part)) {
        current.children[part] = createNode(part, pathSoFar);
      }
      current = current.children[part];

      if (index === parts.length - 1) {
        current.timestamp = msg.timestamp;
        const decoded = decodeMqttPayload(msg.payload_bytes);
        current.originalBytes = msg.payload_bytes;
        current.payloadIsUtf8 = decoded.isUtf8;
        current.originalValue = decoded.text;

        // Replace this payload's fields without changing actual MQTT subtopics.
        current.jsonChildren = childDictionary();

        try {
          if (!decoded.isUtf8) throw new Error('Payload is not UTF-8');
          const json = JSON.parse(decoded.text);
          if (typeof json === 'object' && json !== null) {
            current.value = "{ JSON }";
            current.isJson = true;
            processJsonToTree(current, json, { remaining: MQTT_LIMITS.jsonNodes }, 0, current);
          } else {
            current.value = decoded.text;
            current.isJson = false;
          }
        } catch {
          current.value = decoded.text;
          current.isJson = false;
        }
      }
    });
  });

  return root;
};

const processJsonToTree = (node: TreeNode, jsonObj: object, budget = { remaining: MQTT_LIMITS.jsonNodes }, depth = 0, root = node, path: string[] = []) => {
  for (const [key, val] of Object.entries(jsonObj)) {
    if (budget.remaining <= 0 || depth >= MQTT_LIMITS.jsonDepth) { root.jsonTruncated = true; break; }
    budget.remaining--;
    const childName = key;

    if (!hasChild(node.jsonChildren, childName)) {
      node.jsonChildren[childName] = {
        ...createNode(childName, `${node.fullName}.${childName}`),
        isJson: true,
        isVirtual: true
      };
    }

    const childNode = node.jsonChildren[childName];

    if (typeof val === 'object' && val !== null) {
      childNode.value = "{...}";
      childNode.jsonSource = { text: root.originalValue ?? '', path: [...path, key] };
      processJsonToTree(childNode, val, budget, depth + 1, root, [...path, key]);
    } else {
      childNode.value = String(val);
      childNode.originalValue = String(val);
    }
  }
};

// Build only the incoming publication, then copy its path into the retained tree.
// Unrelated branches preserve identity; no historical message is replayed.
export function updateTopicTree(root: TreeNode, message: {topic: string; payload_bytes: readonly number[]; timestamp: string}): TreeNode {
  const fresh = buildTree([message]);
  const parts = message.topic.split('/');
  function merge(old: TreeNode, next: TreeNode, index: number): TreeNode {
    if (index === parts.length) return { ...next, children: old.children };
    const key = parts[index];
    const children = Object.assign(childDictionary(), old.children);
    children[key] = merge(Object.prototype.hasOwnProperty.call(old.children, key) ? old.children[key] : next.children[key], next.children[key], index + 1);
    return { ...old, children };
  }
  return merge(root, fresh, 0);
}

export function removeTopicTree(root: TreeNode, topic: string): TreeNode {
  const parts = topic.split('/');
  function remove(node: TreeNode, index: number): TreeNode | undefined {
    let updated: TreeNode;
    if (index === parts.length) {
      updated = { ...createNode(node.name, node.fullName), children: node.children };
    } else {
      const key = parts[index];
      if (!Object.prototype.hasOwnProperty.call(node.children, key)) return node;
      const child = remove(node.children[key], index + 1);
      const children = Object.assign(childDictionary(), node.children);
      if (child) children[key] = child; else delete children[key];
      updated = { ...node, children };
    }
    return updated.originalBytes !== undefined || Object.keys(updated.children).length ? updated : undefined;
  }
  return remove(root, 0) ?? createNode('root', '');
}
