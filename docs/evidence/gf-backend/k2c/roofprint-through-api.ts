import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { NormalizedAreaSchema, type ImportPackage } from '../../../../packages/contracts/src/index';

const base = 'http://127.0.0.1:3194/api/v1';
const root = 'docs/evidence/gf-backend/k2c';
const pkg: ImportPackage = JSON.parse(readFileSync(`${root}/imagery-import.json`, 'utf8'));
const itemId = '74d6fc25-1d7e-4f6d-a0d5-6a3291a21aa6';
const accepted = 'ea0bb06e-b69b-5c67-8be5-70f62129d635';
const rejected = 'abe4321d-d724-5328-bf4a-bdd90e53a87a';
function save(name: string, value: unknown): void {
  writeFileSync(`${root}/${name}.json`, JSON.stringify(value) + '\n', { flag: 'wx' });
}
async function api(path: string, input?: unknown): Promise<any> {
  const response = await fetch(`${base}${path}`, input ? { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) } : undefined);
  const value = await response.json();
  assert(response.ok, `${response.status}: ${JSON.stringify(value)}`);
  return value;
}
async function draft(recovery = false): Promise<void> {
  if (recovery) {
    assert(!existsSync(`${root}/roofprint-draft.json`), 'Already persisted: no recovery mutation permitted.');
    const input = JSON.parse(readFileSync(`${root}/roofprint-request.json`, 'utf8'));
    return publish(input);
  }
  assert(!existsSync(`${root}/roofprint-request.json`), 'Preserve the existing selection; no duplicate mutation.');
  const before = NormalizedAreaSchema.parse(await api(`/areas/${pkg.areaId}/canonical`));
  assert.equal(before.candidates?.length, 80);
  assert(before.candidates?.every(candidate => candidate.state === 'candidate'));
  save('roofprint-before-review', before);
  const context = await api(`/areas/${pkg.areaId}/context`);
  const input = { requestKey: randomUUID(), expectedRevision: pkg.revision,
    expectedAreaRevision: context.area.revision, georeference: 'source_geotiff',
    selections: [{ componentId: accepted, subject: 'Reviewed roof projection candidate' }],
    rejected: [{ componentId: rejected, reason: 'Right-edge clipped region; complete roof boundary unavailable' }],
    reason: 'Retained RGB and mask inspected: selected red-roof projection for draft observation review only' };
  save('roofprint-request', input);
  return publish(input);
}
async function publish(input: unknown): Promise<void> {
  const receipt = await api(`/spatial-ml/items/${itemId}/footprint-drafts`, input);
  save('roofprint-draft', receipt);
  const after = NormalizedAreaSchema.parse(await api(`/areas/${pkg.areaId}/canonical`));
  assert.equal(after.candidates?.find(candidate => candidate.candidateId === accepted)?.review?.outcome, 'accepted');
  assert.equal(after.candidates?.find(candidate => candidate.candidateId === rejected)?.review?.outcome, 'rejected');
  save('roofprint-after-review', after);
  const feature = receipt.package.features[0];
  save('roofprint-building-candidate', await api(`/buildings/${feature.id}/canonical`));
  console.log(`Retained accepted/rejected source selections and draft building ${feature.id}; not yet registry-recorded.`);
}
async function record(): Promise<void> {
  assert(!existsSync(`${root}/roofprint-recording.json`), 'One bounded recording attempt only.');
  const draft = JSON.parse(readFileSync(`${root}/roofprint-draft.json`, 'utf8'));
  const path = `/import-packages/${draft.package.id}/review`;
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: draft.package.revision }) });
  const body = await response.json();
  save('roofprint-recording', { stage: 'review', httpStatus: response.status, body,
    registryRecordingClaim: false, qualificationBypassed: false });
  if (!response.ok) { console.log(`Registry review blocked: ${response.status} ${body.error?.code ?? body.code}`); return; }
  const committed = await api(`/import-packages/${draft.package.id}/commit`, { expectedRevision: body.revision,
    acknowledgement: 'Reviewed roofprint physical observation only; no height, rights or analytical qualification' });
  save('roofprint-commit', committed);
  save('roofprint-building-after-commit', await api(`/buildings/${committed.features[0].id}/canonical`));
}
if (process.argv[2] === 'draft') await draft();
else if (process.argv[2] === 'recover') await draft(true);
else if (process.argv[2] === 'record') await record();
else throw new Error('Use draft, recover or record; recovery replays the exact rolled-back request only.');
