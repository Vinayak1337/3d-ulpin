import { afterEach, expect, it, vi } from 'vitest';
import { LARGE_UPLOAD_MINIMUM } from '../upload-model';
import type { TableFromOriginalBody } from './retain';
import { readKeptTable, type Kept } from './useRetainTable';

const caseId = '20000000-0000-4000-8000-000000000001';
const sourceId = '20000000-0000-4000-8000-000000000002';
const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };
// An empty handle stands for a small CSV; it carries no source record.
const small = new File([], 'register.csv', { type: 'text/csv' });

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const requests: string[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
    return Response.json({ case: { id: caseId, revision: 3, siteId: null, archived: false } });
  });
  const kept: Kept = { current: null };
  const upload = vi.fn(async () => sourceId);
  const bodies: TableFromOriginalBody[] = [];
  return { requests, kept, upload, bodies };
}

it('TB2: a small CSV dropped alone is kept through the upload first, then read from that kept original', async () => {
  expect(small.size).toBeLessThan(LARGE_UPLOAD_MINIMUM);
  const { requests, kept, upload, bodies } = setup();
  const opened = await readKeptTable(caseId, selection, kept, upload, async (id, source, body) => {
    bodies.push(body);
    return { caseId: id, sourceId: source };
  });
  expect(opened).toEqual({ caseId, sourceId });
  expect(upload).toHaveBeenCalledTimes(1);
  expect(upload).toHaveBeenCalledWith(caseId);
  expect(bodies).toEqual([{ requestKey: expect.any(String), expectedWorkspaceRevision: 3, selection }]);
  expect(requests).toEqual([`GET /api/v1/cases/${caseId}`]);
});

it('TB2: a read that stopped is asked for again with a new key, and the bytes are never kept a second time',
  async () => {
    const { kept, upload, bodies } = setup();
    const stop = new Error('Reading this table stopped. (TABULAR_HEADER_REQUIRED)');
    await expect(readKeptTable(caseId, selection, kept, upload, async (_id, _source, body, stopped) => {
      bodies.push(body);
      stopped();
      throw stop;
    })).rejects.toBe(stop);
    await readKeptTable(caseId, selection, kept, upload, async (id, source, body) => {
      bodies.push(body);
      return { caseId: id, sourceId: source };
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.requestKey).not.toBe(bodies[0]!.requestKey);
  });

it('TB2: a lost answer sends the same request again; a cancelled upload keeps and reads nothing', async () => {
  const { kept, upload, bodies } = setup();
  const lost = new TypeError('Failed to fetch');
  await expect(readKeptTable(caseId, selection, kept, upload, async (_id, _source, body) => {
    bodies.push(body);
    throw lost;
  })).rejects.toBe(lost);
  await readKeptTable(caseId, selection, kept, upload, async (id, source, body) => {
    bodies.push(body);
    return { caseId: id, sourceId: source };
  });
  expect(bodies[1]).toBe(bodies[0]);
  const cancelled = setup();
  await expect(readKeptTable(caseId, selection, cancelled.kept, async () => null, async () => {
    throw new Error('not read');
  })).rejects.toThrow('The upload was cancelled; nothing was imported.');
  expect(cancelled.kept.current).toBeNull();
});
