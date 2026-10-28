import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import controls from '../../../../../docs/evidence/gf1/e3a/controls-qualified.json';
import published from '../../../../../docs/api/openapi.json';
import { retainBatch, viaUpload, type FileOutcome } from './retain-batch';
import { LARGE_UPLOAD_MINIMUM } from './upload-model';

const caseId = controls.manifest.caseId;
const root = 'E:/BhuAayam-data/';
const footprints = readFileSync(root + 'datasets/nyc-10013/files/buildings-original.geojson');
const pdf = readFileSync(root
  + 'datasets/rera-storeys/RERAP2311201700019-3/bihar-magnolia-sanctioned-layout-original.pdf');
const uploadCalls = ['GET /api/v1/ingestion/upload-limits', 'GET ', 'POST /uploads',
  'PUT /uploads/id/parts/1', 'POST /uploads/id/finalize', 'POST /intake/items'];
const bytesHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const fileOf = (bytes: Uint8Array | string, name: string) => new File([
  typeof bytes === 'string' ? bytes : new Uint8Array(bytes),
], name);

afterEach(() => vi.unstubAllGlobals());
vi.mock('./hash-file', () => ({ hashFile: async () => 'a'.repeat(64) }));

type Refusal = { status: number; code: string; message: string };
type BoundedRequest = { file: File; format: FormDataEntryValue | null; revision: FormDataEntryValue | null };

async function boundedReply(request: Request, state: { revision: number; bounded: BoundedRequest[] },
  refusal?: Refusal) {
  const body = await request.formData();
  state.bounded.push({ file: body.get('file') as File, format: body.get('format'),
    revision: body.get('expectedWorkspaceRevision') });
  state.revision++;
  if (refusal) return Response.json({ error: { code: refusal.code, message: refusal.message } },
    { status: refusal.status });
  const sourceId = crypto.randomUUID();
  if (new URL(request.url).pathname.endsWith('/intake/archives')) return Response.json({ sourceId });
  return Response.json({ version: 'manual-geojson/1', source: { sourceId } });
}

function transport(refusal?: Refusal) {
  const schema = published.components.schemas.GET_ingestion_upload_limits_Response_200_application_json;
  const enums = (properties: object) => Object.fromEntries(Object.entries(properties)
    .map(([key, value]) => [key, (value as { enum: unknown[] }).enum[0]]));
  const limits = { limits: enums(schema.properties.limits.properties),
    largeProfile: { limits: enums(schema.properties.largeProfile.properties.limits.properties) } };
  const receipt = { id: crypto.randomUUID(), revision: 1, currentCaseRevision: 3, state: 'receiving',
    receivedBytes: 0, parts: [], source: null };
  const calls: string[] = [], created: unknown[] = [], parts: Uint8Array[] = [];
  const state = { revision: 3, bounded: [] as BoundedRequest[] };
  vi.stubGlobal('fetch', async (request: Request) => {
    const path = new URL(request.url).pathname;
    calls.push(`${request.method} ${path.replace(/^.*\/cases\/[^/]+/, '').replace(receipt.id, 'id')}`);
    if (path.endsWith('/upload-limits')) return Response.json(limits);
    if (request.method === 'GET') return Response.json({ case: { id: caseId, revision: state.revision } });
    if (path.endsWith('/sources') || path.endsWith('/intake/archives')) return boundedReply(request, state, refusal);
    if (path.endsWith('/uploads')) {
      created.push(await request.json());
      return Response.json(receipt, { status: 201 });
    }
    if (path.includes('/parts/')) {
      parts.push(new Uint8Array(await request.arrayBuffer()));
      return Response.json({ ...receipt, revision: 2 });
    }
    if (path.endsWith('/finalize')) {
      state.revision++;
      return Response.json({ ...receipt, revision: 3, state: 'retained', currentCaseRevision: state.revision,
        source: { sourceId: crypto.randomUUID(), sourceRevision: 1, sha256: 'a'.repeat(64), bytes: 1 } });
    }
    expect(path).toMatch(/\/intake\/items$/);
    return Response.json(controls.manifest.items[0]);
  });
  return { calls, created, parts, bounded: state.bounded };
}

