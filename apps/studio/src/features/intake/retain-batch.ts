import { api, ApiError, unwrap } from '@ulpin/api-client';
import { createSourceCase } from './table/retain';
import { createUploadCommand, WAITING_FOR_EARLIER } from './upload-command';
import { uploadTransport } from './upload-api';
import { LARGE_UPLOAD_MINIMUM, type UploadProgress } from './upload-model';

export interface FileOutcome {
  name: string;
  sizeBytes: number;
  state: 'waiting' | 'retaining' | 'enrolled' | 'refused' | 'not_enrolled';
  message?: string;
  sourceId?: string;
  upload?: UploadProgress;
  command?: ReturnType<typeof createUploadCommand> | null;
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
  body.set('requestKey', crypto.randomUUID());
  body.set('expectedWorkspaceRevision', String(detail.case.revision));
  // A ZIP of layers is kept whole; enrolling it keeps each GeoJSON member as its own original and item.
  if (/\.zip$/i.test(file.name)) {
    return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/intake/archives', {
      params: { path: { caseId } }, body: body as never,
      bodySerializer: (value) => value as unknown as FormData,
    })).sourceId;
  }
  body.set('format', 'geojson');
  const profile = unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/sources', {
    params: { path: { caseId } }, body: body as never,
    bodySerializer: (value) => value as unknown as FormData,
  }));
  if (profile.version !== 'manual-geojson/1') throw new Error('The server did not return a map file profile.');
  return profile.source.sourceId;
}

/** A small GeoJSON or ZIP keeps its bounded route; every other original, of any size, is kept through /uploads. */
export function viaUpload(file: File) {
  return file.size >= LARGE_UPLOAD_MINIMUM || !/\.(geojson|json|zip)$/i.test(file.name);
}

interface RetainOptions {
  acquiredAt: string;
  active?: (command: ReturnType<typeof createUploadCommand> | null) => void;
}

async function retainOriginal(caseId: string, file: File, progress: (upload: UploadProgress) => void,
  onRefusal: (message: string) => void, options?: RetainOptions & { admitted?: () => void }) {
  if (!viaUpload(file)) {
    try {
      const sourceId = await retainMap(caseId, file);
      options?.admitted?.();
      return sourceId;
    }
    catch (error) {
      if (!(error instanceof ApiError) || ![413, 422].includes(error.status)) throw error;
      // The refusal stands beside the file's outcome, so it says the file went on through upload.
      onRefusal(`Sent through upload after the first route refused it: ${error.message}`);
    }
  }
  const command = createUploadCommand({ file, acquiredAt: options?.acquiredAt ?? new Date().toISOString(),
    transport: uploadTransport(caseId), publish: progress, admitted: options?.admitted });
  options?.active?.(command);
  try { return await command.run() ?? undefined; }
  finally { options?.active?.(null); }
}

/** Admit in drop order; sending, finishing and enrollment overlap. A stopped file keeps its own controls. */
export async function retainBatch(caseId: string, files: File[], publish: (rows: FileOutcome[]) => void,
  options?: RetainOptions) {
  const rows = initialOutcomes(files);
  const pending: Promise<void>[] = [];
  let next = 0;
  for (const [index, file] of files.entries()) {
    next = index + 1;
    let release!: () => void;
    const admittedOrStopped = new Promise<void>(resolve => { release = resolve; });
    const work = retainFile(index, file, release);
    pending.push(work);
    await Promise.race([work, admittedOrStopped]);
  }
  await Promise.all(pending);
  return rows;

  function updateUpload(index: number, upload: UploadProgress, release: () => void) {
    rows[index] = { ...rows[index]!, upload };
    if (upload.phase === 'waiting' && upload.words?.startsWith('Waiting for a free upload slot;')) {
      for (let later = next; later < rows.length; later++) {
        rows[later] = { ...rows[later]!, state: 'retaining', upload: { phase: 'waiting',
          doneBytes: 0, totalBytes: files[later]!.size, part: 1, parts: 0, words: WAITING_FOR_EARLIER } };
      }
    }
    publish([...rows]);
    if (upload.phase === 'stopped') release();
  }

  async function retainFile(index: number, file: File, release: () => void) {
    rows[index] = { ...rows[index]!, state: 'retaining' };
    publish([...rows]);
    let sourceId: string | undefined;
    try {
      sourceId = await retainOriginal(caseId, file, upload => updateUpload(index, upload, release), message => {
        rows[index] = { ...rows[index]!, message };
        publish([...rows]);
      }, { acquiredAt: options?.acquiredAt ?? new Date().toISOString(), admitted: release, active: command => {
        rows[index] = { ...rows[index]!, command };
        options?.active?.(command);
        publish([...rows]);
      } });
      if (!sourceId) {
        rows[index] = { ...rows[index]!, state: 'not_enrolled',
          message: [rows[index]!.message, 'Upload cancelled.'].filter(Boolean).join(' ') };
        publish([...rows]);
        return;
      }
      await api.POST('/api/v1/ingestion/cases/{caseId}/intake/items', {
        params: { path: { caseId } }, body: { sourceId, requestKey: crypto.randomUUID() },
      }).then(unwrap);
      rows[index] = { ...rows[index]!, sourceId, state: 'enrolled' };
    } catch (error) {
      // A lost response is not a refusal and must never be described as one.
      const refused = !sourceId && error instanceof ApiError && error.status >= 400 && error.status < 500;
      rows[index] = { ...rows[index]!, sourceId, state: refused ? 'refused' : 'not_enrolled',
        message: [rows[index]!.message, error instanceof Error ? error.message : 'The file outcome is not known.']
          .filter(Boolean).join(' ') };
    }
    publish([...rows]);
  }
}
