import assert from 'node:assert/strict';
import test from 'node:test';
import { currentSourceProposal, parcelUlpinState } from './building-ledger';

test('revision-zero ledger read requires the exact active site/source/package binding', () => {
  const root = { identifier: 'application-id', site_id: 'site-id', body: { sourceRevisionId: 'source-id' } };
  const pkg = { archived: false, site_id: 'site-id', state: 'NEEDS_INPUT', body: {
    sourceRevisionIds: ['source-id'], parts: [], features: [{ id: 'building-id', revision: 0,
      identifier: 'application-id', sourceRevisionId: 'source-id' }],
  } };
  assert.equal(currentSourceProposal(root, pkg, 'building-id'), true);
  assert.equal(currentSourceProposal(root, { ...pkg, archived: true }, 'building-id'), false);
  assert.equal(currentSourceProposal(root, { ...pkg, site_id: 'other-site' }, 'building-id'), false);
  assert.equal(currentSourceProposal(root, { ...pkg, body: { ...pkg.body, sourceRevisionIds: ['other-source'] } }, 'building-id'), false);
  assert.equal(currentSourceProposal(root, { ...pkg, body: { ...pkg.body,
    features: [{ ...pkg.body.features[0], revision: 1 }] } }, 'building-id'), false);
});

test('separate official parcel identifiers do not conflict merely because a building spans parcels', () => {
  assert.equal(parcelUlpinState([]), 'unknown');
  assert.equal(parcelUlpinState([{ parcelId: 'a', value: 'one' }, { parcelId: 'b', value: 'two' }]), 'recorded');
  assert.equal(parcelUlpinState([{ parcelId: 'a', value: 'one' }, { parcelId: 'a', value: 'two' }]), 'conflicting');
});
