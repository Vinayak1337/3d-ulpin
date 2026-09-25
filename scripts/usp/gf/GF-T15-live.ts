/** Authored GF-T15 transaction cases inside the existing disposable USP Compose runner. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertUspIsolation } from '../local-isolation.mjs';
import { projectCodeForPayload } from '../../../packages/contracts/src/usp/project-identity';
import { localRequestContext } from '../../../apps/web/lib/server/usp/principal';
import { captureRegistrySnapshot } from '../../../apps/web/lib/server/usp/snapshots';
import { assignProjectCode, mutateProjectIdentity, prepareProjectIdentityReview,
  resolveProjectIdentity } from '../../../apps/web/lib/server/usp/project-identity';

assertUspIsolation(process.env);
const require = createRequire(resolve('apps/web/package.json'));
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
const evidence = [{ sourceId, locator: 'authored identity fixture, line 1' }];
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
  assert.equal(receiptA.receiptId, (simultaneous.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<any>).value.receiptId);
  await assert.rejects(assignProjectCode(ctx(), { ...winning, expectedRecordVersion: 2 }),
    (error: { status?: number }) => error.status === 409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM usp_project_codes WHERE record_id=$1', [ids.A])).rows[0].n, 1);
  checks.push('two-writer same-record race, exact replay and changed-payload 409');

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

  const revisedLocation = { ...location, anchorState: 'reviewed_partial' as const,
    parcels: [
      { ulpin: 'AUTHORED-PARCEL-1', role: 'associated' as const, sourceId, reviewed: true },
      { ulpin: 'AUTHORED-PARCEL-2', role: 'associated' as const, sourceId, reviewed: true },
    ], locator: { ...location.locator, levels: ['F07', 'F08'] } };
  await mutation('correct', [ids.A], [], { location: revisedLocation });
  assert.equal(await assertStatus(ids.A, 'assigned'), aCode);
  const revised = await resolveProjectIdentity(ctx(), { scope: (await capture()).scope, identifier: aCode });
  assert.equal(revised.location, 'MULTI(2) / S01 / F07-F08 / R003');
  checks.push('reviewed two-parcel duplex locator correction preserves code');

  const hCode = await assertStatus(ids.H, 'assigned');
  const unreviewedLocation = { ...location, anchorState: 'supplied_unreviewed' as const,
    parcels: [{ ulpin: 'AUTHORED-UNREVIEWED', role: 'primary' as const, sourceId, reviewed: false }] };
  await mutation('correct', [ids.H], [], { location: unreviewedLocation });
  assert.equal((await resolveProjectIdentity(ctx(), { scope: (await capture()).scope,
    identifier: hCode })).location, 'NO-ANCHOR / S01 / F07 / R003');
  const completeLocation = { ...location, anchorState: 'reviewed_complete' as const,
    parcels: [{ ulpin: 'AUTHORED-PRIMARY', role: 'primary' as const, sourceId, reviewed: true }] };
  await mutation('correct', [ids.H], [], { location: completeLocation });
  assert.equal((await resolveProjectIdentity(ctx(), { scope: (await capture()).scope,
    identifier: hCode })).location, 'AUTHORED-PRIMARY / S01 / F07 / R003');
  assert.equal(await assertStatus(ids.H, 'assigned'), hCode);
  checks.push('unreviewed parcel stays NO-ANCHOR; reviewed primary appears without changing identity');

  const invalidScope = (await capture()).scope;
  await assert.rejects(mutateProjectIdentity(ctx(), { operation: 'split',
    predecessors: [ids.A], successors: [ids.C], scope: invalidScope,
    expectedVersions: { [ids.A]: await version(ids.A), [ids.C]: await version(ids.C) },
    expectedManifestId: invalidScope.manifestId, reviewId: randomUUID(), requestKey: randomUUID() }),
  (error: { status?: number; code?: string }) => error.status === 422 && error.code === 'unsupported_lineage_kind');
  checks.push('unsupported 1-to-1 split returns 422 before mutation');

  await mutation('split', [ids.A], [ids.C, ids.D], { location });
  assert.equal(await assertStatus(ids.A, 'retired'), aCode);
  const cCode = await assertStatus(ids.C, 'assigned'), dCode = await assertStatus(ids.D, 'assigned');
  assert.notEqual(cCode, dCode);
  const old = await resolveProjectIdentity(ctx(), { scope: (await capture()).scope, identifier: aCode });
  assert.deepEqual(old.successors, [ids.C, ids.D].sort());
  const legacy = (await pool.query('SELECT identifier FROM registry_records WHERE id=$1', [ids.A])).rows[0].identifier;
  assert.equal((await resolveProjectIdentity(ctx(), { scope: (await capture()).scope,
    identifier: legacy })).status, 'retired');
  await mutation('merge', [ids.C, ids.D], [ids.E], { location });
  assert.equal(await assertStatus(ids.C, 'retired'), cCode);
  assert.equal(await assertStatus(ids.D, 'retired'), dCode);
  const eCode = await assertStatus(ids.E, 'assigned');
  assert(![aCode, cCode, dCode].includes(eCode));
  checks.push('atomic split and merge with fresh successor UUID/code, retirement and retained old resolver');

  await mutation('cancel', [ids.B], []);
  assert.equal(await assertStatus(ids.B, 'cancelled_error'), available);
  await mutation('retire', [ids.E], []);
  assert.equal(await assertStatus(ids.E, 'retired'), eCode);
  const nonreuseScope = (await capture()).scope;
  const nonreuseReview = await review('assign', nonreuseScope, [ids.B], { location });
  await assert.rejects(assignProjectCode(ctx(), assignInput(nonreuseScope, ids.B, nonreuseReview, randomUUID(), await version(ids.B))),
    (error: { status?: number }) => error.status === 409);
  await assert.rejects(pool.query('DELETE FROM usp_project_codes WHERE record_id=$1', [ids.B]),
    (error: { code?: string }) => error.code === 'P0001');
  await assert.rejects(pool.query("UPDATE usp_project_codes SET status='assigned' WHERE record_id=$1", [ids.B]),
    (error: { code?: string }) => error.code === 'P0001');
  checks.push('error cancellation and terminal retirement retain nonreusable tombstones');

  for (const id of [ids.F, ids.G]) {
    const scope = (await capture()).scope;
    const reviewed = await review('assign', scope, [id], { location });
    await assignProjectCode(ctx(), assignInput(scope, id, reviewed));
  }
  const fCode = await assertStatus(ids.F, 'assigned'), gCode = await assertStatus(ids.G, 'assigned');
  const beforeF = await version(ids.F), beforeG = await version(ids.G);
  const transferredGeometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
  await mutation('boundary_adjustment', [ids.F], [ids.G], { transferredGeometry });
  assert.equal(await assertStatus(ids.F, 'assigned'), fCode);
  assert.equal(await assertStatus(ids.G, 'assigned'), gCode);
  assert.equal(await version(ids.F), beforeF + 1);
  assert.equal(await version(ids.G), beforeG + 1);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM usp_project_lineage
    WHERE kind='boundary_adjustment' AND predecessor_id=$1 AND successor_id=$2
      AND transferred_geometry IS NOT NULL`, [ids.F, ids.G])).rows[0].n, 1);
  checks.push('boundary adjustment preserves both codes, advances both revisions and records geometry/evidence');

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
