import assert from 'node:assert/strict';
import test from 'node:test';
import { registerMissing } from './register-missing';

const absentGeometry = 'Spatial analysis not assessed: canonical geometry qualification is unavailable. '
  + 'Retained geometry is available for source inspection only.';
const absentParcel = 'No evidenced parcel association has been confirmed.';

test('Tower 3 with a recorded space and Magnolia with a linked PDF state absences, not missing plans', () => {
  const tower3 = registerMissing({
    geometryAvailable: false, staleDetailLinkCount: 0, hasSpaces: true, hasConfirmedParcel: false,
  });
  const magnolia = registerMissing({
    geometryAvailable: false, staleDetailLinkCount: 0, hasSpaces: false, hasConfirmedParcel: false,
  });
  assert.deepEqual(tower3, [absentGeometry, absentParcel]);
  assert.deepEqual(magnolia, [absentGeometry,
    'No source-linked detailed spaces have been recorded for this property.', absentParcel]);
});

test('no missing sentence opens with advice: Add, Review, Run, Upload, Choose or Confirm', () => {
  const missing = registerMissing({
    geometryAvailable: false, staleDetailLinkCount: 1, hasSpaces: false, hasConfirmedParcel: false,
  });
  const forbiddenOpenings = ['Add ', 'Review ', 'Run ', 'Upload ', 'Choose ', 'Confirm '];
  assert.equal(missing.length, 4);
  for (const statement of missing) {
    for (const sentence of statement.split(/(?<=[.!?])\s+/)) {
      assert(!forbiddenOpenings.some(opening => sentence.startsWith(opening)), statement);
    }
  }
  // The existing verify-officer consumer matches this retained absence half, not the removed advice.
  assert(missing.some(statement => statement.includes('linked detailed representation changed')));
});
