import { describe, expect, it } from 'vitest';
import { ledgerFromPublished, type PublishedLedger } from './ledger';

const published: PublishedLedger = {
  schemaVersion: 'building-ledger/1',
  building: {
    id: 'b1',
    applicationId: 'app:B001',
    revision: 0,
    recordState: 'unrecorded',
    name: '7491',
    frame: { id: 'AREA-a1', benchmark: 'building-relative' },
    placement: 'geographic',
  },
  parcelUlpin: { state: 'unknown', parcels: [], missingParcelIds: [], assertions: [] },
  spaces: { state: 'absent', records: [] },
  sources: [{
    id: 's1',
    revision: 1,
    name: 'original.geojson',
    sha256: 'f'.repeat(64),
    fileUrl: '/f',
    locators: ['feature:7491', '{"featureId":"7491"}'],
  }],
  history: {
    feature: [{ revision: 0, recordedAt: '2026-10-01T00:00:00.000Z' }],
    registry: [],
    featureHasMore: false,
    registryHasMore: false,
  },
  assessment: { state: 'not_assessed', latestCheck: 'absent', reason: 'Not qualified here.' },
  missing: [],
};

describe('ledgerFromPublished', () => {
  const ledger = ledgerFromPublished(published);
  it('keeps what the record states and leaves the rest unknown', () => {
    expect(ledger.parcelUlpin).toBeNull();
    expect(ledger.shareTotalPct).toBeNull();
    expect(ledger.checks).toEqual([]);
    expect(ledger.status).toBe('draft');
  });
  it('reads sources and history without inventing hashes or actors', () => {
    expect(ledger.sources[0]).toMatchObject({ sourceId: 's1', kind: 'feature', summary: 'feature:7491' });
    expect(ledger.revisions).toEqual([{
      kind: 'draft',
      title: 'Source feature, revision 0',
      at: '2026-10-01T00:00:00.000Z',
      actor: null,
      hash: null,
      previousHash: null,
    }]);
  });
  it('takes the parcel ULPIN only when exactly one is recorded', () => {
    const assertion = { parcelId: 'p1', value: 'X', issuer: 'i', sourceId: 's1', locator: 'row:1' };
    const parcelUlpin = { ...published.parcelUlpin, state: 'recorded' as const, assertions: [assertion] };
    const recorded = { ...published, parcelUlpin };
    expect(ledgerFromPublished(recorded).parcelUlpin).toBe('X');
    const both = [assertion, { ...assertion, value: 'Y' }];
    const conflicting = { ...recorded, parcelUlpin: { ...parcelUlpin, assertions: both } };
    expect(ledgerFromPublished(conflicting).parcelUlpin).toBeNull();
  });
});
