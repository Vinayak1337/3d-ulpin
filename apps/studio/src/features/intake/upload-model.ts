import type { GetResponse, Schemas } from '@ulpin/api-client';

export type UploadLimits = GetResponse<'/api/v1/ingestion/upload-limits'>;
export type UploadReceipt = Schemas['POST_ingestion_cases_caseId_uploads_Response_201_application_json'];
export type UploadGuard = Schemas['POST_ingestion_cases_caseId_uploads_uploadId_abort_Request_application_json'];
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

// Published POST uploads bytes.minimum (ingestion.ts:230,232), not a second bounded-retain maximum.
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

export function uploadGuard(receipt: UploadReceipt, requestKey: string): UploadGuard {
  return { requestKey, expectedRevision: receipt.revision, expectedCaseRevision: receipt.currentCaseRevision };
}

export function uploadWords(progress: UploadProgress): string {
  const percent = Math.floor(progress.doneBytes / progress.totalBytes * 100);
  if (progress.phase === 'checking') return `Checking the file: ${percent}%`;
  if (progress.phase === 'uploading') return `Uploading: ${percent}% (${MiB(progress.doneBytes)} of `
    + `${MiB(progress.totalBytes)} MiB)`;
  if (progress.phase === 'verifying') return 'Verifying the upload';
  if (progress.phase === 'cancelled') return 'Upload cancelled';
  return `The upload stopped at part ${progress.part} of ${progress.parts}: `
    + `${progress.words || 'the server did not answer'}.`;
}

function MiB(bytes: number): string {
  return (bytes / 1024 ** 2).toFixed(1).replace(/\.0$/, '');
}
