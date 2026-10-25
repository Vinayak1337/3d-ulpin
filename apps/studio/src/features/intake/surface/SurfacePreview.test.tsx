import { container } from '../fake-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createContractValidator } from '../../../local/contract';
import { decodePart, type DecodeReply } from '../../map/surface/decode';
import { SURFACE_LIMITS, type IntakeItem, type PartDisplay, type PartPage, type SurfaceIo }
  from '../../map/surface/parts';
import { DISPLAY_ONLY, opensPreview, SurfacePreviewReader, type PreviewView } from './preview-model';

// The parts, display and artifact routes and the decode worker are answered in memory; no record is invented.
const facts = vi.hoisted(() => ({ io: null as unknown }));
vi.mock('../../map/surface/api', () => ({
  browserSurfaceIo: () => facts.io,
  SurfaceDecoder: class { dispose() {} },
}));
const { SurfacePreview } = await import('./SurfacePreview');

const root = resolve(import.meta.dirname, '../../../../../..');
const openapi = JSON.parse(readFileSync(resolve(root, 'docs/api/openapi.json'), 'utf8'));
const validate = createContractValidator(openapi);
const displaySchema = openapi.paths['/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/parts/{partIndex}/display']
  .get.responses['200'].content['application/json'].schema.$ref.split('/').at(-1);
const ids = { caseId: '10000000-0000-4000-8000-000000000001', sourceId: '10000000-0000-4000-8000-000000000002',
  itemId: '10000000-0000-4000-8000-000000000009', areaId: '10000000-0000-4000-8000-000000000005' };
// The server's words for these reasons (intake-surface.ts frameTx).
const NO_AREA = 'Read but not placed: the batch has no map area yet.';
const NO_CRS = 'Read but not placed: the file states no coordinate system.';

type Corners = [number, number][];
const raster = { mediaType: 'image/tiff', read: { operation: 'raster-window', window: { x: 0, y: 0, width: 2,
  height: 2 } } } as const;
const notPlaced = (reason: string, words: string) => ({ state: 'not_placed', reason, words });
const placedAt = (corners: Corners) => ({ state: 'placed', areaId: ids.areaId, areaRevision: 1,
  analysisCrs: 'EPSG:32618', origin: [0, 0], operation: 'stated CRS to the area frame', corners });

/** A display body as the route returns it; each one is checked against the published contract. */
function display(partIndex: number, sourceCorners: Corners, placement: object, kind: {
  mediaType: string; read: object; bytes?: number;
} = raster): PartDisplay {
  const body = { version: 'intake-surface/1', caseId: ids.caseId, itemId: ids.itemId, partIndex,
    jobId: `20000000-0000-4000-8000-00000000000${partIndex}`,
    original: { sourceId: ids.sourceId, sourceRevision: 1, sha256: 'a'.repeat(64), bytes: 4096 },
    locator: kind.read, read: kind.read, resultSha256: 'b'.repeat(64),
    artifact: { sha256: 'c'.repeat(64), bytes: kind.bytes ?? 64, mediaType: kind.mediaType, path: `part-${partIndex}` },
    sourceCrs: { state: 'not_stated', authority: null }, verticalReference: { status: 'unknown', name: null },
    sourceCorners, placement, use: 'display_only' };
  expect(validate(displaySchema, body)).toEqual([]);
  return body as unknown as PartDisplay;
}

const item = (tray: Partial<IntakeItem> = {}) => ({ itemId: ids.itemId, caseId: ids.caseId, sourceId: ids.sourceId,
  name: 'nyc-10013-ortho-2018.tif', family: 'raster', state: 'read', partsDone: 2, placement: 'waiting_for_anchor',
  limitReason: null, ...tray }) as unknown as IntakeItem;

/** Answers the reads for `published` parts; the artifact's length names its part to the decoder. */
function fakeIo(published: number, answer: (partIndex: number) => PartDisplay,
  decoded: (request: Parameters<SurfaceIo['decode']>[0], partIndex: number) => Promise<DecodeReply>) {
  const read = { displays: [] as number[], artifacts: [] as number[], inFlight: 0, most: 0 };
  const io: SurfaceIo = {
    page: async (_item, after) => {
      const parts = Array.from({ length: published }, (_, partIndex) => ({ partIndex, state: 'published' }))
        .filter((part) => part.partIndex > after).slice(0, 64);
      const last = parts.at(-1)?.partIndex;
      return { parts, next: last !== undefined && last < published - 1 ? last : null } as unknown as PartPage;
    },
    display: async (_item, partIndex) => {
      read.displays.push(partIndex);
      read.most = Math.max(read.most, ++read.inFlight);
      await new Promise((done) => setTimeout(done, 1));
      read.inFlight--;
      return answer(partIndex);
    },
    artifact: async (part) => {
      read.artifacts.push(part.partIndex);
      return part.artifact.mediaType === 'image/tiff' ? new ArrayBuffer(part.partIndex + 1) : pointRecords();
    },
    decode: (request, signal) => decoded(request, request.bytes.byteLength - 1),
    canvas: (picture) => ({ width: picture.width, height: picture.height }) as HTMLCanvasElement,
  };
  facts.io = io;
  return read;
}

const picture = async (): Promise<DecodeReply> => ({ kind: 'raster', picture: { width: 2, height: 2,
  rgba: new Uint8ClampedArray(16), shading: 'as_written', range: null, note: null } });

/** Three native LAS format 1 records (28 bytes each): raw X, Y at the batch's west, east and middle. */
function pointRecords(): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(84));
  [[0, 0], [100, 50], [50, 100]].forEach(([x, y], n) => {
    view.setInt32(n * 28, x!, true);
    view.setInt32(n * 28 + 4, y!, true);
  });
  return view.buffer;
}

