import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { createContractValidator } from '../../../local/contract';
import { tableKey } from './queries';
import { TableRows } from './TableRows';
import type { TableRow, TableRowsPage } from './types';

const root = resolve(import.meta.dirname, '../../../../../..');
const validate = createContractValidator(JSON.parse(readFileSync(resolve(root, 'docs/api/openapi.json'), 'utf8')));
const schema = 'GET_ingestion_cases_caseId_sources_sourceId_rows_Response_200_application_json';
const caseId = '10000000-0000-4000-8000-000000000001', sourceId = '10000000-0000-4000-8000-000000000002';
const sha = (n: number) => String(n).repeat(64);

// test_only protocol control in the shape of tests/fixtures/xlsx-control.ts's "Register" sheet: never source records.
const headers = ['Ward', 'Plot', 'Area', 'Doubled', 'Tripled'];
type Mark = NonNullable<TableRow['marks']>[number]['mark'];
const marked: [Mark, number, string | null, string][] = [
  ['formula_cached', 3, '42', 'Formula, stored result not used'],
  ['formula_uncached', 4, null, 'Formula, no stored result'],
  ['no_value', 2, null, 'No value'],
  ['error', 2, '#DIV/0!', 'Workbook error'],
  ['unsupported', 1, null, 'Not read'],
];

function row(record: number, cells: (string | null)[], extra: Partial<TableRow> = {}): TableRow {
  return { record, sourceRow: record + 3, byteStart: 0, byteEnd: 10, sha256: sha(1), cells, window: 0, mapped: null,
    ...extra };
}

const workbookRows = marked.map(([mark, column, stored], record) => {
  const cells: (string | null)[] = ['ward-003', '3.50', '21', '42', null];
  cells[column] = stored;
  return row(record, cells, { sheet: 'Register', sheetSha256: sha(2), marks: [{ column, mark }] });
});
workbookRows[0]!.mapped = [
  { sourceField: '1|Ward', target: 'building.sourceKey', value: 'ward-003', state: 'candidate' },
  { sourceField: '4|Doubled', target: 'building.name', value: null, state: 'unknown',
    issueCode: 'TABULAR_CELL_UNAVAILABLE' },
];
const csvRows = [row(0, ['ward-003', '3.50', '', null, '63'])];

function page(rows: TableRow[]): TableRowsPage {
  return { caseId, sourceId, sourceRevision: 1, sourceSha256: sha(3), headers, records: rows.length,
    rawJobId: null, mappingJobId: null, windows: { written: 1, mapped: 0, failed: [] }, after: -1, next: null, rows };
}

function render(rows: TableRow[]) {
  const data = page(rows);
  expect(validate(schema, data)).toEqual([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData([...tableKey(caseId, sourceId), 'rows', -1], data);
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}><TableRows caseId={caseId} sourceId={sourceId} /></QueryClientProvider>,
  );
  client.clear();
  return markup;
}

/** The body cells of one rendered record, in column order. */
const cellsOf = (markup: string, record: number) => {
  const body = markup.slice(markup.indexOf('<tbody'));
  const rows = body.split('<tr').slice(1);
  return [...rows[record]!.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/g)].map((match) => match[1]!);
};

describe('XW1M: a workbook cell the reader marked is shown in words', () => {
  it.each(marked.map(([mark, column, , words], record) => ({ mark, column, words, record })))(
    'shows $mark as its words, never its stored text', ({ column, words, record }) => {
      const cell = cellsOf(render(workbookRows), record)[column + 2]!;
      expect(cell.replace(/ class="[^"]+"/, '')).toBe(`<span>${words}</span>`);
    });

  it('keeps unmarked workbook cells as written and states a mapped unavailable cell in words', () => {
    const cells = cellsOf(render(workbookRows), 0);
    expect(cells.slice(2, 5)).toEqual(['ward-003', '3.50', '21']);
    expect(cells[7]).toContain('Building source key: ward-003 · candidate');
    expect(cells[7]).toContain(': Not read · unknown');
    expect(cells[7]).not.toContain('Unknown');
  });

  it('shows a CSV record exactly as before: values, Empty and Absent, with no mark words', () => {
    const markup = render(csvRows), cells = cellsOf(markup, 0);
    expect(cells.slice(2, 4)).toEqual(['ward-003', '3.50']);
    expect(cells[4]).toMatch(/^<span class="[^"]+">Empty<\/span>$/);
    expect(cells[5]).toMatch(/^<span class="[^"]+">Absent<\/span>$/);
    expect(cells[6]).toBe('63');
    expect(markup).not.toContain('title=');
    for (const [, , , words] of marked) expect(markup).not.toContain(`>${words}<`);
    expect(markup).not.toContain('Not read');
  });
});
