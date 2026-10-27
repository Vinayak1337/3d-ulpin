import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ledgerFromPublished, type PublishedLedger } from '../../api/ledger';
import { ReadingStatementsContext } from './ReadingNote';
import { readingStatements } from './registerState';
import { SourceList, type ListedSource } from './SourceList';

const STATEMENT = 'Read by an earlier version of the document reader';
const listed = (sourceId: string): ListedSource => (
  { sourceId, kind: 'document', name: `${sourceId}.pdf`, file: `${sourceId}.pdf`, summary: 'p. 1' }
);

/** The markup of each listed source, in order. */
function rows(statements: ReturnType<typeof readingStatements>): string[] {
  const html = renderToStaticMarkup(
    <ReadingStatementsContext.Provider value={statements}>
      <SourceList sources={[listed('stated'), listed('silent')]} retained={new Map()} onOpen={() => {}} />
    </ReadingStatementsContext.Provider>,
  );
  return html.split('</li>').slice(0, 2);
}

describe('SourceList', () => {
  it('states a reading that is not current beside its source and adds nothing to a neighbour without one', () => {
    const [stated, silent] = rows(readingStatements([
      { id: 'stated', documentResult: { current: false, reasons: ['reader_changed'] } },
      { id: 'silent' },
    ]));
    expect(stated).toContain(`<span class="ul-caption">${STATEMENT}</span>`);
    expect(silent).toContain('silent.pdf');
    expect(silent).not.toContain(STATEMENT);
    // The neighbour's row is the one it has when the server states nothing about any source.
    expect(silent).toBe(rows(new Map())[1]);
  });

  it('lists the register row a recorded revision cites beside its footprint source, with its locator', () => {
    // The ledger read of REH13's cited building: its footprint feature and the register row its revision 2 cites.
    const { sources } = ledgerFromPublished({ ...LEDGER, sources: [
      { id: GEOJSON, revision: 1, name: 'buildings-original.geojson', sha256: 'a'.repeat(64),
        fileUrl: `/api/v1/sources/${GEOJSON}/file`, locators: ['feature:1084419'] },
      { id: CSV, revision: 1, name: 'gpmc-yuvp.csv', sha256: 'b'.repeat(64),
        fileUrl: `/api/v1/sources/${CSV}/file`, locators: ['CSV logical row 444'] },
    ] });
    expect(sources.find((source) => source.sourceId === CSV))
      .toMatchObject({ kind: 'table', name: 'gpmc-yuvp.csv', summary: 'CSV logical row 444' });
    const html = renderToStaticMarkup(<SourceList sources={sources} retained={new Map()} onOpen={() => {}} />);
    const [footprint, register] = html.split('</li>');
    expect(footprint).toContain('buildings-original.geojson');
    expect(footprint).toContain('feature:1084419');
    expect(register).toContain('gpmc-yuvp.csv');
    expect(register).toContain('CSV logical row 444');
  });
});

const GEOJSON = '6f1c5d2e-0000-4000-8000-000000000001';
const CSV = '6f1c5d2e-0000-4000-8000-000000000002';
const LEDGER: PublishedLedger = {
  schemaVersion: 'building-ledger/1',
  building: { id: 'b1', applicationId: '1084419', revision: 1, recordState: 'recorded', name: '1084419',
    frame: { id: 'frame', benchmark: 'building-relative' }, placement: 'geographic' },
  parcelUlpin: { state: 'unknown', parcels: [], missingParcelIds: [], assertions: [] },
  spaces: { state: 'absent', records: [] },
  sources: [],
  history: { feature: [], registry: [], featureHasMore: false, registryHasMore: false },
  assessment: { state: 'not_assessed', latestCheck: 'absent', reason: 'Not qualified here.' },
  missing: [],
};