/** The preview canvas's 2D context, recording each drawing call. */
function canvasRecorder() {
  const calls: [string, ...unknown[]][] = [];
  const record = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
  const context = { setTransform: record('setTransform'), clearRect: record('clearRect'),
    drawImage: record('drawImage'), putImageData: record('putImageData'), imageSmoothingEnabled: true,
    createImageData: (width: number, height: number) => ({ width, height,
      data: new Uint8ClampedArray(width * height * 4) }) };
  const owner = document as unknown as { createElement: (tag: string) => object };
  const make = owner.createElement.bind(document);
  owner.createElement = (tag) => {
    const node = make(tag);
    return tag.toLowerCase() === 'canvas' ? Object.assign(node, { getContext: () => context }) : node;
  };
  return { calls, restore: () => { owner.createElement = make; } };
}

async function mounted(listed: IntakeItem) {
  const canvas = canvasRecorder();
  const host = container();
  const view = createRoot(host as never);
  await act(async () => view.render(<SurfacePreview item={listed} />));
  return { host, canvas, close: async () => { await act(async () => view.unmount()); canvas.restore(); } };
}

const settle = () => act(async () => { await new Promise((done) => setTimeout(done, 20)); });

it('draws a raster\'s not-placed parts as one mosaic at their source corners, with the route\'s words', async () => {
  const corners: Corners[] = [[[0, 10], [10, 10], [10, 0], [0, 0]], [[10, 10], [20, 10], [20, 0], [10, 0]]];
  const read = fakeIo(2, (n) => display(n, corners[n]!, notPlaced('no_batch_area', NO_AREA)), picture);
  const view = await mounted(item());
  await settle();
  expect(view.host.textContent).toContain(`${DISPLAY_ONLY} The read parts are laid out by their corners`);
  expect(view.host.textContent).toContain(`Not placed: 2 parts: ${NO_AREA}`);
  // 20 by 10 source units fit 640 by 320 canvas pixels; each 2-pixel picture spans 320, its upper left first.
  const pictures = view.canvas.calls.filter(([name]) => name === 'drawImage');
  expect(pictures).toHaveLength(2);
  const transforms = view.canvas.calls.filter(([name]) => name === 'setTransform').map(([, ...args]) => args);
  expect(transforms).toContainEqual([160, 0, 0, 160, 0, 0]);
  expect(transforms).toContainEqual([160, 0, 0, 160, 320, 0]);
  expect(read.artifacts.sort()).toEqual([0, 1]);
  await view.close();
});

it('draws a point batch from above at its places between its source corners', async () => {
  const points = { mediaType: 'application/vnd.las.point-records', bytes: 84,
    read: { operation: 'point-batch', batch: { start: 0, count: 3 } } };
  const nw: Corners = [[500, 2010], [520, 2010], [520, 2000], [500, 2000]];
  fakeIo(1, (n) => display(n, nw, notPlaced('no_stated_crs', NO_CRS), points), (request) => decodePart(request));
  const view = await mounted(item({ family: 'point_cloud', name: 'nyc-10013-lidar.las', partsDone: 1 }));
  await settle();
  expect(view.host.textContent).toContain(`Not placed: 1 part: ${NO_CRS}`);
  const [, image] = view.canvas.calls.find(([name]) => name === 'putImageData')!;
  const { width, data } = image as { width: number; data: Uint8ClampedArray };
  // West at the bottom left, east half way up the right edge, the middle at the top; north is the first corner.
  const painted = [[0, 318], [638, 159], [319, 0]].map(([x, y]) => data[(y! * width + x!) * 4 + 3]);
  expect(painted).toEqual([255, 255, 255]);
  expect(data.filter((_, at) => at % 4 === 3 && data[at] === 255)).toHaveLength(12);
  await view.close();
});

it('shows no preview for a placed part, and none is opened for an item on the map', async () => {
  const corners: Corners = [[0, 10], [10, 10], [10, 0], [0, 0]];
  const read = fakeIo(1, (n) => display(n, corners, placedAt(corners)), picture);
  const view = await mounted(item({ partsDone: 1 }));
  await settle();
  expect(view.host.textContent).toBe('');
  expect(read.displays).toEqual([0]);
  expect(read.artifacts).toEqual([]);
  await view.close();
  expect(opensPreview(item({ placement: 'on_map' }))).toBe(false);
  expect(opensPreview(item())).toBe(true);
  expect(opensPreview(item({ family: 'table' }))).toBe(false);
});

it('asks at most the map\'s bounds: 256 display reads for the file, four at once', async () => {
  const corners: Corners = [[0, 1], [1, 1], [1, 0], [0, 0]];
  const checked = display(0, corners, notPlaced('no_batch_area', NO_AREA));
  const read = fakeIo(300, (partIndex) => ({ ...checked, partIndex }), picture);
  let view: PreviewView | null = null;
  const reader = new SurfacePreviewReader(facts.io as SurfaceIo, (next) => { view = next; });
  reader.sync(item({ partsDone: 300 }));
  await vi.waitFor(() => expect(view!.parts.filter((part) => part.image)).toHaveLength(256), { timeout: 10_000 });
  expect(read.displays).toHaveLength(SURFACE_LIMITS.drawnPerItem);
  expect(read.most).toBe(SURFACE_LIMITS.displayReads);
  expect(view!.notes).toContain('Only the first 256 read parts are shown here; 44 later parts are not.');
  reader.dispose();
}, 15_000);
