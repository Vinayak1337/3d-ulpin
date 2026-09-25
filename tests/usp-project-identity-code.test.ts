import assert from 'node:assert/strict';
import { test } from 'node:test';
import { P3_ALPHABET, normalizeProjectCode, projectCodeForPayload,
  verticalLocator } from '../packages/contracts/src/usp/project-identity';
import { newProjectCode } from '../apps/web/lib/server/usp/project-code-generator';

const vectors = [
  ['00000000000000000000', 'P3-00000000000000000000-RP'],
  ['ZZZZZZZZZZZZZZZZZZZZ', 'P3-ZZZZZZZZZZZZZZZZZZZZ-VP'],
  ['0123456789ABCDEFGHJK', 'P3-0123456789ABCDEFGHJK-E8'],
  ['7Q4M2R8T6V0W3X5Y9ZAB', 'P3-7Q4M2R8T6V0W3X5Y9ZAB-R4'],
] as const;

test('fixed independent P3/1 vectors and normalization grammar', () => {
  for (const [payload, full] of vectors) {
    assert.equal(projectCodeForPayload(payload), full);
    assert.equal(normalizeProjectCode(full), full);
    assert.equal(normalizeProjectCode(`  ${full.toLowerCase()}  `), full);
    assert.equal(normalizeProjectCode(full.replaceAll('-', '')), full);
  }
  for (const input of [
    'P3-00000000000000000000-RQ',
    'P3-00000000000000000000 -RP', 'P3--00000000000000000000-RP',
    'P3-00000000000000000000-ЯP', 'P3-00000000000000000000-RP\t',
    'P3-00000000000000000000-ZZ',
  ]) {
    assert.equal(normalizeProjectCode(input), null, input);
  }
});

test('all single substitutions and unequal adjacent checked-body swaps fail', () => {
  for (const [, full] of vectors) {
    const compact = full.replaceAll('-', '');
    for (let index = 0; index < compact.length; index++) {
      for (const symbol of P3_ALPHABET) {
        if (symbol === compact[index]) continue;
        assert.equal(normalizeProjectCode(compact.slice(0, index) + symbol + compact.slice(index + 1)), null,
          `${full} at ${index} -> ${symbol}`);
      }
    }
    for (let index = 0; index < 21; index++) {
      if (compact[index] === compact[index + 1]) continue;
      const swapped = compact.slice(0, index) + compact[index + 1] + compact[index] + compact.slice(index + 2);
      assert.equal(normalizeProjectCode(swapped), null, `${full} swap ${index}`);
    }
  }
});

test('generated codes use the P3/1 wire grammar and do not repeat in a bounded sample', () => {
  const codes = Array.from({ length: 500 }, newProjectCode);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) assert.equal(normalizeProjectCode(code), code);
});

test('location line is derived from reviewed associations and supports duplex levels', () => {
  const location = {
    anchorState: 'reviewed_partial' as const,
    parcels: [
      { ulpin: 'PARCEL-A', role: 'associated' as const, sourceId: 'a', reviewed: true },
      { ulpin: 'PARCEL-B', role: 'associated' as const, sourceId: 'b', reviewed: true },
    ],
    locator: { structureKind: 'U' as const, structureNumber: 2, levels: ['F07', 'F08'],
      spaceKind: 'R' as const, spaceNumber: 3 },
  };
  assert.equal(verticalLocator(location), 'MULTI(2) / U02 / F07-F08 / R003');
  assert.equal(verticalLocator({ ...location, anchorState: 'not_supplied' }), 'NO-ANCHOR / U02 / F07-F08 / R003');
});
