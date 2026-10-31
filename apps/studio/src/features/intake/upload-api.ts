import { api, unwrap, type paths } from '@ulpin/api-client';
import type { UploadCreate, UploadGuard, UploadReceipt } from './upload-model';

/** Every receipt route names the receipt by its id; a listed receipt and a full status both carry it. */
type Receipt = Pick<UploadReceipt, 'id'>;

type PartRoute = paths['/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/parts/{partNumber}'];
export type PartHeaders = PartRoute['put']['parameters']['header'];
export interface PartRequest {
  number: number;
  bytes: Blob;
  headers: PartHeaders;
}

export function uploadTransport(caseId: string) {
  const path = (receipt: Receipt) => ({ caseId, uploadId: receipt.id });
  return {
    limits: async () => unwrap(await api.GET('/api/v1/ingestion/upload-limits')),
    revision: async () => unwrap(await api.GET('/api/v1/cases/{caseId}',
      { params: { path: { caseId } } })).case.revision,
    create: async (body: UploadCreate, signal?: AbortSignal) => unwrap(await api.POST(
      '/api/v1/ingestion/cases/{caseId}/uploads', {
        params: { path: { caseId } },
        body, signal,
      })),
    status: async (receipt: Receipt) => unwrap(await api.GET(
      '/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}', { params: { path: path(receipt) } })),
    part: async (receipt: Receipt, part: PartRequest) => unwrap(await api.PUT(
      '/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/parts/{partNumber}', {
        params: { path: { ...path(receipt), partNumber: part.number }, header: part.headers },
        headers: { 'Content-Type': 'application/octet-stream' }, body: part.bytes as unknown as string,
        bodySerializer: () => part.bytes,
      })),
    finalize: async (receipt: Receipt, body: UploadGuard & { sha256: string }) => unwrap(await api.POST(
      '/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/finalize',
      { params: { path: path(receipt) }, body })),
    abort: async (receipt: Receipt, body: UploadGuard) => unwrap(await api.POST(
      '/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/abort',
      { params: { path: path(receipt) }, body })),
    cleanup: async (receipt: Receipt, body: UploadGuard) => unwrap(await api.POST(
      '/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/cleanup',
      { params: { path: path(receipt) }, body })),
  };
}
export type UploadTransport = ReturnType<typeof uploadTransport>;

/** N04. This operator's unfinished receipts, including idle v2 receipts still available to resume. */
export async function listUploads(caseId: string) {
  return unwrap(await api.GET('/api/v1/ingestion/cases/{caseId}/uploads', { params: { path: { caseId } } }));
}

/** A retained original joins the batch as one item, as every kept file does. */
export async function enrolSource(caseId: string, sourceId: string) {
  return unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/intake/items', {
    params: { path: { caseId } }, body: { sourceId, requestKey: crypto.randomUUID() },
  }));
}
