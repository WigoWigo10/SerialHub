// Audit only: execute the actual pure TopicTree functions in isolated VM contexts.
// Does not contact a broker, open a Serial port, or change application state.
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../../../src/components/mqtt/TopicTree.tsx', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('const toHexDisplay'), source.indexOf('const TreeNodeItem'));
const code = ts.transpileModule(functions, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;
const results = Object.create(null);
for (const topic of ['sensor/temperature', '__proto__', 'constructor']) {
  const sandbox = vm.createContext({});
  vm.runInContext(code, sandbox);
  try {
    vm.runInContext(`buildTree([{topic: ${JSON.stringify(topic)}, payload: 'synthetic', timestamp: 'audit'}])`, sandbox, { timeout: 1000 });
    results[topic] = { error: null };
  } catch (error) {
    results[topic] = { error: error.message };
  }
  results[topic].objectPrototypeModified = vm.runInContext("Object.prototype.originalValue === 'synthetic'", sandbox);
}
const sandbox = vm.createContext({});
vm.runInContext(code, sandbox);
results.hex = {
  text: 'é',
  actual: vm.runInContext("toHexDisplay('\u00e9')", sandbox),
  expectedUtf8Bytes: Buffer.from('é').toString('hex').toUpperCase().match(/../g).join(' '),
};
const output = JSON.stringify(results, null, 2) + '\n';
writeFileSync(new URL('auditoria-estado-atual-probes.json', import.meta.url), output, 'utf8');
process.stdout.write(output);
