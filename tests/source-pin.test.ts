import assert from 'node:assert/strict';
import test from 'node:test';
import { compareSourcePins } from '../packages/server/src/modules/usp/ingestion/source-pin';

const input = { caseRevision: 2, source: { revision: 1, bytes: 8 }, policy: 'pinned-control' };

test('equal reader inputs are current, independently of nested object key order', () => {
  const now = { ...input, source: { bytes: 8, revision: 1 } };
  assert.deepEqual(compareSourcePins(now, input), { current: true, moved: [], caseRevisionAdvancedBy: 0 });
});

test('only a higher case edit counter keeps every reader pin current', () => {
  assert.deepEqual(compareSourcePins({ ...input, caseRevision: 5 }, input),
    { current: true, moved: [], caseRevisionAdvancedBy: 3 });
});

test('a current counter below the pinned counter fails closed', () => {
  assert.deepEqual(compareSourcePins({ ...input, caseRevision: 1 }, input),
    { current: false, moved: [], caseRevisionAdvancedBy: -1 });
});

test('a changed non-counter field is named even when the counter advances', () => {
  assert.deepEqual(compareSourcePins({ ...input, caseRevision: 3, source: { revision: 2, bytes: 8 } }, input),
    { current: false, moved: ['source'], caseRevisionAdvancedBy: 1 });
});

test('a field present on just one input moves in either direction, including an undefined value', () => {
  const extended = { ...input, futurePin: undefined };
  assert.deepEqual(compareSourcePins(extended, input),
    { current: false, moved: ['futurePin'], caseRevisionAdvancedBy: 0 });
  assert.deepEqual(compareSourcePins(input, extended),
    { current: false, moved: ['futurePin'], caseRevisionAdvancedBy: 0 });
  assert.deepEqual(compareSourcePins(extended, { ...extended }),
    { current: true, moved: [], caseRevisionAdvancedBy: 0 });
  assert.deepEqual(compareSourcePins({ ...input, futurePin: null }, extended),
    { current: false, moved: ['futurePin'], caseRevisionAdvancedBy: 0 });
});
