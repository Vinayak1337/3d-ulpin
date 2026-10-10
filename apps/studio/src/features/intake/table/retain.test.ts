import { describe, expect, it } from 'vitest';
import { retainForm, tableSelection } from './retain';

// Form serialization only; these empty File handles carry no fabricated source records.
const csv = new File([], 'mi-d10-02.csv', { type: 'text/csv' });
const xlsx = new File([''], 'mi-d19-01.xlsx');

describe('retained table form', () => {
  it('pins every CSV to sheet csv and header row 1', () => {
    const selection = tableSelection(csv, 'ignored', '4,5');
    const body = retainForm(csv, selection, 3, 'request-key');
    expect(body.get('file')).toBe(csv);
    expect(body.get('format')).toBe('csv');
    expect(JSON.parse(String(body.get('selection')))).toEqual({
      format: 'csv', sheet: 'csv', table: null, headerRows: [1],
    });
    expect(body.get('expectedWorkspaceRevision')).toBe('3');
    expect(body.get('requestKey')).toBe('request-key');
  });

  it('keeps the XLSX sheet and explicitly selected header rows', () => {
    const selection = tableSelection(xlsx, 'Districts', '4, 5');
    const body = retainForm(xlsx, selection, 0, 'request-key');
    expect(body.get('format')).toBe('xlsx');
    expect(JSON.parse(String(body.get('selection')))).toEqual({
      format: 'xlsx', sheet: 'Districts', table: null, headerRows: [4, 5],
    });
  });

  it('refuses missing, duplicate, decreasing or too many workbook headers', () => {
    for (const rows of ['', '4,4', '5,4', '1,2,3,4,5,6']) {
      expect(() => tableSelection(xlsx, 'Districts', rows)).toThrow('increasing');
    }
    expect(() => tableSelection(xlsx, '', '4,5')).toThrow('exact sheet');
  });
});
