// Bootstrap the ingestion graph before importing a reader directly (existing circular imports).
import '../packages/server/src/modules/usp/ingestion/intake-surface';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { surfacePlan } from '../packages/server/src/modules/usp/ingestion/intake-surface';
import { RASTER_WINDOW_LIMITS, RasterPixelWindowSchema, RasterWindowInputSchema, RasterWindowRequestSchema,
  RasterWindowResultSchema, RasterDisplayStretchSchema, RasterWindowMetadataSchema }
  from '../packages/contracts/src/usp/raster-window';
import { RasterWindowService, rasterArtifactKey, readRasterResult, enqueueRasterWindowTx }
  from '../packages/server/src/modules/usp/ingestion/raster-window';
import { sha256 } from '../packages/server/src/infrastructure/storage';

// Technical receipt controls, not survey geometry or retained historical jobs.
const id = '30000000-0000-4000-8000-000000000001', hash = 'a'.repeat(64);
const window = { x: 0, y: 0, width: 256, height: 256 };
const input = RasterWindowInputSchema.parse({ version: 'raster-window/1', jobId: id, caseId: id,
  caseRevision: 0, caseContextSha256: hash, sourceId: id, sourceFamilyId: id, sourceRevision: 1,
  sourceSha256: hash, sourceBytes: RASTER_WINDOW_LIMITS.originalBytes, objectKey: `sources/${id}/${hash}`,
  subject: 'raster-step-control', accessSha256: hash, readerSha256: hash, window: null });
function receipt(width: number, height: number, selected: typeof window & { step?: number }) {
  return { version: 'raster-window/1', input, createdAt: '2026-10-24T00:00:00.000Z',
    artifact: { key: rasterArtifactKey(id, hash), sha256: hash, bytes: 1, mediaType: 'image/tiff' },
    metadata: { sourceWidth: width, sourceHeight: height, sourceBands: 1,
      sourceTransform: [1, 0, 0, 0, -1, 0], windowTransform: [1, 0, 0, 0, -1, 0],
      sourceCrsWkt: null, sourceCrsAuthority: null, verticalReference: null, verticalReferenceStatus: 'unknown',
      resolution: [1, 1], window: selected, nativeBounds: [0, -height, width, 0],
      bands: [{ index: 1, dtype: 'uint8', nodata: null, nodataKind: 'absent', maskedPixels: 0,
        validPixels: selected.width * selected.height }], globalPlacement: 'not_qualified' } };
}
async function read(value: ReturnType<typeof receipt>) {
  const bytes = Buffer.from(JSON.stringify(value));
  return readRasterResult(value.input, sha256(bytes), undefined, async () => bytes);
}

test('window requests accept a whole step and reject zero, fractions and steps above 4096', () => {
  const request = { requestKey: id, expectedCaseRevision: 0, expectedSourceRevision: 1, sourceSha256: hash,
    window: { ...window, step: 32 } };
  assert.equal(RasterWindowRequestSchema.parse(request).window.step, 32);
  assert.deepEqual(RasterPixelWindowSchema.parse(window), window, 'legacy windows retain their exact pins');
  for (const step of [0, 1.5, 4097]) {
    assert.equal(RasterWindowRequestSchema.safeParse({ ...request, window: { ...window, step } }).success, false);
  }
});

for (const [width, height, step, cols, rows] of [[10812, 10812, 43, 252, 252], [26500, 61898, 242, 110, 256]]) {
  test(`default receipt covers ${width} by ${height} at step ${step}`, async () => {
    const value = receipt(width, height, { x: 0, y: 0, width: cols, height: rows, step });
    assert.deepEqual((await read(value)).metadata.window, value.metadata.window);
    value.metadata.window.step = step + 1;
    await assert.rejects(() => read(value), (e: any) => e.code === 'RASTER_RESULT_SCOPE');
  });
}

test('null-window historical receipts accept only the exact legacy default when step is absent', async () => {
  const value = receipt(1000, 1000, window);
  assert.deepEqual((await read(value)).metadata.window, window);
  for (const selected of [{ ...window, x: 1 }, { ...window, y: 1 }, { ...window, width: 255 },
    { ...window, step: 1 }]) {
    value.metadata.window = selected;
    value.metadata.bands[0].validPixels = selected.width * selected.height;
    await assert.rejects(() => read(value), (e: any) => e.code === 'RASTER_RESULT_SCOPE');
  }
});

