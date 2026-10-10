import { api, unwrap } from '@ulpin/api-client';
import type { RetainBody, Selection, TableProfile } from './types';

export function tableSelection(file: File, sheet: string, rows: string): Selection {
  if (/\.csv$/i.test(file.name)) return { format: 'csv', sheet: 'csv', table: null, headerRows: [1] };
  const parts = rows.split(',').map((part) => part.trim());
  const headerRows = parts.map(Number);
  if (!sheet.trim() || parts.some((part) => !/^\d+$/.test(part)) || headerRows.length > 5 ||
      headerRows.some((row, index) => row < 1 || !Number.isSafeInteger(row) ||
        index > 0 && row <= headerRows[index - 1]!)) {
    throw new Error('Enter the exact sheet name and 1–5 increasing header row numbers, separated by commas.');
  }
  return { format: 'xlsx', sheet: sheet.trim(), table: null, headerRows };
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
