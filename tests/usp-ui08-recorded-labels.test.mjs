import assert from 'node:assert/strict';
import test from 'node:test';
import { displayName } from '../apps/web/features/spatial/reference-runtime/map.js';

test('saved map labels preserve the full recorded name, including provenance words and separators', () => {
  assert.equal(displayName('Parcel_42 · synthetic historical source'), 'Parcel_42 · synthetic historical source');
  assert.equal(displayName('Survey · demo epoch'), 'Survey · demo epoch');
  assert.equal(displayName(null), '');
});
