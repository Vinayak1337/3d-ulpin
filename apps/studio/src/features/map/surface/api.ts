import { api, ApiError, unwrap } from '@ulpin/api-client';
import type { DecodeReply, DecodeRequest } from './decode';
import type { IntakeItem, PartDisplay, SurfaceIo } from './parts';
import type { PartPicture } from './pixels';

const ARTIFACT = {
  raster: '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/raster-windows/jobs/{jobId}/artifact',
  points: '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/point-batches/jobs/{jobId}/artifact',
} as const;

/** The case workspaces; the map keeps those of its area's site. */
export async function readCases(signal: AbortSignal) {
  return unwrap(await api.GET('/api/v1/cases', { signal }));
}

/** A batch's items, under the same key as the batch page's read. */
export const intakeQuery = (caseId: string) => ({
  queryKey: ['intake', caseId], retry: false,
  queryFn: async ({ signal }: { signal: AbortSignal }) => unwrap(await api.GET(
    '/api/v1/ingestion/cases/{caseId}/intake', { params: { path: { caseId } }, signal },
  )),
});

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

/** The accepted artifact by its existing route; bytes that differ from the display read's pins are refused. */
async function readArtifact(display: PartDisplay, signal: AbortSignal): Promise<ArrayBuffer> {
  const path = { caseId: display.caseId, sourceId: display.original.sourceId, jobId: display.jobId };
  const route = display.artifact.mediaType === 'image/tiff' ? ARTIFACT.raster : ARTIFACT.points;
  const result = await api.GET(route, { params: { path }, parseAs: 'arrayBuffer', signal });
  if (!result.response.ok || !result.data) throw new ApiError(result.response.status, route, result.error);
  const bytes = result.data as ArrayBuffer;
  if (bytes.byteLength !== display.artifact.bytes
    || hex(await crypto.subtle.digest('SHA-256', bytes)) !== display.artifact.sha256)
    throw new Error('The part\'s bytes differ from the size and SHA-256 its display read states.');
  return bytes;
}

const readPage: SurfaceIo['page'] = async (item, after, signal) => unwrap(await api.GET(
  '/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/parts',
  { params: { path: { caseId: item.caseId, itemId: item.itemId }, query: { after } }, signal },
));

const readDisplay: SurfaceIo['display'] = async (item, partIndex, signal) => unwrap(await api.GET(
  '/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/parts/{partIndex}/display',
  { params: { path: { caseId: item.caseId, itemId: item.itemId, partIndex } }, signal },
));

/** S9.4d. The area a surface item's first read part is placed in, by its display read; null when it is not placed. */
export const placedAreaQuery = (item: IntakeItem) => ({
  queryKey: ['surface-placed-area', item.caseId, item.itemId, item.placement, item.partsDone], retry: false,
  queryFn: async ({ signal }: { signal: AbortSignal }) => {
    const first = (await readPage(item, -1, signal)).parts.find((part) => part.state === 'published');
    if (!first) return null;
    const { placement } = await readDisplay(item, first.partIndex, signal);
    return placement.state === 'placed' ? placement.areaId : null;
  },
});

/** One long-lived worker decodes the parts, each answered under its own id. */
export class SurfaceDecoder {
  private worker: Worker | null = null;
  private next = 0;
  private readonly waiting = new Map<number, { resolve: (reply: DecodeReply) => void; reject: (e: Error) => void }>();

  decode(request: DecodeRequest, signal: AbortSignal): Promise<DecodeReply> {
    signal.throwIfAborted();
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const abort = () => { this.waiting.delete(id); reject(signal.reason); };
      signal.addEventListener('abort', abort, { once: true });
      const done = () => signal.removeEventListener('abort', abort);
      this.waiting.set(id, {
        resolve: (reply) => { done(); resolve(reply); },
        reject: (error) => { done(); reject(error); },
      });
      this.started().postMessage({ id, request }, [request.bytes]);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const { reject } of this.waiting.values()) reject(new Error('The map was closed.'));
    this.waiting.clear();
  }

  private started(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./surface.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; reply?: DecodeReply; error?: string }>) => {
      const { id, reply, error } = event.data;
      const waiter = this.waiting.get(id);
      this.waiting.delete(id);
      if (reply) waiter?.resolve(reply);
      else waiter?.reject(new Error(error ?? 'It could not be decoded.'));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      for (const { reject } of this.waiting.values()) reject(new Error(event.message || 'The decoder stopped.'));
      this.waiting.clear();
    };
    return this.worker = worker;
  }
}

function canvasOf(picture: PartPicture): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = picture.width;
  canvas.height = picture.height;
  const image = new ImageData(picture.rgba as ImageDataArray, picture.width, picture.height);
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  return canvas;
}

/** The layer's reads in the browser: the parts and display routes, the artifact routes and the worker. */
export function browserSurfaceIo(decoder: SurfaceDecoder): SurfaceIo {
  return {
    page: readPage,
    display: readDisplay,
    artifact: readArtifact,
    decode: (request, signal) => decoder.decode(request, signal),
    canvas: canvasOf,
  };
}
