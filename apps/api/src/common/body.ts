import type { IncomingMessage } from 'node:http';
import { AppError } from '@ulpin/server/infrastructure/errors';

export const JSON_BODY_LIMIT = 2 * 1024 * 1024;
export const MULTIPART_BODY_LIMIT = 17 * 1024 * 1024;
export const RAW_BODY_LIMIT = 16 * 1024 * 1024;

/** Enforces the received byte count, including chunked requests with no Content-Length. */
export function readBoundedBytes(request: IncomingMessage, limit: number): Promise<Buffer> {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid body limit.');
  const declared = request.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    throw new AppError(413, 'FILE_SIZE', `The request body exceeds ${limit} bytes.`);
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAbort);
    };
    const onData = (value: Buffer | string) => {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
      total += bytes.length;
      if (total > limit) {
        request.pause();
        cleanup();
        reject(new AppError(413, 'FILE_SIZE', `The request body exceeds ${limit} bytes.`));
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks, total)); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onAbort = () => { cleanup(); reject(new AppError(400, 'INCOMPLETE_BODY', 'The request body was interrupted.')); };
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAbort);
  });
}

export async function readJsonBody(request: IncomingMessage, limit = JSON_BODY_LIMIT): Promise<unknown> {
  const bytes = await readBoundedBytes(request, limit);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new AppError(400, 'INVALID_JSON', 'The request body must be valid JSON.'); }
}

export async function readMultipartBody(request: IncomingMessage, limit = MULTIPART_BODY_LIMIT): Promise<FormData> {
  const contentType = request.headers['content-type'];
  if (!contentType?.toLowerCase().startsWith('multipart/form-data;')) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected multipart/form-data.');
  }
  const bytes = await readBoundedBytes(request, limit);
  try {
    return await new Request('http://127.0.0.1/', {
      method: 'POST', headers: { 'content-type': contentType }, body: Uint8Array.from(bytes),
    }).formData();
  } catch {
    throw new AppError(400, 'INVALID_MULTIPART', 'The multipart body could not be read.');
  }
}

/** Bounded bridge for existing pure parsers that accept a standard Request. */
export async function toWebRequest(request: IncomingMessage & { originalUrl?: string }, limit = JSON_BODY_LIMIT): Promise<Request> {
  const host = request.headers.host;
  if (!host) throw new AppError(403, 'HOST_DENIED', 'Forbidden host.');
  const method = request.method ?? 'GET';
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined || ['connection', 'transfer-encoding', 'content-length'].includes(key)) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item);
  }
  const body = method === 'GET' || method === 'HEAD' ? undefined : Uint8Array.from(await readBoundedBytes(request, limit));
  return new Request(`http://${host}${request.originalUrl ?? request.url ?? '/'}`, { method, headers, body });
}
