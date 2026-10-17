import { afterEach, expect, it, vi } from 'vitest';
import controls from '../../../../../docs/evidence/gf1/e3a/controls-qualified.json';
import published from '../../../../../docs/api/openapi.json';
import { retainBatch } from './retain-batch';
import type { FileOutcome } from './retain-batch';

const caseId = controls.manifest.caseId;
const files = controls.manifest.items.map((item) => new File([], item.name));

afterEach(() => vi.unstubAllGlobals());
vi.mock('./hash-file', () => ({ hashFile: async () => 'a'.repeat(64) }));

it('retains and enrols originals sequentially with a fresh case revision for each file', async () => {
  const calls: string[] = [];
  const revisions: string[] = [];
  let index = 0;
  vi.stubGlobal('fetch', async (request: Request) => {
    const path = new URL(request.url).pathname;
    calls.push(`${request.method} ${path.split('/').at(-1)}`);
    if (request.method === 'GET') {
      return Response.json({ case: { id: caseId, revision: controls.profiles[index]!.workspaceRevision } });
    }
    if (path.endsWith('/sources')) {
      const body = await request.formData();
      expect(body.get('format')).toBe('geojson');
      expect(body.get('file')).toBeInstanceOf(File);
      expect(body.get('requestKey')).toMatch(/^[a-f0-9-]{36}$/);
      revisions.push(String(body.get('expectedWorkspaceRevision')));
      return Response.json(controls.profiles[index]);
    }
    index++;
    return Response.json(controls.manifest.items[index - 1]);
  });
  const frames: FileOutcome[][] = [];
  const result = await retainBatch(caseId, files, (rows) => frames.push(rows));
  expect(result.map((row) => row.state)).toEqual(['enrolled', 'enrolled']);
  expect(calls).toEqual([`GET ${caseId}`, 'POST sources', 'POST items',
    `GET ${caseId}`, 'POST sources', 'POST items']);
  expect(revisions).toEqual(controls.profiles.map((profile) => String(profile.workspaceRevision)));
  expect(frames[0]![1]!.state).toBe('waiting');
});

it('shows the API refusal verbatim for one file and continues to the next original', async () => {
  const message = 'Split this source into complete feature collections of at most 2000 records with source metadata '
    + 'and original lineage retained. No records were truncated.';
  let sources = 0;
  vi.stubGlobal('fetch', async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET') {
      return Response.json({ case: { id: caseId, revision: controls.profiles[0]!.workspaceRevision } });
    }
    if (path.endsWith('/sources') && sources++ === 0) {
      return Response.json({ error: { code: 'RECORD_LIMIT', message } }, { status: 413 });
    }
    if (path.endsWith('/sources')) return Response.json(controls.profiles[1]);
    return Response.json(controls.manifest.items[1]);
  });
  const rows = await retainBatch(caseId, files, () => undefined);
  expect(rows[0]).toMatchObject({ state: 'refused', message });
  expect(rows[1]!.state).toBe('enrolled');
});

it('does not describe a lost response as a refused or retained file', async () => {
  vi.stubGlobal('fetch', async () => { throw new TypeError('Network response was lost.'); });
  const rows = await retainBatch(caseId, files.slice(0, 1), () => undefined);
  expect(rows[0]).toMatchObject({ state: 'not_enrolled', message: 'Network response was lost.' });
  expect(rows[0]!.sourceId).toBeUndefined();
});

it('a 3 KB PDF and a 40 KB TIFF are kept through /uploads; a small GeoJSON keeps its own route', async () => {
  const schema = published.components.schemas.GET_ingestion_upload_limits_Response_200_application_json;
  const enums = (properties: object) => Object.fromEntries(Object.entries(properties)
    .map(([key, value]) => [key, (value as { enum: unknown[] }).enum[0]]));
  const limits = { limits: enums(schema.properties.limits.properties),
    largeProfile: { limits: enums(schema.properties.largeProfile.properties.limits.properties) } };
  const receipt = { id: crypto.randomUUID(), revision: 1, currentCaseRevision: 3, state: 'receiving',
    receivedBytes: 0, parts: [], source: null };
  const calls: string[] = [];
  const created: unknown[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    const path = new URL(request.url).pathname;
    calls.push(`${request.method} ${path.replace(/^.*\/cases\/[^/]+/, '').replace(receipt.id, 'id')}`);
    if (path.endsWith('/upload-limits')) return Response.json(limits);
    if (request.method === 'GET') return Response.json({ case: { id: caseId, revision: 3 } });
    if (path.endsWith('/uploads')) {
      created.push(await request.json());
      return Response.json(receipt, { status: 201 });
    }
    if (path.includes('/parts/')) return Response.json({ ...receipt, revision: 2 });
    if (path.endsWith('/finalize')) return Response.json({ ...receipt, revision: 3, state: 'retained',
      source: { sourceId: crypto.randomUUID(), sourceRevision: 1, sha256: 'a'.repeat(64), bytes: 1 } });
    if (path.endsWith('/sources')) return Response.json(controls.profiles[0]);
    return Response.json(controls.manifest.items[0]);
  });
  const originals = [new File([new Uint8Array(3 * 1024)], 'plan.pdf'),
    new File([new Uint8Array(40 * 1024)], 'ortho.tif')];
  const rows = await retainBatch(caseId, [...originals, new File(['{}'], 'small.geojson')], () => undefined);
  expect(rows.map(row => row.state)).toEqual(['enrolled', 'enrolled', 'enrolled']);
  const upload = ['GET /api/v1/ingestion/upload-limits', 'GET ', 'POST /uploads', 'PUT /uploads/id/parts/1',
    'POST /uploads/id/finalize', 'POST /intake/items'];
  expect(calls).toEqual([...upload, ...upload, 'GET ', 'POST /sources', 'POST /intake/items']);
  expect(created).toMatchObject(originals.map(file => ({ filename: file.name, bytes: file.size,
    provenance: { origin: 'not_stated' } })));
});