test('explicit legacy step-one windows and optional band extrema still parse and read', async () => {
  const value = receipt(10812, 10812, window);
  value.input = { ...input, window };
  const legacy = await read(value);
  assert.equal(legacy.metadata.bands[0].validMin, undefined);
  const withRange = structuredClone(value);
  Object.assign(withRange.metadata.bands[0], { validMin: 2, validMax: 9 });
  assert.equal(RasterWindowResultSchema.parse(withRange).metadata.bands[0].validMax, 9);
  withRange.metadata.window.step = 1;
  assert.equal((await read(withRange)).metadata.window.step, 1);
});

test('a direct window waits for its overview header rather than enrolling a crop-local stretch', async () => {
  const queries: string[] = [];
  const client = { query: async (sql: string) => {
    queries.push(sql);
    return { rows: [{ n: 0 }], rowCount: 1 };
  } };
  await assert.rejects(() => enqueueRasterWindowTx(client as never,
    { latest: true, source: { id, sha256: hash, inspection: {} } } as never, window),
  (e: any) => e.code === 'RASTER_STRETCH_PENDING');
  assert(!queries.some(sql => sql.startsWith('INSERT')), 'waiting does not create a failed job');
});

test('source display stretch contract keeps null distinct and refuses invalid or duplicate band ranges', () => {
  const stretch = { usage: 'display_only', basis: 'source_overview_percentile_2_98',
    bands: [{ index: 1, low: null, high: null }] };
  assert.deepEqual(RasterDisplayStretchSchema.parse(stretch), stretch);
  for (const bands of [[{ index: 1, low: null, high: 2 }], [{ index: 1, low: 9, high: 2 }],
    [{ index: 1, low: 0, high: Infinity }], [stretch.bands[0], stretch.bands[0]]]) {
    assert.equal(RasterDisplayStretchSchema.safeParse({ ...stretch, bands }).success, false);
  }
  const display = RasterWindowMetadataSchema.shape.display;
  const numeric = { bands: [1], usage: 'display_only', scaling: 'source_percentile_2_98', stretch };
  assert(display.safeParse(numeric).success);
  assert(!display.safeParse({ ...numeric, stretch: undefined }).success);
  assert(!display.safeParse({ ...numeric, scaling: 'stored_uint8' }).success);
  assert(!display.safeParse({ ...numeric, bands: [2] }).success);
});

// test_only sparse generated GeoTIFFs, read by the native reader; no operational or measurement truth.
const native = JSON.parse(readFileSync('tests/fixtures/raster-window-native.json', 'utf8'));
function nativeReceipt(name: string) {
  const reply = native[name], selected = reply.metadata.window;
  return { ...receipt(reply.metadata.sourceWidth, reply.metadata.sourceHeight, selected),
    input: { ...input, window: name === 'later' ? selected : null }, metadata: structuredClone(reply.metadata),
    artifact: { key: rasterArtifactKey(id, reply.artifactSha256), sha256: reply.artifactSha256,
      bytes: reply.artifactBytes, mediaType: 'image/tiff' } };
}

for (const name of ['cube', 'sampled', 'later']) {
  test(`native ${name} result parses and reads with its exact window and artifact pins`, async () => {
    const value = nativeReceipt(name), parsed = RasterWindowResultSchema.parse(value);
    assert.deepEqual((await read(value)).metadata, parsed.metadata);
    const bytes = Buffer.from(native[name].artifactBase64, 'base64');
    assert.equal(bytes.length, parsed.artifact.bytes);
    assert.equal(sha256(bytes), parsed.artifact.sha256);
    assert(Buffer.byteLength(JSON.stringify(parsed)) < RASTER_WINDOW_LIMITS.resultBytes);
  });
}

