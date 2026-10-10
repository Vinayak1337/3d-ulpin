import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { NormalizedBuildingSchema, type NormalizedBuilding } from '@ulpin/contracts';
import { attachCandidateLevel } from './source-building-candidates';
import { sanitizedOcrFailure } from './document-ocr';

const retained = JSON.parse(readFileSync('docs/evidence/gf-backend/k2/magnolia-canonical.json', 'utf8'));
const magnolia = NormalizedBuildingSchema.parse(retained);
const candidate: NormalizedBuilding['candidates'][number] = { candidateId: 'fixture-only-room',
  task: 'plan_rooms', taskVersion: '2', inputManifest: 'fixture-only-contract', outputRef: null,
  state: 'candidate', kind: 'room', method: 'deterministic:vector-plan@1',
  coordinateFrame: 'plan-local:fixture-only', levelId: null, polygons: [[[ [0, 0], [1, 0], [1, 1], [0, 0] ]]] };

test('Magnolia has no reviewed level and refuses an attachment without creating one', () => {
  assert.equal(magnolia.levels.length, 0);
  assert.throws(() => attachCandidateLevel(magnolia, candidate, 'not-present', 'reviewed source',
    'fixture-operator', '2026-10-10T01:45:00Z'), /existing reviewed level/);
  assert.equal(candidate.levelId, null);
});

test('an explicit existing level selection preserves plan-local candidate geometry', () => {
  // Controlled contract fixture only; no level is installed in Magnolia or inferred from its panel title.
  const building = { ...magnolia, levels: [{ levelId: 'fixture-only-reviewed-level', order: 0,
    label: { ...magnolia.storeyLabel, value: 'Fixture reviewed label', state: 'reviewed' as const },
    lowerM: magnolia.baseM, upperM: magnolia.heightM, spaces: [] }] };
  const reviewed = attachCandidateLevel(building, candidate, building.levels[0].levelId,
    'Explicit fixture level selection', 'fixture-operator', '2026-10-10T01:45:00Z');
  assert.equal(reviewed.levelId, 'fixture-only-reviewed-level');
  assert.equal(reviewed.state, 'reviewed');
  assert.deepEqual(reviewed.polygons, candidate.polygons);
  assert.equal(reviewed.coordinateFrame, candidate.coordinateFrame);
  assert.equal(candidate.levelId, null);
});

test('OCR diagnostics keep only allowlisted classes and fixed messages, never source text or paths', () => {
  const attemptId = '828d327b-f9f7-4a12-b4fb-39c756c02ab3';
  const safe = sanitizedOcrFailure(attemptId,
    'File E:\\private\\names.pdf\nValueError: secret officer text and token=not-for-export', null);
  assert.deepEqual(safe, { attemptId, class: 'ValueError', message: 'Worker exception; sensitive detail withheld' });
  const custom = sanitizedOcrFailure(attemptId, '\nPrivateCustomerError: private text', null);
  assert.equal(custom.class, 'UnknownWorkerFailure');
  const dependency = sanitizedOcrFailure(attemptId, '\nImportError: DLL load failed C:\\private.dll', null);
  assert.equal(dependency.message, 'Native dependency unavailable');
  assert(!JSON.stringify([safe, custom, dependency]).match(/secret|private|token=|pdf|dll/));
});