it('keeps act 1 footprints on /sources without an upload or changing the original bytes', async () => {
  const io = transport();
  const file = fileOf(footprints, 'buildings-original.geojson');
  const rows = await retainBatch(caseId, [file], () => undefined);
  expect(rows[0]!.state).toBe('enrolled');
  expect(rows[0]!.message).toBeUndefined();
  expect(rows[0]!.sourceId).toBeTruthy();
  expect(io.calls).toEqual(['GET ', 'POST /sources', 'POST /intake/items']);
  expect(io.created).toEqual([]);
  expect(io.bounded[0]).toMatchObject({ format: 'geojson', revision: '3' });
  expect(bytesHash(new Uint8Array(await io.bounded[0]!.file.arrayBuffer()))).toBe(bytesHash(footprints));
});

it('keeps a small ZIP on /intake/archives without an upload', async () => {
  const io = transport();
  const rows = await retainBatch(caseId, [fileOf('test_only archive transport bytes', 'pack.zip')], () => undefined);
  expect(rows[0]!.state).toBe('enrolled');
  expect(io.calls).toEqual(['GET ', 'POST /intake/archives', 'POST /intake/items']);
  expect(io.created).toEqual([]);
  expect(io.bounded[0]).toMatchObject({ format: null, revision: '3' });
});

// Test-only CityJSON structure and repetition of unchanged NYC features, not independent or operational records.
const original = JSON.parse(footprints.toString('utf8'));
const refusedInputs = [
  { name: 'city.json', bytes: '{"type":"CityJSON","version":"2.0","CityObjects":{},"vertices":[]}',
    status: 422, code: 'UNSUPPORTED_PROFILE', message: 'Expected a GeoJSON FeatureCollection.' },
  { name: 'dense.geojson', bytes: JSON.stringify({ ...original,
    features: Array.from({ length: 2500 }, (_, index) => original.features[index % original.features.length]) }),
    status: 413, code: 'RECORD_LIMIT', message: 'This GeoJSON exceeds the bounded feature limit.' },
  { name: 'plan.json', bytes: pdf, status: 422, code: 'INVALID_JSON', message: 'The original is not valid JSON.' },
];

it.each(refusedInputs)('keeps $name through /uploads after /sources refuses it, with the first words', async input => {
  const io = transport(input);
  const file = fileOf(input.bytes, input.name);
  expect(file.size).toBeLessThan(LARGE_UPLOAD_MINIMUM);
  const frames: FileOutcome[][] = [];
  const active = vi.fn();
  const acquiredAt = '2026-10-21T00:00:00.000Z';
  const rows = await retainBatch(caseId, [file], update => frames.push(update), { acquiredAt, active });
  const words = `Sent through upload after the first route refused it: ${input.message}`;
  expect(rows[0]).toMatchObject({ state: 'enrolled', message: words });
  expect(rows[0]!.sourceId).toBeTruthy();
  expect(io.calls).toEqual(['GET ', 'POST /sources', ...uploadCalls]);
  expect(io.created).toMatchObject([{ filename: file.name, bytes: file.size, expectedCaseRevision: 4,
    provenance: { origin: 'not_stated', acquiredAt } }]);
  const bytes = new Uint8Array(await file.arrayBuffer());
  expect(io.parts.map(bytesHash)).toEqual([bytesHash(bytes)]);
  expect(bytesHash(new Uint8Array(await io.bounded[0]!.file.arrayBuffer()))).toBe(bytesHash(bytes));
  const firstRefusal = frames.findIndex(frame => frame[0]!.message === words);
  expect(firstRefusal).toBeGreaterThan(0);
  expect(frames.slice(firstRefusal).every(frame => frame[0]!.message === words)).toBe(true);
  expect(active.mock.calls).toEqual([[expect.objectContaining({ run: expect.any(Function) })], [null]]);
});

it('falls back for a small ZIP only after the archive route refuses it', async () => {
  const refusal = { status: 422, code: 'UNSUPPORTED_PROFILE', message: 'No supported map layers in this ZIP.' };
  const io = transport(refusal);
  const file = fileOf('test_only archive transport bytes', 'pack.zip');
  const rows = await retainBatch(caseId, [file], () => undefined);
  expect(rows[0]).toMatchObject({ state: 'enrolled',
    message: 'Sent through upload after the first route refused it: No supported map layers in this ZIP.' });
  expect(io.calls).toEqual(['GET ', 'POST /intake/archives', ...uploadCalls]);
  expect(io.parts).toEqual([new Uint8Array(await file.arrayBuffer())]);
});

it('preserves the bounded size switch and the direct upload routes for all other names', () => {
  for (const name of ['map.geojson', 'map.json', 'pack.zip', 'MAP.GEOJSON', 'PACK.ZIP']) {
    expect(viaUpload({ name, size: LARGE_UPLOAD_MINIMUM - 1 } as File)).toBe(false);
    expect(viaUpload({ name, size: LARGE_UPLOAD_MINIMUM } as File)).toBe(true);
  }
  for (const name of ['register.csv', 'ortho.tif', 'cloud.laz', 'map.txt', 'no-suffix']) {
    expect(viaUpload(new File(['x'], name))).toBe(true);
  }
});

