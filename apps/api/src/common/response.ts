import type { Response as ExpressResponse } from 'express';

export function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...Object.fromEntries(new Headers(headers)) } });
}

function waitForDrain(response: ExpressResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { response.off('drain', drain); response.off('close', close); };
    const drain = () => { cleanup(); resolve(); };
    const close = () => { cleanup(); reject(new Error('Response closed during streaming.')); };
    response.once('drain', drain);
    response.once('close', close);
  });
}

/** Copies status and end-to-end headers, then streams bytes with backpressure. */
export async function sendWebResponse(response: ExpressResponse, web: Response): Promise<void> {
  response.status(web.status);
  web.headers.forEach((value, name) => {
    if (!['connection', 'transfer-encoding', 'keep-alive'].includes(name.toLowerCase())) response.setHeader(name, value);
  });
  if (!response.hasHeader('Cache-Control')) response.setHeader('Cache-Control', 'no-store');
  if (!web.body) { response.end(); return; }
  const reader = web.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!response.write(Buffer.from(value))) await waitForDrain(response);
    }
    response.end();
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    response.destroy(error instanceof Error ? error : undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
