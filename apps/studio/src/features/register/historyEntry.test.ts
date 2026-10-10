import { describe, expect, it } from 'vitest';
import { historyActor, ledgerFromPublished, registryEntryTitle, type PublishedLedger } from '../../api/ledger';

type Entry = PublishedLedger['history']['registry'][number];
const entry: Entry = { recordId: 'record-id', revision: 1, recordedAt: '2026-10-01T00:00:00Z' };

function revision(fields: Partial<Entry>) {
  const published = {
    building: { id: entry.recordId, revision: 1, frame: { benchmark: null } },
    parcelUlpin: { state: 'unknown', assertions: [] },
    spaces: { records: [] }, assessment: { reason: '' }, sources: [],
    history: { feature: [], registry: [{ ...entry, ...fields }] },
  } as unknown as PublishedLedger;
  return ledgerFromPublished(published).revisions[0]!;
}

describe('history record and actor words from the published entry', () => {
  it('keeps the old title and says nothing about an actor when the fields are absent', () => {
    expect(registryEntryTitle(entry, 'Registry record')).toBe('Registry record, revision 1');
    expect(historyActor(revision({}))).toBeNull();
  });

  it('states that a null name and actor are not recorded', () => {
    const fields = { recordKind: 'floor', recordName: null, actor: null } as const;
    expect(registryEntryTitle({ ...entry, ...fields }, 'Registry record'))
      .toBe('Floor · Name not recorded · revision 1');
    expect(historyActor(revision(fields))).toBe('Actor not recorded');
  });

  it('prints the stated kind, name and actor without inferring a kind from the id', () => {
    const fields = { recordKind: 'floor', recordName: '2ND FLOOR PLAN', actor: 'selection-demo-runtime' } as const;
    expect(registryEntryTitle({ ...entry, ...fields }, 'Building record'))
      .toBe('Floor · 2ND FLOOR PLAN · revision 1');
    expect(historyActor(revision(fields))).toBe(fields.actor);
  });

  it('keeps independent missing fields independent and never guesses a null kind', () => {
    expect(registryEntryTitle({ ...entry, recordName: 'record name' }, 'Building record'))
      .toBe('record name · revision 1');
    expect(registryEntryTitle({ ...entry, recordKind: null, recordName: null }, 'Building record'))
      .toBe('Kind not recorded · Name not recorded · revision 1');
  });
});
