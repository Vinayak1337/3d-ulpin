import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { save } from './audit.mjs';

// Part C step 0, before the first request: each input read from its path, its bytes and SHA-256 checked against
// the record REH2 used, and the ordered requests the walk sends. Nothing is sent from here.
const reh2 = JSON.parse(readFileSync('docs/evidence/runtime/reh2/plan-b.json', 'utf8'));
const joined = entry => Object.fromEntries(Object.entries(entry)
  .map(([key, value]) => [key, key !== 'recordedIn' && Array.isArray(value) ? value.join('') : value]));
const recorded = Object.fromEntries(reh2.inputs.map(entry => [entry.name, joined(entry)]));
const read = name => {
  const input = recorded[name];
  const bytes = readFileSync(input.path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(bytes.length, input.bytes, `${name}: bytes differ from the record`);
  assert.equal(sha256, input.sha256, `${name}: SHA-256 differs from the record`);
  return { ...input, verifiedBytes: bytes.length, verifiedSha256: sha256, verifiedAt: new Date().toISOString() };
};
const zip = read('nyc-zip');
const niagara = read('niagara');
const member = recorded['nyc-buildings-member'];
save('plan-c.json', {
  at: new Date().toISOString(), api: 'http://127.0.0.1:21026', runtime: 'ulpin-reh-02', servedCommit: '9d6acc6b',
  harness: 'walk.ts: REH2 walk.ts adapted; Studio zipRoute, questionBody, streamedQuestionBody, approvalBody imported',
  newCase: 'REH3 presentation rehearsal test_only (not REH2 case 55d54ba5)',
  inputs: [
    { name: 'nyc-zip', path: zip.path, bytes: zip.verifiedBytes, sha256: zip.verifiedSha256,
      hashMatchesRecord: true, recordedIn: 'docs/evidence/runtime/reh2/plan-b.json', classification: 'test_only',
      geography: zip.geography },
    { name: 'niagara', path: niagara.path, bytes: niagara.verifiedBytes, sha256: niagara.verifiedSha256,
      hashMatchesRecord: true, issuer: niagara.issuer, originalUrl: niagara.originalUrl,
      acquiredAt: niagara.acquiredAt, permissionReference: niagara.permissionReference,
      recordedIn: niagara.recordedIn, classification: 'test_only', crs: niagara.crs },
  ],
  expectedLayer: { member: member.member, bytes: member.bytes, sha256: member.sha256,
    why: 'REH2 extracted this member unchanged; the child original kept by ZF1 must carry the same SHA-256' },
  order: {
    nyc: [
      'zipRoute(bytes) from apps/studio/src/features/intake/file-route.ts must be intake',
      'POST /api/v1/cases (new case)',
      'GET /api/v1/cases/{caseId} (revision)',
      'POST /api/v1/ingestion/cases/{caseId}/intake/archives multipart file, requestKey, expectedWorkspaceRevision',
      'POST /api/v1/ingestion/cases/{caseId}/intake/items {sourceId: archive} (enrol; the fan-out runs here)',
      'GET /api/v1/ingestion/cases/{caseId}/intake (parent, member rows, layer items)',
      'GET /api/v1/cases/{caseId} (each layer original and its inspection.archiveMember lineage)',
      'GET /api/v1/ingestion/cases/{caseId}/intake/items/{itemId} (the buildings layer card)',
      'GET /api/v1/ingestion/cases/{caseId}/intake until the buildings layer asks or has a plan',
      'GET .../sources/{sourceId}/profile; POST .../sources/{sourceId}/recipes (Studio questionBody)',
      '  or, for a plan proposed from memory, GET .../recipes/{recipeId} and approve it if it is the same choice',
      'POST /api/v1/ingestion/cases/{caseId}/recipes/{recipeId}/approve (Studio approvalBody)',
      'GET .../intake until a package; GET .../targets until reviewed',
      'GET .../intake, .../targets, /api/v1/areas/{areaId}/context',
    ],
    niagara: [
      'GET /api/v1/cases/{caseId}', 'POST .../uploads', 'PUT .../uploads/{uploadId}/parts/{n} per part',
      'POST .../uploads/{uploadId}/finalize', 'POST .../intake/items',
      'GET .../intake every 2 s during the read (records seen must move, RM1) until the question',
      'GET .../sources/{sourceId}/streamed-profile/jobs/{jobId} (the manifest streamedProfileJobId)',
      'POST .../streamed-profile/jobs/{jobId}/recipes (Studio streamedQuestionBody pinned to status.caseRevision)',
      'POST .../recipes/{recipeId}/approve', 'GET .../intake until parts done', 'GET .../targets until reviewed',
      'GET .../intake, .../targets, /api/v1/areas/{areaId}/context',
    ],
  },
  choices: { nyc: { layer: member.member, kind: 'building', identifier: '/features/*/properties/bin',
    height: 'not stated' },
  niagara: { kind: 'building', identifier: '/features/*/properties/OBJECTID', height: 'not stated' } },
  limits: 'Stop each input at the first refusal; no retry of a side-effecting request; no provider, key or GPU',
});
console.log(readFileSync('docs/evidence/runtime/reh3/plan-c.json', 'utf8'));
