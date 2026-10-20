import { api, unwrap } from '@ulpin/api-client';
import { LARGE_UPLOAD_MINIMUM } from '../upload-model';
import type { RetainBody, Selection, TableJob, TableProfile } from './types';

export function tableSelection(file: File, sheet: string, rows: string): Selection {
  if (/\.csv$/i.test(file.name)) return { format: 'csv', sheet: 'csv', table: null, headerRows: [1] };
  const parts = rows.split(',').map((part) => part.trim());
  const headerRows = parts.map(Number);
  if (!sheet.trim() || parts.some((part) => !/^\d+$/.test(part)) || headerRows.length > 5 ||
      headerRows.some((row, index) => row < 1 || !Number.isSafeInteger(row) ||
        index > 0 && row <= headerRows[index - 1]!)) {
    throw new Error('Enter the exact sheet name and 1–5 increasing header row numbers, separated by commas.');
  }
  return { format: 'xlsx', sheet, table: null, headerRows };
}

export function retainForm(file: File, selection: Selection, revision: number, requestKey: string) {
  const fields: Omit<RetainBody, 'file'> = { format: selection.format, selection: JSON.stringify(selection),
    requestKey, expectedWorkspaceRevision: revision };
  const body = new FormData();
  body.set('file', file);
  for (const [key, value] of Object.entries(fields)) body.set(key, String(value));
  return body;
}

export async function retainTable(caseId: string, body: FormData): Promise<TableProfile> {
  const result = unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/sources', {
    params: { path: { caseId } }, body: body as never, bodySerializer: (value) => value as unknown as FormData,
  }));
  if (result.version !== 'manual-tabular/1') throw new Error('The server did not retain a tabular profile.');
  // Readable<T> drops selection.table:null, although it is present on the wire.
  return result as TableProfile;
}

/** G13, XW1: a CSV or XLSX above 16 MiB is kept through the uploads route, then read on the server as a stream
 * into a table by a job (TP1); a workbook's one sheet is read with the sheet and header rows the officer typed. */
export function streamedImport(file: File) {
  return /\.(csv|xlsx)$/i.test(file.name) && file.size >= LARGE_UPLOAD_MINIMUM;
}

export interface TableFromOriginalBody { requestKey: string; expectedWorkspaceRevision: number; selection: Selection }

/** A kept original up to 16 MiB answers its table profile; a larger CSV or workbook answers its read job. Sending
 * the same body again answers the same job as it stands. */
export async function tableFromOriginal(caseId: string, sourceId: string, body: TableFromOriginalBody)
  : Promise<TableProfile | TableJob> {
  const result = unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/table', {
    params: { path: { caseId, sourceId } }, body: body as never,
  }));
  if (result.version === 'table-profile/1') return result as TableJob;
  if (result.version !== 'manual-tabular/1') throw new Error('The server did not return a table profile.');
  return result as TableProfile;
}

export async function createSourceCase(name: string) {
  return unwrap(await api.POST('/api/v1/cases', { body: { name: name.trim() } }));
}

export async function readSourceCase(caseId: string) {
  const detail = unwrap(await api.GET('/api/v1/cases/{caseId}', { params: { path: { caseId } } }));
  if (detail.case.siteId || detail.case.archived) {
    throw new Error('Choose an active, unassigned source case. This table cannot be attached to a site.');
  }
  return detail.case;
}
