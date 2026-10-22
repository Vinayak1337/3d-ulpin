import { afterEach, describe, expect, it, vi } from 'vitest';
import { LARGE_UPLOAD_MINIMUM } from '../upload-model';
import { readBatchCase, readSourceCase, streamedImport, tableSelection } from './retain';

afterEach(() => vi.unstubAllGlobals());

describe('the case a table is read in', () => {
  const caseId = '10000000-0000-4000-8000-000000000001';
  const answer = (fields: Record<string, unknown>) => vi.stubGlobal('fetch', async () =>
    Response.json({ case: { id: caseId, revision: 2, siteId: null, archived: false, ...fields } }));

  it('N01 unchanged: the table import of a lone drop refuses a case already bound to a site', async () => {
    answer({ siteId: '10000000-0000-4000-8000-000000000002' });
    await expect(readSourceCase(caseId)).rejects.toThrow('This table cannot be attached to a site.');
    answer({});
    expect((await readSourceCase(caseId)).revision).toBe(2);
  });

  it('TJ1: a table the batch keeps is read in its batch case, bound to a site or not; never an archived one',
    async () => {
      answer({ siteId: '10000000-0000-4000-8000-000000000002' });
      expect((await readBatchCase(caseId)).revision).toBe(2);
      answer({ archived: true });
      await expect(readBatchCase(caseId)).rejects.toThrow('archived');
    });
});

// Selection only; these empty File handles carry no fabricated source records.
const csv = new File([], 'mi-d10-02.csv', { type: 'text/csv' });
const xlsx = new File([''], 'mi-d19-01.xlsx');

describe('the table selection the officer pins', () => {
  it('pins every CSV to sheet csv and header row 1', () => {
    expect(tableSelection(csv, 'ignored', '4,5')).toEqual({
      format: 'csv', sheet: 'csv', table: null, headerRows: [1],
    });
  });

  it('keeps the XLSX sheet and explicitly selected header rows', () => {
    expect(tableSelection(xlsx, 'T_18', '4, 5')).toEqual({
      format: 'xlsx', sheet: 'T_18', table: null, headerRows: [4, 5],
    });
  });

  it('refuses missing, duplicate, decreasing or too many workbook headers', () => {
    for (const rows of ['', '4,4', '5,4', '1,2,3,4,5,6']) {
      expect(() => tableSelection(xlsx, 'T_18', rows)).toThrow('increasing');
    }
    expect(() => tableSelection(xlsx, '', '4,5')).toThrow('exact sheet');
  });

  it('streams a CSV or XLSX from 16 MiB and 1 byte, and nothing else', () => {
    const sized = (name: string, size: number) => Object.defineProperty(new File([], name), 'size', { value: size });
    expect(streamedImport(sized('register.xlsx', LARGE_UPLOAD_MINIMUM))).toBe(true);
    expect(streamedImport(sized('register.CSV', LARGE_UPLOAD_MINIMUM))).toBe(true);
    expect(streamedImport(sized('register.xlsx', LARGE_UPLOAD_MINIMUM - 1))).toBe(false);
    expect(streamedImport(sized('register.ods', LARGE_UPLOAD_MINIMUM))).toBe(false);
  });
});
