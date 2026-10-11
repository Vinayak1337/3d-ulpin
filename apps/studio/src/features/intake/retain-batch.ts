import { api, ApiError, unwrap } from '@ulpin/api-client';
import { createSourceCase } from './table/retain';

export interface FileOutcome {
  name: string;
  sizeBytes: number;
  state: 'waiting' | 'retaining' | 'enrolled' | 'refused' | 'not_enrolled';
  message?: string;
  sourceId?: string;
}

export interface BatchLocationState {
  outcomes?: FileOutcome[];
  remainingFiles?: File[];
}

export function initialOutcomes(files: File[]): FileOutcome[] {
  return files.map((file) => ({ name: file.name, sizeBytes: file.size, state: 'waiting' }));
}

export async function batchCase(mode: 'existing' | 'create', caseId: string, name: string) {
  if (mode === 'create') return (await createSourceCase(name)).id;
  const detail = unwrap(await api.GET('/api/v1/cases/{caseId}', { params: { path: { caseId } } }));
  if (detail.case.archived) throw new Error('Choose an active case for this batch.');
  return detail.case.id;
}

async function retainMap(caseId: string, file: File) {
  const detail = unwrap(await api.GET('/api/v1/cases/{caseId}', { params: { path: { caseId } } }));
  const body = new FormData();
  body.set('file', file);
  body.set('format', 'geojson');
  body.set('requestKey', crypto.randomUUID());
  body.set('expectedWorkspaceRevision', String(detail.case.revision));
  const profile = unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/sources', {
    params: { path: { caseId } }, body: body as never,
    bodySerializer: (value) => value as unknown as FormData,
  }));
  if (profile.version !== 'manual-geojson/1') throw new Error('The server did not return a map file profile.');
  return profile.source.sourceId;
}

/** Each original finishes retention/enrolment before the next begins; one refusal does not end the batch. */
export async function retainBatch(caseId: string, files: File[], publish: (rows: FileOutcome[]) => void) {
  const rows = initialOutcomes(files);
  for (const [index, file] of files.entries()) {
    rows[index] = { ...rows[index]!, state: 'retaining' };
    publish([...rows]);
    let sourceId: string | undefined;
    try {
      sourceId = await retainMap(caseId, file);
      await api.POST('/api/v1/ingestion/cases/{caseId}/intake/items', {
        params: { path: { caseId } }, body: { sourceId, requestKey: crypto.randomUUID() },
      }).then(unwrap);
      rows[index] = { ...rows[index]!, sourceId, state: 'enrolled' };
    } catch (error) {
      // A lost response is not a refusal and must never be described as one.
      const refused = !sourceId && error instanceof ApiError && error.status >= 400 && error.status < 500;
      rows[index] = { ...rows[index]!, sourceId, state: refused ? 'refused' : 'not_enrolled',
        message: error instanceof Error ? error.message : 'The file outcome is not known.' };
    }
    publish([...rows]);
  }
  return rows;
}
