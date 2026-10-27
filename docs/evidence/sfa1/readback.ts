import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { IntakeManifestSchema, IntakeSurfaceDisplaySchema, IntakeSurfacePartPageSchema }
  from '../../../packages/contracts/src/usp/intake';

const caseId = '1ab6eab7-96ec-4f4c-ac36-eb6149e9deb6';
const base = 'http://127.0.0.1:21026/api/v1';
const root = `/ingestion/cases/${caseId}`;
const expected = JSON.parse(readFileSync('docs/evidence/runtime/reh10/act1-files.json', 'utf8')).files;
const checks: { path: string; status: number }[] = [];
async function get(path: string) {
  const response = await fetch(base + path);
  assert.equal(response.status, 200, path);
  checks.push({ path, status: response.status });
  const body = await response.json();
  return body.data ?? body;
}
const manifest = IntakeManifestSchema.parse(await get(`${root}/intake`));
const surfaces = [];
for (const item of manifest.items.filter(item => ['raster', 'point_cloud'].includes(item.family))) {
  const partRoot = `${root}/intake/items/${item.itemId}/parts`;
  let after: number | null = -1;
  const parts = [];
  do {
    const page = IntakeSurfacePartPageSchema.parse(await get(`${partRoot}?after=${after}`));
    parts.push(...page.parts);
    after = page.next;
  } while (after !== null);
  const first = parts.find(part => part.state === 'published');
  assert(first, `No accepted part of ${item.name}`);
  const display = IntakeSurfaceDisplaySchema.parse(await get(`${partRoot}/${first.partIndex}/display`));
  assert.equal(display.use, 'display_only');
  assert.equal(display.placement.state, 'placed');
  const original = expected.find((file: { path: string }) => file.path.endsWith(item.name));
  assert.equal(display.original.sha256, original.sha256);
  const artifact = await fetch(`http://127.0.0.1:21026${display.artifact.path}`);
  assert.equal(artifact.status, 200);
  const bytes = Buffer.from(await artifact.arrayBuffer());
  assert.equal(bytes.length, display.artifact.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), display.artifact.sha256);
  surfaces.push({ itemId: item.itemId, name: item.name, state: item.state, placement: item.placement,
    done: item.partsDone, planned: item.partsPlanned, words: item.limitReason,
    jobsAssigned: parts.filter(part => part.jobId).length,
    failed: parts.filter(part => part.state === 'quarantined').length,
    first: { part: first.partIndex, jobId: first.jobId, originalHashMatches: true,
      displaySchema: 'passed', placement: display.placement.state, vertical: display.verticalReference,
      artifact: { status: artifact.status, hashMatches: true, bytes: bytes.length } } });
}
const unauthorized = await fetch(base + '/ingestion/cases/76f1cdb3-1407-40b4-b9a2-20cea1c53380/intake/items/'
  + `${surfaces[0].itemId}/parts`);
assert.equal(unauthorized.status, 404);
const detail = await get(`/cases/${caseId}`);
const retained = detail.sources.map((source: { name: string; sha256: string }) => ({ name: source.name,
  hashMatches: source.sha256 === expected.find((file: { path: string }) => file.path.endsWith(source.name)).sha256,
}));
assert(retained.every((source: { hashMatches: boolean }) => source.hashMatches));
const operations = ['raster-window', 'point-batch'];
const jobs = detail.jobs.filter((job: { operation: string }) => operations.includes(job.operation));
const result = { at: new Date().toISOString(), caseId, surfaces, retained, checks,
  crossCaseRead: unauthorized.status, jobCounts: Object.fromEntries(['raster-window', 'point-batch'].map(operation =>
    [operation, jobs.filter((job: { operation: string }) => job.operation === operation).length])),
  firstJobs: surfaces.map(surface => jobs.find((job: { id: string }) => job.id === surface.first.jobId)),
};
const name = process.argv[2] ?? 'readback';
writeFileSync(`docs/evidence/sfa1/${name}.json`, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
