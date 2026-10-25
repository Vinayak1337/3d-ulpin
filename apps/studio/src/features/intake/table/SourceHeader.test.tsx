import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import { ReadTable, itemTableSource } from '../BatchTableSection';
import type { IntakeItem } from '../batch-model';
import { SourceHeader, tableReadingWords } from './SourceHeader';
import type { TableProfile } from './types';

it('names the returned delimiter and encoding in the existing table and batch panels', () => {
  const reading = { delimiter: ';' as const, encoding: 'windows-1252' as const,
    encodingBasis: 'fallback_windows_1252' as const };
  const profile = { tabular: { selection: { format: 'csv', sheet: 'csv', headerRows: [1] } },
    profile: reading, records: 1, headers: ['key', 'note'], source: { sourceSha256: 'a'.repeat(64) },
    limitations: [] } as unknown as TableProfile;
  const table = renderToStaticMarkup(<SourceHeader profile={profile} />);
  expect(table).toContain('Not valid UTF-8: read as Windows-1252, labels may be wrong.');
  expect(table).toContain('>CSV</span>');
  expect(table).not.toContain('Sheet csv');
  const batch = renderToStaticMarkup(<MemoryRouter><ReadTable reading={profile.profile}
    opened={{ caseId: 'case', sourceId: 'source' }} /></MemoryRouter>);
  expect(batch).toContain('read as Windows-1252');
  expect(tableReadingWords({ delimiter: '\t', encoding: 'utf-16le', encodingBasis: 'bom' }))
    .toBe('Read with tabs, UTF-16 LE · BOM');
  expect(tableReadingWords({ delimiter: '|', encoding: 'utf-16be', encodingBasis: 'bom' }))
    .toBe('Read with pipes, UTF-16 BE · BOM');
  expect(tableReadingWords({ delimiter: ',', encoding: 'utf-8', encodingBasis: 'utf8_valid' }))
    .toBe('Read with commas, UTF-8 · Valid UTF-8');
  expect(tableReadingWords({ encoding: 'iso-8859-1', encodingBasis: 'officer_stated' }))
    .toBe('Read with ISO-8859-1 · Officer-stated encoding');
});

it('does not invent reading metadata for older API responses', () => {
  expect(tableReadingWords({})).toBeNull();
  expect(tableReadingWords({ encoding: 'windows-1252' })).toBe('Read with Windows-1252 · Basis unknown');
  const batch = renderToStaticMarkup(<MemoryRouter><ReadTable
    opened={{ caseId: 'case', sourceId: 'source' }} /></MemoryRouter>);
  expect(batch).not.toContain('Read with');
});

it('offers a probed TSV through the existing delimited table route', () => {
  const item = { sourceId: 'source', card: { family: 'table', format: 'tsv', sheets: [] } } as unknown as IntakeItem;
  expect(itemTableSource(item, [item])).toEqual({ sourceId: 'source', format: 'csv', sheets: [] });
});
