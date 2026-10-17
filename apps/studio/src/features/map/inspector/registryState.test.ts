import { describe, expect, it } from 'vitest';
import controls from '../../../../../../docs/evidence/gf1/ui/f3a/responses.json';
import type { BuildingCanonical } from '../../review/recorded/model';
import { recordedUnit, recordedUnitPath, registryStatus } from './registryState';

const withoutCode = controls.withoutCode as BuildingCanonical;
const withCode = controls.withCode as BuildingCanonical;
const unitId = withCode.levels[0]!.spaces[0]!.spaceId;

describe('the state of a space in the inspector', () => {
  it('finds the recorded unit of a space in the canonical record, and none for any other space', () => {
    expect(recordedUnit(withCode, unitId)).toMatchObject({ id: unitId, label: 'UNIT-3B' });
    expect(recordedUnit(withCode, 'a-space-with-no-recorded-unit')).toBeNull();
    expect(recordedUnit(undefined, unitId)).toBeNull();
  });

  it('reads Assigned from the code the canonical record states, never from this browser', () => {
    expect(registryStatus(recordedUnit(withCode, unitId), undefined)).toBe('Assigned');
    expect(registryStatus(recordedUnit(withoutCode, unitId), undefined)).toBe('Draft');
  });

  it('reads the review status of the ledger for a space without a recorded code', () => {
    expect(registryStatus(null, 'needs_review')).toBe('Needs review');
    expect(registryStatus(null, 'reviewed')).toBe('Reviewed');
    expect(registryStatus(recordedUnit(withoutCode, unitId), 'reviewed')).toBe('Reviewed');
  });

  it('links a recorded unit to its block on the record page', () => {
    expect(recordedUnitPath('tower', 'unit')).toBe('/studio/properties/tower/candidates#unit-unit');
  });
});
