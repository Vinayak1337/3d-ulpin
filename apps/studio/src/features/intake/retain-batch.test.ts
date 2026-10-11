import { afterEach, expect, it, vi } from 'vitest';
import controls from '../../../../../docs/evidence/gf1/e3a/controls-qualified.json';
import { retainBatch } from './retain-batch';
import type { FileOutcome } from './retain-batch';

const caseId = controls.manifest.caseId;
const files = controls.manifest.items.map((item) => new File([], item.name));

afterEach(() => vi.unstubAllGlobals());

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