test('display-only band metadata requires exactly the display indexes, in any order', () => {
  const value = nativeReceipt('cube');
  assert.equal(value.metadata.sourceBands, 792);
  assert.deepEqual(value.metadata.bands.map((b: any) => b.index), [1, 2, 3]);
  value.metadata.bands.reverse();
  assert(RasterWindowResultSchema.safeParse(value).success);
  for (const indexes of [[1, 2], [1, 2, 4], [1, 1, 2], [1, 2, 3, 4]]) {
    const wrong = structuredClone(value);
    wrong.metadata.bands = indexes.map(index => ({ ...value.metadata.bands[0], index }));
    assert(!RasterWindowResultSchema.safeParse(wrong).success, indexes.join(','));
  }
  const unmarked = structuredClone(value);
  delete unmarked.metadata.display.bandMetadata;
  assert(!RasterWindowResultSchema.safeParse(unmarked).success, 'all source bands required without the marker');
  for (const change of [
    (v: any) => { v.metadata.bands[0].validPixels--; },
    (v: any) => { v.metadata.bands[0].nodataKind = 'finite'; },
    (v: any) => { v.metadata.verticalReferenceStatus = 'known'; },
    (v: any) => { v.metadata.display.bandMetadata = 'all'; },
  ]) {
    const wrong = structuredClone(value);
    change(wrong);
    assert(!RasterWindowResultSchema.safeParse(wrong).success);
  }
});

test('sampled overview accepts only the strict spread-blocks display-only shape', () => {
  const value = nativeReceipt('sampled');
  assert.deepEqual(value.metadata.display.overview, { sampling: 'spread_blocks', usage: 'display_only' });
  assert(RasterWindowResultSchema.safeParse(value).success);
  for (const overview of [{ sampling: 'nearest', usage: 'display_only' },
    { sampling: 'spread_blocks', usage: 'measurement' }, { sampling: 'spread_blocks' },
    { sampling: 'spread_blocks', usage: 'display_only', extra: true }]) {
    const wrong = structuredClone(value);
    wrong.metadata.display.overview = overview;
    assert(!RasterWindowResultSchema.safeParse(wrong).success);
  }
});

test('pixel offsets cover GeoTIFF int32 dimensions without raising window or step limits', () => {
  for (const offset of [228_275, 2_147_483_647]) {
    assert(RasterPixelWindowSchema.safeParse({ ...window, x: offset, y: offset }).success);
  }
  for (const key of ['x', 'y']) for (const offset of [-1, 1.5, 2_147_483_648]) {
    assert(!RasterPixelWindowSchema.safeParse({ ...window, [key]: offset }).success);
  }
  for (const bad of [{ width: 257 }, { height: 257 }, { step: 4097 }]) {
    assert(!RasterPixelWindowSchema.safeParse({ ...window, ...bad }).success);
  }
});

test('the large native source plans only in-bounds windows accepted by the pixel contract', () => {
  const value = RasterWindowResultSchema.parse(nativeReceipt('sampled'));
  const plan = surfacePlan({ operation: 'raster-window', value });
  assert(plan.length > 1 && plan.length <= 64);
  for (const part of plan) {
    assert.equal(part.operation, 'raster-window');
    if (part.operation !== 'raster-window') assert.fail();
    const w = RasterPixelWindowSchema.parse(part.window), step = w.step ?? 1;
    assert(w.x + (w.width - 1) * step < value.metadata.sourceWidth);
    assert(w.y + (w.height - 1) * step < value.metadata.sourceHeight);
  }
  assert(plan.some(p => p.operation === 'raster-window' && p.window!.x > 100_000));
  assert(plan.some(p => p.operation === 'raster-window' && p.window!.y > 100_000));
});

test('direct retain still refuses 16 MiB plus one byte before any database or storage call', async () => {
  const lineage = { kind: 'unknown', issuer: null, originalUrl: null, acquiredAt: null,
    permissionReference: null, geography: null, upstreamBytes: null, upstreamRetained: null, parentSha256: null,
    limitations: [], note: null };
  const service = new RasterWindowService();
  await assert.rejects(() => service.retain(id, { requestKey: id, expectedCaseRevision: 0, lineage },
    { name: 'control.tif', bytes: new Uint8Array(RASTER_WINDOW_LIMITS.directRetainBytes + 1) }),
  (e: any) => e.code === 'RASTER_ORIGINAL_SIZE' && /at most 16 MiB/.test(e.message));
});
