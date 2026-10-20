import type { GetResponse, Schemas } from '@ulpin/api-client';

export type UploadLimits = GetResponse<'/api/v1/ingestion/upload-limits'>;
export type UploadReceipt = Schemas['POST_ingestion_cases_caseId_uploads_Response_201_application_json'];
export type UploadGuard = Schemas['POST_ingestion_cases_caseId_uploads_uploadId_abort_Request_application_json'];
export type UploadEntry = GetResponse<'/api/v1/ingestion/cases/{caseId}/uploads'>['uploads'][number];
export type UploadCreate = Omit<Schemas['POST_ingestion_cases_caseId_uploads_Request_application_json'], 'provenance'>
  & { provenance: { origin: 'not_stated'; acquiredAt: string } };
export interface UploadProgress {
  phase: 'checking' | 'uploading' | 'verifying' | 'stopped' | 'cancelled';
  doneBytes: number;
  totalBytes: number;
  part: number;
  parts: number;
  words?: string;
}

// The bounded map routes (/sources, /intake/archives) take at most 16 MiB; a larger map file switches to POST uploads,
// which since CD1 takes any original of 1 byte or more.
export const LARGE_UPLOAD_MINIMUM = 16 * 1024 * 1024 + 1;

export function uploadPlan(size: number, limits: UploadLimits) {
  if (size > limits.largeProfile.limits.maxOriginalBytes)
    throw new Error(`This file exceeds the upload maximum of ${limits.largeProfile.limits.maxOriginalBytes
      .toLocaleString('en-IN')} bytes.`);
  const profile = size <= limits.limits.maxOriginalBytes ? limits.limits : limits.largeProfile.limits;
  const parts = Math.ceil(size / profile.partBytes);
  return { profile: profile.version, partBytes: profile.partBytes, parts,
    lastPartBytes: size - (parts - 1) * profile.partBytes };
}

export function uploadGuard(receipt: Pick<UploadReceipt, 'revision' | 'currentCaseRevision'>,
  requestKey: string): UploadGuard {
  return { requestKey, expectedRevision: receipt.revision, expectedCaseRevision: receipt.currentCaseRevision };
}

export function uploadWords(progress: UploadProgress): string {
  const percent = Math.floor(progress.doneBytes / progress.totalBytes * 100);
  if (progress.phase === 'checking') return `Checking the file: ${percent}%`;
  if (progress.phase === 'uploading') return `Uploading: ${percent}% (${MiB(progress.doneBytes)} of `
    + `${MiB(progress.totalBytes)} MiB)`;
  if (progress.phase === 'verifying') return progress.words || 'Verifying the upload';
  if (progress.phase === 'cancelled') return 'Upload cancelled';
  return `The upload stopped at part ${progress.part} of ${progress.parts}: `
    + `${progress.words || 'the server did not answer'}.`;
}

function MiB(bytes: number): string {
  return (bytes / 1024 ** 2).toFixed(1).replace(/\.0$/, '');
}

/** A size in words: GiB from 1 GiB, MiB from 1 MiB, KiB below. */
export function sizeWords(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace(/\.0$/, '')} GiB`;
  if (bytes >= 1024 ** 2) return `${MiB(bytes)} MiB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

/** D3. A file not added or still to add, kept as words only: never its bytes. */
export interface WaitingFile {
  name: string;
  sizeBytes: number;
  words: string | null;
}

const waitingKey = (caseId: string) => `ulpin.batch-waiting.${caseId}`;
const isWaitingFile = (value: unknown): value is WaitingFile => {
  const file = value as WaitingFile | null;
  return typeof file?.name === 'string' && typeof file.sizeBytes === 'number'
    && (file.words === null || typeof file.words === 'string');
};

/** Keeps the words under the case id, or clears them when none are left; a storage that throws is ignored. */
export function keepWaiting(storage: () => Storage, caseId: string, files: WaitingFile[]) {
  try {
    if (files.length) storage().setItem(waitingKey(caseId), JSON.stringify(files));
    else storage().removeItem(waitingKey(caseId));
  } catch {
    // Words only: the page works without them.
  }
}

export function readWaiting(storage: () => Storage, caseId: string): WaitingFile[] {
  try {
    const value: unknown = JSON.parse(storage().getItem(waitingKey(caseId)) ?? '[]');
    return Array.isArray(value) ? value.filter(isWaitingFile) : [];
  } catch {
    return [];
  }
}
