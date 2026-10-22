import { api, ApiError, unwrap } from '@ulpin/api-client';
import { createSourceCase } from './table/retain';
import { createUploadCommand } from './upload-command';
import { uploadTransport } from './upload-api';
import { type UploadProgress } from './upload-model';

export interface FileOutcome {
  name: string;
  sizeBytes: number;
  state: 'waiting' | 'retaining' | 'enrolled' | 'refused' | 'not_enrolled';
  message?: string;
  sourceId?: string;
  upload?: UploadProgress;
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

/** Every batch file is kept through /uploads; only the server reads its stored bytes to choose a reader. */
export function viaUpload(_file: File) {
  return true;
}

interface RetainOptions {
  acquiredAt: string;
  active: (command: ReturnType<typeof createUploadCommand> | null) => void;
}

async function retainOriginal(caseId: string, file: File, progress: (upload: UploadProgress) => void,
  options?: RetainOptions) {
  const command = createUploadCommand({ file, acquiredAt: options?.acquiredAt ?? new Date().toISOString(),
    transport: uploadTransport(caseId), publish: progress });
  options?.active(command);
  try { return await command.run() ?? undefined; }
  finally { options?.active(null); }
}

/** Each original finishes retention/enrolment before the next begins; one refusal does not end the batch. */
export async function retainBatch(caseId: string, files: File[], publish: (rows: FileOutcome[]) => void,
  options?: RetainOptions) {
  const rows = initialOutcomes(files);
  for (const [index, file] of files.entries()) {
    rows[index] = { ...rows[index]!, state: 'retaining' };
    publish([...rows]);
    let sourceId: string | undefined;
    try {
      sourceId = await retainOriginal(caseId, file, upload => {
        rows[index] = { ...rows[index]!, upload };
        publish([...rows]);
      }, options);
      if (!sourceId) {
        rows[index] = { ...rows[index]!, state: 'not_enrolled', message: 'Upload cancelled.' };
        publish([...rows]);
        continue;
      }
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