it.each([400, 403, 409, 500])('does not switch routes for a %i response from the bounded route', async status => {
  const refusal = { status, code: 'CONTROL_FAILURE', message: 'The bounded request did not complete.' };
  const io = transport(refusal);
  const rows = await retainBatch(caseId, [fileOf('test_only bytes', 'map.json')], () => undefined);
  expect(rows[0]).toMatchObject({ state: status < 500 ? 'refused' : 'not_enrolled', message: refusal.message });
  expect(io.calls).toEqual(['GET ', 'POST /sources']);
  expect(io.created).toEqual([]);
});

it('keeps the first refusal words if the upload also fails', async () => {
  const refusal = refusedInputs[0]!;
  const io = transport(refusal);
  const fetch = globalThis.fetch;
  vi.stubGlobal('fetch', (request: Request) => {
    if (new URL(request.url).pathname.endsWith('/upload-limits')) throw new TypeError('Upload limits unavailable.');
    return fetch(request);
  });
  const rows = await retainBatch(caseId, [fileOf(refusal.bytes, refusal.name)], () => undefined);
  expect(rows[0]).toMatchObject({ state: 'not_enrolled',
    message: `Sent through upload after the first route refused it: ${refusal.message} Upload limits unavailable.` });
  expect(io.created).toEqual([]);
});

it('keeps each retained original when enrollment fails while the next file is already admitted', async () => {
  const { calls, created } = transport();
  const fetch = globalThis.fetch;
  let enrollments = 0;
  vi.stubGlobal('fetch', async (request: Request) => {
    if (new URL(request.url).pathname.endsWith('/intake/items') && enrollments++ === 0) {
      return Response.json({ error: { code: 'INTAKE_UNAVAILABLE', message: 'The intake reader is unavailable.' } },
        { status: 503 });
    }
    return fetch(request);
  });
  const files = ['map.txt', 'register.csv'].map(name => fileOf('test_only transport bytes', name));
  const rows = await retainBatch(caseId, files, () => undefined);
  expect(rows[0]).toMatchObject({ state: 'not_enrolled', message: 'The intake reader is unavailable.' });
  expect(rows[0]!.sourceId).toBeTruthy();
  expect(rows[1]!.state).toBe('enrolled');
  expect(calls.filter(call => call === 'POST /uploads')).toHaveLength(2);
  expect(created).toMatchObject(files.map(file => ({ filename: file.name, bytes: file.size,
    expectedCaseRevision: expect.any(Number), provenance: { origin: 'not_stated' } })));
});

it('starts the next upload while a retained bounded file is still enrolling', async () => {
  const io = transport();
  const fetch = globalThis.fetch;
  let enroll!: () => void;
  let first = true;
  vi.stubGlobal('fetch', async (request: Request) => {
    if (new URL(request.url).pathname.endsWith('/intake/items') && first) {
      first = false;
      await new Promise<void>(resolve => { enroll = resolve; });
    }
    return fetch(request);
  });
  let rows: FileOutcome[] = [];
  const work = retainBatch(caseId, [fileOf(footprints, 'buildings-original.geojson'),
    fileOf('test_only transport bytes', 'next.csv')], update => { rows = update; });
  await vi.waitFor(() => expect(rows[1]?.state).toBe('enrolled'));
  expect(rows[0]!.state).toBe('retaining');
  expect(io.created).toMatchObject([{ filename: 'next.csv' }]);
  enroll();
  expect((await work).map(row => row.state)).toEqual(['enrolled', 'enrolled']);
});

it('does not describe a lost bounded-route response as refused or retry it through uploads', async () => {
  const io = transport();
  const fetch = globalThis.fetch;
  vi.stubGlobal('fetch', (request: Request) => {
    if (new URL(request.url).pathname.endsWith('/sources')) throw new TypeError('Network response was lost.');
    return fetch(request);
  });
  const rows = await retainBatch(caseId, [fileOf('test_only bytes', 'map.json')], () => undefined);
  expect(rows[0]).toMatchObject({ state: 'not_enrolled', message: 'Network response was lost.' });
  expect(rows[0]!.sourceId).toBeUndefined();
  expect(io.calls).toEqual(['GET ']);
  expect(io.created).toEqual([]);
});
