import { api, unwrap, type paths } from '@ulpin/api-client';
import type { UploadCreate, UploadGuard, UploadReceipt } from './upload-model';

type PartRoute = paths['/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/parts/{partNumber}'];
export type PartHeaders = PartRoute['put']['parameters']['header'];
export interface PartRequest {
  number: number;
  bytes: Blob;
  headers: PartHeaders;
}

export function uploadTransport(caseId: string) {
  const path = (receipt: UploadReceipt) => ({ caseId, uploadId: receipt.id });
  return {
    limits: async () => unwrap(await api.GET('/api/v1/ingestion/upload-limits')),
    revision: async () => unwrap(await api.GET('/api/v1/cases/{caseId}',
      { params: { path: { caseId } } })).case.revision,
    create: async (body: UploadCreate) => unwrap(await api.POST('/api/v1/ingestion/cases/{caseId}/uploads', {
      params: { path: { caseId } },
      body,
    })),
    status: async (receipt: UploadReceipt) => unwrap(await api.GET(
      '/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}', { params: { path: path(receipt) } })),
    part: async (receipt: UploadReceipt, part: PartRequest) => unwrap(await api.PUT(
      '/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/parts/{partNumber}', {
        params: { path: { ...path(receipt), partNumber: part.number }, header: part.headers },
        headers: { 'Content-Type': 'application/octet-stream' }, body: part.bytes as unknown as string,
        bodySerializer: () => part.bytes,
      })),
    finalize: async (receipt: UploadReceipt, body: UploadGuard & { sha256: string }) => unwrap(await api.POST(
      '/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/finalize',
      { params: { path: path(receipt) }, body })),
    abort: async (receipt: UploadReceipt, body: UploadGuard) => unwrap(await api.POST(
      '/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/abort',
      { params: { path: path(receipt) }, body })),
  };
}
export type UploadTransport = ReturnType<typeof uploadTransport>;
