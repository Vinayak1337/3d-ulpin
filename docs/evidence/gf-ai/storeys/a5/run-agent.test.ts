import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentDocument } from './run-agent';

test('agent file: the lines a request left out are recorded by position and code, never by their text', () => {
  const lines = [
    'GROUND FLOOR PLAN',
    '[TOTAL TYPICAL FLOOR AREA',
    'Unit.No.12, Example Chambers, Sector-9, Sampleville O :- 011-5550100',
  ].map((text, index) => ({ id: `p1-l${index}`, text }));
  const store = { source: { sha256: 'e'.repeat(64) }, pages: { '1': { lines } } };
  const document = agentDocument(store, 'replay', []);
  assert.deepEqual(Object.keys(document), ['source', 'mode', 'omitted', 'results']);
  assert.deepEqual(document.omitted, [
    { partId: 'p1-l1', page: 1, line: 1, code: 'MODEL_PROMPT_PRIVACY' },
    { partId: 'p1-l2', page: 1, line: 2, code: 'NOT_SELECTED_UNIT_NUMBER' },
  ]);
  const written = JSON.stringify(document);
  assert(lines.every((line) => !written.includes(line.text)));
});
