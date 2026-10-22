import { afterEach, expect, it, vi } from 'vitest';
import controls from '../../../../../docs/evidence/gf1/e3a/controls-qualified.json';
import published from '../../../../../docs/api/openapi.json';
import { retainBatch, viaUpload, type FileOutcome } from './retain-batch';

const caseId = controls.manifest.caseId;
const names = ['plan.json', 'city.json', 'dense.geojson', 'map.txt', 'pack.zip'];
const files = names.map(name => new File(['test_only transport bytes'], name));

afterEach(() => vi.unstubAllGlobals());
vi.mock('./hash-file', () => ({ hashFile: async () => 'a'.repeat(64) }));

function transport() {
  const schema = published.components.schemas.GET_ingestion_upload_limits_Response_200_application_json;
  const enums = (properties: object) => Object.fromEntries(Object.entries(properties)
    .map(([key, value]) => [key, (value as { enum: unknown[] }).enum[0]]));
  const limits = { limits: enums(schema.properties.limits.properties),
    largeProfile: { limits: enums(schema.properties.largeProfile.properties.limits.properties) } };
  const receipt = { id: crypto.randomUUID(), revision: 1, currentCaseRevision: 3, state: 'receiving',
    receivedBytes: 0, parts: [], source: null };
  const calls: string[] = [];
  const created: unknown[] = [];
  let revision = 3;
  vi.stubGlobal('fetch', async (request: Request) => {
    const path = new URL(request.url).pathname;
    calls.push(`${request.method} ${path.replace(/^.*\/cases\/[^/]+/, '').replace(receipt.id, 'id')}`);
    if (path.endsWith('/upload-limits')) return Response.json(limits);
    if (request.method === 'GET') return Response.json({ case: { id: caseId, revision } });
    if (path.endsWith('/uploads')) {
      created.push(await request.json());
      return Response.json(receipt, { status: 201 });
    }
    if (path.includes('/parts/')) return Response.json({ ...receipt, revision: 2 });
    if (path.endsWith('/finalize')) {
      revision++;
      return Response.json({ ...receipt, revision: 3, state: 'retained', currentCaseRevision: revision,
        source: { sourceId: crypto.randomUUID(), sourceRevision: 1, sha256: 'a'.repeat(64), bytes: 1 } });
    }
    expect(path).toMatch(/\/intake\/items$/);
    return Response.json(controls.manifest.items[0]);
  });
  return { calls, created };
}

it('keeps every name through uploads before enrolling it, with a fresh case revision for each file', async () => {
  const { calls, created } = transport();
  const frames: FileOutcome[][] = [];
  const result = await retainBatch(caseId, files, rows => frames.push(rows));
  expect(result.map(row => row.state)).toEqual(files.map(() => 'enrolled'));
  const upload = ['GET /api/v1/ingestion/upload-limits', 'GET ', 'POST /uploads', 'PUT /uploads/id/parts/1',
    'POST /uploads/id/finalize', 'POST /intake/items'];
  expect(calls).toEqual(files.flatMap(() => upload));
  expect(created).toMatchObject(files.map((file, index) => ({ filename: file.name, bytes: file.size,
    expectedCaseRevision: 3 + index, provenance: { origin: 'not_stated' } })));
  expect(frames[0]![1]!.state).toBe('waiting');
});

it('does not route by a suffix or byte size in the browser', () => {
  for (const name of [...names, 'register.csv', 'ortho.tif', 'cloud.laz', 'no-suffix']) {
    expect(viaUpload(new File(['x'], name))).toBe(true);
    expect(viaUpload({ name, size: 20 * 1024 * 1024 } as File)).toBe(true);
  }
});

it('keeps an enrolled original when the next enrollment fails, and continues the batch', async () => {
  transport();
  const fetch = globalThis.fetch;
  let enrollments = 0;
  vi.stubGlobal('fetch', async (request: Request) => {
    if (new URL(request.url).pathname.endsWith('/intake/items') && enrollments++ === 0) {
      return Response.json({ error: { code: 'INTAKE_UNAVAILABLE', message: 'The intake reader is unavailable.' } },
        { status: 503 });
    }
    return fetch(request);
  });
  const rows = await retainBatch(caseId, files.slice(0, 2), () => undefined);
  expect(rows[0]).toMatchObject({ state: 'not_enrolled', message: 'The intake reader is unavailable.' });
  expect(rows[0]!.sourceId).toBeTruthy();
  expect(rows[1]!.state).toBe('enrolled');
});

it('does not describe a lost limits response as a refused or retained file', async () => {
  vi.stubGlobal('fetch', async () => { throw new TypeError('Network response was lost.'); });
  const rows = await retainBatch(caseId, files.slice(0, 1), () => undefined);
  expect(rows[0]).toMatchObject({ state: 'not_enrolled', message: 'Network response was lost.' });
  expect(rows[0]!.sourceId).toBeUndefined();
});
