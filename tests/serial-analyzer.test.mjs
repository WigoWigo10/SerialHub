import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/serialAnalyzer.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020,
} });
const { numericFields, SerialAnalyzerBuffer } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const bytes = text => new TextEncoder().encode(text);

test('extracts finite JSON fields and table columns including quoted text and empty columns', () => {
  assert.deepEqual([...numericFields('{"temperature":24.2,"active":true,"value":"3","__proto__":6}')],
    [['temperature', 24.2], ['__proto__', 6]]);
  assert.deepEqual([...numericFields('"device, 1";2.5;-3e2;')], [['#2', 2.5], ['#3', -300]]);
  assert.deepEqual([...numericFields('\t2\t-3')], [['#2', 2], ['#3', -3]]);
  assert.equal(numericFields('{"malformed":42,').size, 0);
  assert.equal(numericFields('6e400,0x30,"broken').size, 0);
});

test('frames split UTF-8 and CRLF without inventing a measurement at the packet boundary', () => {
  const stream = new SerialAnalyzerBuffer();
  const frame = bytes('{"térmico":42}\r');
  stream.receive(frame.subarray(0, 4));
  assert.equal(stream.snapshot().samples.length, 0);
  stream.receive(frame.subarray(4));
  stream.receive(bytes('\n1,2\n'));
  const values = stream.snapshot().samples;
  assert.deepEqual(values.map(sample => [sample.line, [...sample.fields]]), [
    [1, [['térmico', 42]]],
    [2, [['#1', 1], ['#2', 2]]],
  ]);
});

test('abandons overlong lines and keeps only the most recent numeric samples', () => {
  const stream = new SerialAnalyzerBuffer();
  stream.receive(bytes('9'.repeat(8193) + '\n' + '1\n'.repeat(301)));
  const snapshot = stream.snapshot();
  assert.equal(snapshot.overlong, 1);
  assert.equal(snapshot.lines, 302);
  assert.equal(snapshot.samples.length, 300);
  assert.equal(snapshot.samples[0].line, 3);
});
