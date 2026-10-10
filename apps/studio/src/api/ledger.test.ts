import { describe, expect, it } from 'vitest';
import { ledgerFromPublished, revisedRecordId, type PublishedLedger } from './ledger';

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
  it('keeps two records revised at the same time as two entries, each named as far as the read names it', () => {
    const at = '2026-10-02T00:00:00.000Z';
    const space = { id: 'u1', applicationId: 'app:B001:F001:S001', revision: 1, name: 'U-1', use: null, evidence: [] };
    const registry = ['f1', 'u1', 'b1'].map((recordId) => ({ recordId, revision: 1, recordedAt: at }));
    const recorded = ledgerFromPublished({
      ...published,
      spaces: { state: 'recorded', records: [space] },
      history: { ...published.history, feature: [], registry },
    });
    expect(recorded.revisions.map((entry) => entry.title))
      .toEqual(['Registry record, revision 1', 'Space U-1, revision 1', 'Building record, revision 1']);
    expect(recorded.revisions.map(revisedRecordId)).toEqual(['f1', 'u1', 'b1']);
    expect(recorded.revisions.every((entry) => entry.actor === null && entry.hash === null)).toBe(true);
    expect(ledger.revisions.map(revisedRecordId)).toEqual([null]);
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
