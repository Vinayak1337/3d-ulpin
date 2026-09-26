/** Authored GF-T15 transaction cases inside the existing disposable USP Compose runner. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertUspIsolation } from '../local-isolation.mjs';
import { ProjectIdentityReviewSchema, ProjectLocationSchema, UspCommitReceiptSchema,
  projectCodeForPayload } from '../../../packages/contracts/src/usp/index';
import { fingerprint } from '@ulpin/server/modules/cases/domain';
import { localRequestContext } from '@ulpin/server/modules/usp/principal';
import { captureRegistrySnapshot } from '@ulpin/server/modules/usp/snapshots';
import { assignProjectCode, mutateProjectIdentity, prepareProjectIdentityReview,
  resolveProjectIdentity } from '@ulpin/server/modules/usp/project-identity';

assertUspIsolation(process.env);
const require = createRequire(resolve('packages/server/package.json'));
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 5000 });
const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION,
  forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY } });
const ctx = () => localRequestContext(randomUUID());
const siteId = randomUUID(), caseId = randomUUID(), sourceId = randomUUID();
const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
const ids = Object.fromEntries(names.map(name => [name, randomUUID()])) as Record<typeof names[number], string>;
const evidence = [{ sourceId, revision: 1, locator: 'authored identity fixture, line 1' }];
const parcel = (literalValue: string, role: 'primary' | 'associated',
  reviewState: 'supplied_unreviewed' | 'reviewed' | 'disputed' | 'withdrawn') => ({
  literalValue, role, source: { ...evidence[0] }, issuer: { state: 'unknown' as const },
  validity: { state: 'unknown' as const }, reviewState,
});
const location = { anchorState: 'not_supplied' as const, parcels: [], locator: {
  structureKind: 'S' as const, structureNumber: 1, levels: ['F07'],
  spaceKind: 'R' as const, spaceNumber: 3 } };
const codeA = projectCodeForPayload('00000000000000000000');
const codeB = projectCodeForPayload('ZZZZZZZZZZZZZZZZZZZZ');
const sourceBytes = Buffer.from('Authored GF-T15 independent-space evidence\n');
const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
const objectKey = `gf-t15/${sourceId}`;
const report: Record<string, unknown> = {
  schemaVersion: 'usp-gf-t15-live/1', codeCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  environment: process.env.ULPIN_ISOLATION_PROFILE, scopeId: siteId,
  sourceSha256: sourceHash,
  checks: [] as string[], limitations: ['Authored synthetic geometry and parcel labels; no official issuance, survey or ownership conclusion'],
};
const checks = report.checks as string[];

async function api(path: string, payload: unknown, expected: number) {
  const response = await fetch(`${process.env.ULPIN_TEST_URL}/api/v1/usp/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data.error)}`);
  return data;
}
const capture = () => captureRegistrySnapshot(ctx(), siteId, { kind: 'site' });
async function version(id: string) {
  return Number((await pool.query('SELECT revision FROM registry_records WHERE id=$1', [id])).rows[0].revision);
}
async function review(operation: string, scope: any, idList: string[], options: Record<string, unknown> = {}) {
  const expectedVersions = Object.fromEntries(await Promise.all(idList.map(async id => [id, await version(id)])));
  const payload = { operation, scope, recordIds: [...idList].sort(), expectedVersions,
    reason: `Reviewed authored ${operation} fixture`, evidence, ...options };
  const result = await prepareProjectIdentityReview(ctx(), payload as any);
  return { ...result, expectedVersions };
}
function assignInput(scope: any, id: string, reviewed: { reviewId: string }, requestKey = randomUUID(),
  expectedRecordVersion = 1) {
  return { recordId: id, scope, expectedRecordVersion, expectedManifestId: scope.manifestId,
    reviewId: reviewed.reviewId, requestKey };
}
async function mutation(operation: 'correct' | 'cancel' | 'retire' | 'split' | 'merge' | 'boundary_adjustment',
  predecessors: string[], successors: string[], options: Record<string, unknown> = {}) {
  const scope = (await capture()).scope;
  const ids = [...new Set([...predecessors, ...successors])].sort();
  const reviewed = await review(operation, scope, ids,
    { predecessors, successors, ...options });
  return mutateProjectIdentity(ctx(), { operation, predecessors, successors, scope,
    expectedVersions: reviewed.expectedVersions, expectedManifestId: scope.manifestId,
    reviewId: reviewed.reviewId, requestKey: randomUUID() });
}
async function assertStatus(id: string, status: string) {
  const row = (await pool.query('SELECT code,status FROM usp_project_codes WHERE record_id=$1', [id])).rows[0];
  assert.equal(row?.status, status);
  return row.code as string;
}
try {
  await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: objectKey,
    Body: sourceBytes, ContentType: 'text/plain', IfNoneMatch: '*' }));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO registry_sites(id,identifier,name,frame,revision,synthetic)
      VALUES($1,$2,'GF-T15 authored fixture',$3,1,true)`,
      [siteId, `GF-T15-${siteId}`, { id: 'gf-t15-local', horizontalUnit: 'metre' }]);
    await client.query(`INSERT INTO cases(id,name,description,frame,revision,context,site_id)
      VALUES($1,'GF-T15 authored fixture','Isolated synthetic evidence',$2,1,'[]'::jsonb,$3)`,
      [caseId, { id: 'gf-t15-local', horizontalUnit: 'metre' }, siteId]);
    await client.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status,inspection)
      VALUES($1,$2,$3,1,'Authored evidence','test-only','text/plain',$4,$5,$6,'accepted','{}'::jsonb)`,
      [sourceId, caseId, randomUUID(), sourceBytes.length, sourceHash, objectKey]);
    let ordinal = 0;
    for (const name of names) {
      ordinal++;
      const body = { alias: name, name: `Authored space ${name}`, kind: 'space', use: 'apartment',
        evidence, links: [], rights: [], synthetic: true };
      await client.query(`INSERT INTO registry_records(id,site_id,kind,ordinal,identifier,revision,body)
        VALUES($1,$2,'space',$3,$4,1,$5)`, [ids[name], siteId, ordinal, `GF-T15-${name}-${siteId}`, body]);
      await client.query(`INSERT INTO registry_revisions(record_id,revision,body,site_revision)
        VALUES($1,1,$2,1)`, [ids[name], body]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  checks.push('authored synthetic site, source and eight independent space UUIDs inserted in disposable database');

  const initial = (await capture()).scope;
  const firstReview = await review('assign', initial, [ids.A], { location });
  const competingReview = await review('assign', initial, [ids.A], { location });
  const first = assignInput(initial, ids.A, firstReview, 'same-record-first');
  const competing = assignInput(initial, ids.A, competingReview, 'same-record-second');
  const simultaneous = await Promise.allSettled([
    assignProjectCode(ctx(), first, () => codeA), assignProjectCode(ctx(), competing, () => codeB),
  ]);
  assert.equal(simultaneous.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(simultaneous.filter(result => result.status === 'rejected'
    && (result.reason as { status?: number }).status === 409).length, 1);
  const winning = simultaneous[0].status === 'fulfilled' ? first : competing;
  const receiptA = await assignProjectCode(ctx(), winning);
  UspCommitReceiptSchema.parse(receiptA);
  const storedA = (await pool.query('SELECT body FROM usp_command_receipts WHERE id=$1', [receiptA.receiptId])).rows[0].body;
  assert.deepEqual(UspCommitReceiptSchema.parse(storedA), receiptA);
  const httpReplay = (await api('identity/assign', winning, 200)).data;
  assert.deepEqual(UspCommitReceiptSchema.parse(httpReplay), receiptA);
  assert.equal(receiptA.receiptId, (simultaneous.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<any>).value.receiptId);
  await assert.rejects(assignProjectCode({ ...ctx(), accessViewId: 'changed-view' }, winning),
    (error: { status?: number }) => error.status === 409);
  await assert.rejects(assignProjectCode({ ...ctx(), policyVersion: 'changed-policy' }, winning),
    (error: { status?: number }) => error.status === 409);
  await assert.rejects(assignProjectCode({ ...ctx(), principal: { ...ctx().principal, roles: [] } }, winning),
    (error: { status?: number }) => error.status === 403);
  await assert.rejects(assignProjectCode(ctx(), { ...winning, expectedRecordVersion: 2 }),
    (error: { status?: number }) => error.status === 409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM usp_project_codes WHERE record_id=$1', [ids.A])).rows[0].n, 1);
  checks.push('two-writer same-record race, exact replay and changed-payload 409');
  checks.push('canonical stored/HTTP/replayed receipts and changed access, policy or role rejection');

  await assert.rejects(prepareProjectIdentityReview(ctx(), { operation: 'assign', scope: initial,
    recordIds: [ids.B], expectedVersions: { [ids.B]: 1 }, reason: 'stale manifest', evidence, location }),
  (error: { status?: number }) => error.status === 409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM usp_project_codes WHERE record_id=$1', [ids.B])).rows[0].n, 0);
  checks.push('stale manifest 409 before code reservation');

  const current = (await capture()).scope;
  const reviewedB = await review('assign', current, [ids.B], { location });
  const inputB = assignInput(current, ids.B, reviewedB, 'collision-retry');
  await assert.rejects(assignProjectCode(ctx(), { ...inputB, expectedRecordVersion: 2 }),
    (error: { status?: number }) => error.status === 409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM usp_project_codes WHERE record_id=$1', [ids.B])).rows[0].n, 0);
  const collided = (await assertStatus(ids.A, 'assigned'));
  let draws = 0;
  const available = collided === codeA ? codeB : codeA;
  const receiptB = await assignProjectCode(ctx(), inputB, () => ++draws === 1 ? collided : available);
  assert.equal(draws, 2);
  assert.equal(await assertStatus(ids.B, 'assigned'), available);
  checks.push('stale version 409 and namespace unique-index savepoint retry');

  const faultScope = (await capture()).scope;
  const faultReview = await review('assign', faultScope, [ids.H], { location });
  const faultInput = assignInput(faultScope, ids.H, faultReview, 'fault-between-insert-and-receipt');
  await assert.rejects(assignProjectCode(ctx(), faultInput, undefined,
    async () => { throw new Error('injected after insert'); }), /injected after insert/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM usp_project_codes WHERE record_id=$1', [ids.H])).rows[0].n, 0);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM usp_command_receipts
    WHERE operation='project_identity_assign' AND request_key=$1`, [faultInput.requestKey])).rows[0].n, 0);
  const recovered = await assignProjectCode(ctx(), faultInput);
  await assertStatus(ids.H, 'assigned');
  checks.push('injected fault rolls back code and receipt; exact request subsequently succeeds');

  const resolveScope = (await capture()).scope;
  const aCode = await assertStatus(ids.A, 'assigned');
  const resolved = await resolveProjectIdentity(ctx(), { scope: resolveScope, identifier: aCode });
  assert.equal(resolved.recordId, ids.A);
  assert.equal(resolved.location, 'NO-ANCHOR / S01 / F07 / R003');
  await api('identity/resolve', { scope: resolveScope,
    identifier: 'NO-ANCHOR / S01 / F07 / R003' }, 422);
  checks.push('status-aware project-code resolver and locator string 422');

  await assert.rejects(resolveProjectIdentity(ctx(), { scope: initial, identifier: ids.A }),
    (error: { status?: number; code?: string }) => error.status === 409 && error.code === 'USP_IDENTITY_UNAVAILABLE_IN_SNAPSHOT');
  const selectedA = await captureRegistrySnapshot(ctx(), siteId, { kind: 'targets', pins: [
    { ref: { namespace: 'registry_record', id: ids.A }, revision: await version(ids.A) },
  ] });
  await assert.rejects(resolveProjectIdentity(ctx(), { scope: selectedA.scope, identifier: available }),
    (error: { status?: number }) => error.status === 403 || error.status === 409);
  checks.push('pre-assignment and selected-target snapshots do not expose later or unrelated identities');

  const scopeState = async () => ({
    reviews: (await pool.query('SELECT count(*)::int AS n FROM usp_project_identity_reviews WHERE manifest_id=$1',
      [selectedA.scope.manifestId])).rows[0].n,
    codes: (await pool.query('SELECT count(*)::int AS n FROM usp_project_codes WHERE scope_id=$1', [siteId])).rows[0].n,
    audits: (await pool.query('SELECT count(*)::int AS n FROM usp_project_identity_audit WHERE scope_id=$1', [siteId])).rows[0].n,
    outbox: (await pool.query('SELECT count(*)::int AS n FROM usp_outbox WHERE stream_id=$1', [`registry:${siteId}`])).rows[0].n,
    snapshots: (await pool.query('SELECT count(*)::int AS n FROM usp_snapshots WHERE scope_id=$1', [siteId])).rows[0].n,
    versions: Object.fromEntries(await Promise.all([ids.A, ids.B, ids.C, ids.D].map(async id => [id, await version(id)]))),
  });
  const beforeSelectionRejects = await scopeState();
  const otherLocation = { ...location, locator: { ...location.locator, spaceNumber: 4 } };
  const boundaryGeometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
  const rejectedReviews = [
    () => review('assign', selectedA.scope, [ids.C], { location }),
    () => review('correct', selectedA.scope, [ids.B],
      { predecessors: [ids.B], successors: [], location }),
    () => review('split', selectedA.scope, [ids.A, ids.C, ids.D],
      { predecessors: [ids.A], successors: [ids.C, ids.D],
        locations: { [ids.C]: location, [ids.D]: otherLocation } }),
    () => review('merge', selectedA.scope, [ids.A, ids.B, ids.C],
      { predecessors: [ids.A, ids.B], successors: [ids.C], locations: { [ids.C]: location } }),
    () => review('boundary_adjustment', selectedA.scope, [ids.A, ids.B],
      { predecessors: [ids.A], successors: [ids.B], transferredGeometry: boundaryGeometry }),
  ];
  for (const reject of rejectedReviews) await assert.rejects(reject(),
    (error: { status?: number; code?: string }) => error.status === 403 && error.code === 'USP_IDENTITY_SELECTION');
  assert.deepEqual(await scopeState(), beforeSelectionRejects);
  checks.push('A-only selection rejects unselected assignment, correction, split, merge and boundary reviews with no writes');

  const legacyReview = ProjectIdentityReviewSchema.parse({ operation: 'correct', scope: selectedA.scope,
    recordIds: [ids.B], predecessors: [ids.B], successors: [], expectedVersions: { [ids.B]: await version(ids.B) },
    reason: 'Simulated already-prepared review from prior validator', evidence, location });
  const legacyReviewId = randomUUID();
  await pool.query(`INSERT INTO usp_project_identity_reviews
    (id,scope_id,manifest_id,operation,command_hash,reviewer_subject,body)
    VALUES($1,$2,$3,'correct',$4,'local-demo-operator',$5)`, [legacyReviewId, siteId,
    selectedA.scope.manifestId, fingerprint(legacyReview), legacyReview]);
  const beforeLegacyCommit = await scopeState();
  await assert.rejects(mutateProjectIdentity(ctx(), { operation: 'correct',
    predecessors: [ids.B], successors: [], scope: selectedA.scope,
    expectedVersions: legacyReview.expectedVersions, expectedManifestId: selectedA.scope.manifestId,
    reviewId: legacyReviewId, requestKey: randomUUID() }),
  (error: { status?: number; code?: string }) => error.status === 403 && error.code === 'USP_IDENTITY_SELECTION');
  assert.deepEqual(await scopeState(), beforeLegacyCommit);
  assert.equal((await pool.query('SELECT consumed_at FROM usp_project_identity_reviews WHERE id=$1',
    [legacyReviewId])).rows[0].consumed_at, null);
  checks.push('already-prepared unselected review cannot commit; shared command validator rolls back cleanly');

  const revisedLocation = { ...location, anchorState: 'reviewed_partial' as const,
    parcels: [
      parcel(' AUTHORED-PARCEL-1 ', 'associated', 'reviewed'),
      parcel('AUTHORED-PARCEL-2', 'associated', 'reviewed'),
    ], locator: { ...location.locator, levels: ['F07', 'F08'] } };
  await mutation('correct', [ids.A], [], { location: revisedLocation });
  assert.equal(await assertStatus(ids.A, 'assigned'), aCode);
  const revised = await resolveProjectIdentity(ctx(), { scope: (await capture()).scope, identifier: aCode });
  assert.equal(revised.location, 'MULTI(2) / S01 / F07-F08 / R003');
  assert.equal((await resolveProjectIdentity(ctx(), { scope: resolveScope, identifier: aCode })).location,
    'NO-ANCHOR / S01 / F07 / R003');
  const identityBody = (await pool.query(`SELECT location FROM usp_project_identity_state WHERE record_id=$1`, [ids.A])).rows[0].location;
  assert.equal(identityBody.parcels[0].literalValue, ' AUTHORED-PARCEL-1 ');
  assert.deepEqual(identityBody.parcels[0].issuer, { state: 'unknown' });
  assert.deepEqual(identityBody.parcels[0].validity, { state: 'unknown' });
  checks.push('reviewed two-parcel duplex locator correction preserves code');

  const hCode = await assertStatus(ids.H, 'assigned');
  const unreviewedLocation = { ...location, anchorState: 'supplied_unreviewed' as const,
    parcels: [parcel('AUTHORED-UNREVIEWED', 'primary', 'supplied_unreviewed')] };
  const hTargetScope = (await captureRegistrySnapshot(ctx(), siteId, { kind: 'targets', pins: [
    { ref: { namespace: 'registry_record', id: ids.H }, revision: await version(ids.H) },
  ] })).scope;
  const hTargetReview = await review('correct', hTargetScope, [ids.H],
    { predecessors: [ids.H], successors: [], location: unreviewedLocation });
  const hTargetReceipt = await mutateProjectIdentity(ctx(), { operation: 'correct',
    predecessors: [ids.H], successors: [], scope: hTargetScope,
    expectedVersions: hTargetReview.expectedVersions, expectedManifestId: hTargetScope.manifestId,
    reviewId: hTargetReview.reviewId, requestKey: randomUUID() });
  UspCommitReceiptSchema.parse(hTargetReceipt);
  const hPostManifest = (await pool.query('SELECT body FROM usp_snapshots WHERE id=$1',
    [hTargetReceipt.snapshot.manifestId])).rows[0].body;
  assert.equal(hPostManifest.selection.kind, 'targets');
  assert.equal(hPostManifest.selection.pins.length, 1);
  assert.equal(hPostManifest.selection.pins[0].revision, await version(ids.H));
  assert.equal((await resolveProjectIdentity(ctx(), { scope: (await capture()).scope,
    identifier: hCode })).location, 'NO-ANCHOR / S01 / F07 / R003');
  const completeLocation = { ...location, anchorState: 'reviewed_complete' as const,
    parcels: [parcel('AUTHORED-PRIMARY', 'primary', 'reviewed')] };
  await mutation('correct', [ids.H], [], { location: completeLocation });
  assert.equal((await resolveProjectIdentity(ctx(), { scope: (await capture()).scope,
    identifier: hCode })).location, 'AUTHORED-PRIMARY / S01 / F07 / R003');
  assert.equal(await assertStatus(ids.H, 'assigned'), hCode);
  checks.push('unreviewed parcel stays NO-ANCHOR; reviewed primary appears without changing identity');
  checks.push('identity mutation post-state snapshot retains exact target selection and persisted pin');

  assert.equal(ProjectLocationSchema.safeParse({ ...completeLocation,
    parcels: [...completeLocation.parcels, parcel('UNREVIEWED-SECONDARY', 'associated', 'supplied_unreviewed')] }).success, false);
  const anchorScope = (await capture()).scope;
  await assert.rejects(review('correct', anchorScope, [ids.H], { predecessors: [ids.H], successors: [],
    location: completeLocation, evidence: [{ ...evidence[0], revision: 2 }] }),
  (error: { status?: number }) => error.status === 422);
  await assert.rejects(review('correct', anchorScope, [ids.H], { predecessors: [ids.H], successors: [],
    location: { ...completeLocation, parcels: [{ ...completeLocation.parcels[0],
      source: { ...completeLocation.parcels[0].source, revision: 2 } }] } }),
  (error: { status?: number }) => error.status === 422);
  checks.push('literal assertion metadata, mixed-complete rejection and stale source/revision pins');

  const invalidScope = (await capture()).scope;
  await assert.rejects(mutateProjectIdentity(ctx(), { operation: 'split',
    predecessors: [ids.A], successors: [ids.C], scope: invalidScope,
    expectedVersions: { [ids.A]: await version(ids.A), [ids.C]: await version(ids.C) },
    expectedManifestId: invalidScope.manifestId, reviewId: randomUUID(), requestKey: randomUUID() }),
  (error: { status?: number; code?: string }) => error.status === 422 && error.code === 'unsupported_lineage_kind');
  checks.push('unsupported 1-to-1 split returns 422 before mutation');

  const cLocation = { ...location, locator: { ...location.locator, spaceNumber: 101 } };
  const dLocation = { ...location, locator: { ...location.locator, levels: ['F08'], spaceNumber: 102 } };
  const splitScope = (await capture()).scope;
  await assert.rejects(review('split', splitScope, [ids.A, ids.C, ids.D], {
    predecessors: [ids.A], successors: [ids.C, ids.D], locations: { [ids.C]: cLocation } }),
  (error: { status?: number; code?: string }) => error.status === 422 && error.code === 'unsupported_lineage_kind');
  await assert.rejects(review('split', splitScope, [ids.A, ids.C, ids.D], {
    predecessors: [ids.A], successors: [ids.C, ids.D], locations: { [ids.C]: cLocation, [ids.D]: dLocation,
      [ids.E]: location } }),
  (error: { status?: number; code?: string }) => error.status === 422 && error.code === 'unsupported_lineage_kind');
  await assert.rejects(review('split', splitScope, [ids.A, ids.C, ids.D], {
    predecessors: [ids.A], successors: [ids.C, ids.D], locations: { [ids.C]: cLocation,
      [ids.D]: { ...dLocation, anchorState: 'reviewed_complete', parcels: [{
        ...parcel('UNPINNED-PARCEL', 'primary', 'reviewed'),
        source: { ...evidence[0], sourceId: randomUUID() } }] } } }),
  (error: { status?: number; code?: string }) => error.status === 422 && error.code === 'USP_ANCHOR_EVIDENCE');
  await mutation('split', [ids.A], [ids.C, ids.D], { locations: { [ids.C]: cLocation, [ids.D]: dLocation } });
  assert.equal(await assertStatus(ids.A, 'retired'), aCode);
  const cCode = await assertStatus(ids.C, 'assigned'), dCode = await assertStatus(ids.D, 'assigned');
  assert.notEqual(cCode, dCode);
  const afterSplitScope = (await capture()).scope;
  assert.equal((await resolveProjectIdentity(ctx(), { scope: afterSplitScope,
    identifier: cCode })).location, 'NO-ANCHOR / S01 / F07 / R101');
  assert.equal((await resolveProjectIdentity(ctx(), { scope: afterSplitScope,
    identifier: dCode })).location, 'NO-ANCHOR / S01 / F08 / R102');
  assert.equal((await resolveProjectIdentity(ctx(), { scope: splitScope,
    identifier: aCode })).status, 'assigned');
  const old = await resolveProjectIdentity(ctx(), { scope: (await capture()).scope, identifier: aCode });
  assert.deepEqual(old.successors, [ids.C, ids.D].sort());
  const legacy = (await pool.query('SELECT identifier FROM registry_records WHERE id=$1', [ids.A])).rows[0].identifier;
  assert.equal((await resolveProjectIdentity(ctx(), { scope: (await capture()).scope,
    identifier: legacy })).status, 'retired');
  const selectedOld = (await captureRegistrySnapshot(ctx(), siteId, { kind: 'targets', pins: [
    { ref: { namespace: 'registry_record', id: ids.A }, revision: await version(ids.A) },
  ] })).scope;
  assert.deepEqual((await resolveProjectIdentity(ctx(), { scope: selectedOld, identifier: aCode })).successors, []);
  const eLocation = { ...location, locator: { ...location.locator, structureNumber: 2, levels: ['F09'], spaceNumber: 9 } };
  await mutation('merge', [ids.C, ids.D], [ids.E], { locations: { [ids.E]: eLocation } });
  assert.equal(await assertStatus(ids.C, 'retired'), cCode);
  assert.equal(await assertStatus(ids.D, 'retired'), dCode);
  const eCode = await assertStatus(ids.E, 'assigned');
  assert(![aCode, cCode, dCode].includes(eCode));
  assert.equal((await resolveProjectIdentity(ctx(), { scope: (await capture()).scope,
    identifier: eCode })).location, 'NO-ANCHOR / S02 / F09 / R009');
  checks.push('atomic split and merge with fresh successor UUID/code, retirement and retained old resolver');

  const beforeCancelScope = (await capture()).scope;
  await mutation('cancel', [ids.B], []);
  assert.equal(await assertStatus(ids.B, 'cancelled_error'), available);
  assert.equal((await resolveProjectIdentity(ctx(), { scope: beforeCancelScope,
    identifier: available })).status, 'assigned');
  const beforeRetireScope = (await capture()).scope;
  await mutation('retire', [ids.E], []);
  assert.equal(await assertStatus(ids.E, 'retired'), eCode);
  assert.equal((await resolveProjectIdentity(ctx(), { scope: beforeRetireScope,
    identifier: eCode })).status, 'assigned');
  const nonreuseScope = (await capture()).scope;
  const nonreuseReview = await review('assign', nonreuseScope, [ids.B], { location });
  await assert.rejects(assignProjectCode(ctx(), assignInput(nonreuseScope, ids.B, nonreuseReview, randomUUID(), await version(ids.B))),
    (error: { status?: number }) => error.status === 409);
  await assert.rejects(pool.query('DELETE FROM usp_project_codes WHERE record_id=$1', [ids.B]),
    (error: { code?: string }) => error.code === 'P0001');
  await assert.rejects(pool.query("UPDATE usp_project_codes SET status='assigned' WHERE record_id=$1", [ids.B]),
    (error: { code?: string }) => error.code === 'P0001');
  checks.push('error cancellation and terminal retirement retain nonreusable tombstones');

  const transferredGeometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
  const beforeInvalid = {
    audit: (await pool.query('SELECT count(*)::int AS n FROM usp_project_identity_audit WHERE scope_id=$1', [siteId])).rows[0].n,
    outbox: (await pool.query('SELECT count(*)::int AS n FROM usp_outbox WHERE stream_id=$1', [`registry:${siteId}`])).rows[0].n,
    h: await version(ids.H), f: await version(ids.F), e: await version(ids.E), b: await version(ids.B),
  };
  for (const recipient of [ids.F, ids.E, ids.B]) {
    await assert.rejects(mutation('boundary_adjustment', [ids.H], [recipient], { transferredGeometry }),
      (error: { status?: number }) => error.status === 409);
  }
  assert.deepEqual({
    audit: (await pool.query('SELECT count(*)::int AS n FROM usp_project_identity_audit WHERE scope_id=$1', [siteId])).rows[0].n,
    outbox: (await pool.query('SELECT count(*)::int AS n FROM usp_outbox WHERE stream_id=$1', [`registry:${siteId}`])).rows[0].n,
    h: await version(ids.H), f: await version(ids.F), e: await version(ids.E), b: await version(ids.B),
  }, beforeInvalid);
  checks.push('boundary adjustment rejects unassigned, retired and cancelled recipients without writes');

  for (const id of [ids.F, ids.G]) {
    const scope = (await capture()).scope;
    const reviewed = await review('assign', scope, [id], { location });
    await assignProjectCode(ctx(), assignInput(scope, id, reviewed));
  }
  const fCode = await assertStatus(ids.F, 'assigned'), gCode = await assertStatus(ids.G, 'assigned');
  const beforeF = await version(ids.F), beforeG = await version(ids.G);
  const bothSelected = (await captureRegistrySnapshot(ctx(), siteId, { kind: 'targets', pins: [
    { ref: { namespace: 'registry_record', id: ids.F }, revision: beforeF },
    { ref: { namespace: 'registry_record', id: ids.G }, revision: beforeG },
  ] })).scope;
  const bothReviewed = await review('boundary_adjustment', bothSelected, [ids.F, ids.G],
    { predecessors: [ids.F], successors: [ids.G], transferredGeometry });
  const bothReceipt = await mutateProjectIdentity(ctx(), { operation: 'boundary_adjustment',
    predecessors: [ids.F], successors: [ids.G], scope: bothSelected,
    expectedVersions: bothReviewed.expectedVersions, expectedManifestId: bothSelected.manifestId,
    reviewId: bothReviewed.reviewId, requestKey: randomUUID() });
  UspCommitReceiptSchema.parse(bothReceipt);
  const bothPost = (await pool.query('SELECT body FROM usp_snapshots WHERE id=$1',
    [bothReceipt.snapshot.manifestId])).rows[0].body;
  assert.equal(bothPost.selection.kind, 'targets');
  assert.deepEqual(bothPost.selection.pins.map((pin: { ref: { id: string }; revision: number }) =>
    [pin.ref.id, pin.revision]).sort(), [[ids.F, beforeF + 1], [ids.G, beforeG + 1]].sort());
  assert.equal(await assertStatus(ids.F, 'assigned'), fCode);
  assert.equal(await assertStatus(ids.G, 'assigned'), gCode);
  assert.equal(await version(ids.F), beforeF + 1);
  assert.equal(await version(ids.G), beforeG + 1);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM usp_project_lineage
    WHERE kind='boundary_adjustment' AND predecessor_id=$1 AND successor_id=$2
      AND transferred_geometry IS NOT NULL`, [ids.F, ids.G])).rows[0].n, 1);
  assert.deepEqual((await resolveProjectIdentity(ctx(), { scope: (await capture()).scope,
    identifier: fCode })).successors, []);
  await mutation('boundary_adjustment', [ids.G], [ids.F], { transferredGeometry });
  assert.equal(await assertStatus(ids.F, 'assigned'), fCode);
  assert.equal(await assertStatus(ids.G, 'assigned'), gCode);
  assert.deepEqual((await resolveProjectIdentity(ctx(), { scope: (await capture()).scope,
    identifier: gCode })).successors, []);
  checks.push('boundary adjustment preserves both codes, advances both revisions and records geometry/evidence');
  checks.push('fully selected two-target boundary review and commit retain both post-state pins');
  checks.push('reverse temporal boundary adjustment succeeds and never appears as identity successor');

  assert.deepEqual(UspCommitReceiptSchema.parse(await assignProjectCode(ctx(), winning)), receiptA);
  const tamperScope = (await capture()).scope;
  await pool.query(`UPDATE usp_snapshot_bodies
    SET body=jsonb_set(body,'{projectIdentity,status}','"retired"'::jsonb)
    WHERE manifest_id=$1 AND namespace='registry_record' AND object_id=$2`, [tamperScope.manifestId, ids.H]);
  await assert.rejects(resolveProjectIdentity(ctx(), { scope: tamperScope, identifier: hCode }),
    (error: { status?: number; code?: string }) => error.status === 409 && error.code === 'USP_IDENTITY_SNAPSHOT_CORRUPT');
  checks.push('old receipt replays after later data revisions; altered captured identity fails hash check');

  const finalRows = (await pool.query(`SELECT status,count(*)::int AS n FROM usp_project_codes
    WHERE scope_id=$1 GROUP BY status ORDER BY status`, [siteId])).rows;
  const auditCount = (await pool.query('SELECT count(*)::int AS n FROM usp_project_identity_audit WHERE scope_id=$1', [siteId])).rows[0].n;
  const receiptCount = (await pool.query(`SELECT count(*)::int AS n FROM usp_command_receipts
    WHERE scope_key=$1 AND operation LIKE 'project_identity_%'`, [siteId])).rows[0].n;
  assert.equal(auditCount, receiptCount);
  report.rows = finalRows;
  report.auditCount = auditCount;
  report.receiptCount = receiptCount;
  report.representativeReceipts = [receiptA.receiptId, receiptB.receiptId, recovered.receiptId];
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  await pool.end();
  s3.destroy();
  const output = resolve('.runtime/engineering/usp-gf-t15.json');
  await mkdir(resolve('.runtime/engineering'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
