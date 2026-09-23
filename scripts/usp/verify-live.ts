/** Runs only inside the hosted disposable isolation profile, against real HTTP, SQL and S3. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertIsolation } from '../engineering/isolation.mjs';

assertIsolation(process.env);
const { registerUspJobInputTx, claimUspJobAttempt, heartbeatUspJobAttempt,
  acceptUspJobAttempt, cancelUspJob, readUspJob } = await import('../../apps/web/lib/server/usp/jobs');
const require = createRequire(resolve('apps/web/package.json'));
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, max: 2 });
const base = 'http://127.0.0.1:3000/api/v1';
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const report: Record<string, unknown> = { schemaVersion: 'usp-fnd-live/1',
  codeSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  environment: 'hosted-disposable-isolation', data: 'retained synthetic Nandan baseline; not full D0' };

async function api(path: string, payload?: unknown, expected = 200) {
  const response = await fetch(base + path, { method: payload === undefined ? 'GET' : 'POST',
    headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload) });
  const body = await response.json();
  assert.equal(response.status, expected, `${path}: ${body.error?.code ?? response.status}`);
  return body;
}

try {
  const siteRow = (await pool.query("SELECT id FROM registry_sites WHERE seed_key='nandan-v1' AND revision>0")).rows[0];
  assert(siteRow, 'Expected retained synthetic Nandan registry site');
  const siteId = siteRow.id;
  const detail = await api(`/sites/${siteId}`);
  const activeDrafts = (await pool.query("SELECT records FROM registry_drafts WHERE site_id=$1 AND status='draft'", [siteId])).rows;
  const draftedIds = new Set(activeDrafts.flatMap((draft: any) => draft.records.map((record: any) => record.id)));
  const space = detail.records.find((record: any) => record.kind === 'space'
    && record.links.some((link: any) => link.type === 'floor') && record.evidence.length
    && !draftedIds.has(record.id));
  assert(space, 'Expected an undrafted evidence-linked synthetic unit with a supplied floor');
  const floorId = space.links.find((link: any) => link.type === 'floor')?.targetId;
  const floor = detail.records.find((record: any) => record.id === floorId);
  const buildingId = floor?.links.find((link: any) => link.type === 'within')?.targetId;
  const building = detail.records.find((record: any) => record.id === buildingId);
  const otherBuilding = detail.records.find((record: any) => record.kind === 'building' && record.id !== buildingId);
  assert(floor && building && otherBuilding, 'Expected two buildings and a supplied floor chain');
  const capture = () => api('/usp/snapshots', { scopeId: siteId,
    world: { namespace: 'world', id: `registry-site/${siteId}` }, stage: 'recorded', selection: { kind: 'site' } });
  const manifest = (await capture()).data;
  const scope = manifest.scope;
  const recorded = (await pool.query('SELECT id,revision FROM registry_records WHERE site_id=$1 AND revision>0', [siteId])).rows;
  assert.equal(manifest.members.filter((member: any) => member.pin.ref.namespace === 'registry_record').length, recorded.length);
  const pins = [building, floor, space, otherBuilding].map((record: any) => ({
    ref: { namespace: 'registry_record', id: record.id }, revision: record.revision }));
  const [buildingPin, floorPin, spacePin, otherPin] = pins;
  const selected = (await api('/usp/targets/vertical', { scope, building: buildingPin, floor: floorPin, space: spacePin })).data;
  assert.equal(selected.state, 'available');
  const invalid = (await api('/usp/targets/vertical', { scope, building: otherPin, floor: floorPin, space: spacePin })).data;
  assert.deepEqual(invalid, { state: 'unavailable', reasonCode: 'invalid_vertical_membership' });
  const page1 = (await api('/usp/scope/read', { scope, cursor: null, limit: 1 })).data;
  assert.equal(page1.items.length, 1);
  assert(page1.nextCursor);
  const page2 = (await api('/usp/scope/read', { scope, cursor: page1.nextCursor, limit: 1 })).data;
  assert.notEqual(page1.items[0].pin.ref.id, page2.items[0].pin.ref.id);
  const target = selected.data.space;
  assert(target.evidence.length > 0, 'Expected evidence-linked synthetic unit');
  const pointer = target.evidence[0];
  const sourceRow = (await pool.query('SELECT sha256,bytes,inspection FROM sources WHERE id=$1',
    [pointer.sourceRevision.ref.id])).rows[0];
  assert(sourceRow);
  const originalResponse = await fetch(base + '/usp/evidence/original', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, pointer, action: 'original' }) });
  assert.equal(originalResponse.status, 200, 'Exact source original must be readable');
  const originalBytes = new Uint8Array(await originalResponse.arrayBuffer());
  assert.equal(hash(originalBytes), sourceRow.sha256);
  assert.equal(originalBytes.length, Number(sourceRow.bytes));
  const key = randomUUID();
  const packetRequest = { scope, target: spacePin, evidence: [pointer], format: 'text',
    guard: { mode: 'create', requestKey: key } };
  const packet = (await api('/usp/packets', packetRequest)).data;
  const replay = (await api('/usp/packets', packetRequest)).data;
  assert.deepEqual(replay, packet, 'Exact replay must return saved receipt');
  await api('/usp/packets', { ...packetRequest, format: 'csv' }, 409);
  const download = await fetch(base + `/usp/packets/${packet.packetId}`);
  assert.equal(download.status, 200);
  const packetBytes = new Uint8Array(await download.arrayBuffer());
  assert.equal(hash(packetBytes), packet.artifact.sha256);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM usp_packets WHERE id=$1', [packet.packetId])).rows[0].n, 1);
  const snapshotsBeforeFailure = (await pool.query('SELECT count(*)::int AS n FROM usp_snapshots WHERE scope_id=$1', [siteId])).rows[0].n;
  await api('/usp/proposals/commit', { kind: 'registry', proposalId: randomUUID(), reviewId: randomUUID(),
    scope, guard: { mode: 'update', requestKey: randomUUID(), expectedVersion: 1, expectedManifestId: scope.manifestId },
    acknowledgement: '' }, 404);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM usp_snapshots WHERE scope_id=$1', [siteId])).rows[0].n,
    snapshotsBeforeFailure, 'Failed command must roll back its captured snapshot');
  const draft = await api(`/sites/${siteId}/drafts`, { recordId: space.id }, 201);
  const review = await api(`/registry-drafts/${draft.id}/review`, {
    expectedRevision: draft.revision, expectedSiteRevision: detail.site.revision });
  assert(!review.findings.some((finding: any) => finding.severity === 'error'));
  const prepared = (await api('/usp/proposals/prepare', { kind: 'registry', scope,
    changes: [{ kind: 'registry_draft', draftId: draft.id, expectedDraftRevision: draft.revision }],
    evidence: [pointer], target: spacePin, guard: { mode: 'create', requestKey: randomUUID() } })).data;
  assert.equal(prepared.proposalId, draft.id);
  const commitRequest = { kind: 'registry', proposalId: draft.id, reviewId: review.id, scope,
    guard: { mode: 'update', requestKey: randomUUID(), expectedVersion: draft.revision,
      expectedManifestId: scope.manifestId },
    acknowledgement: 'Synthetic fixture: unchanged record and source evidence checked for this isolated test.' };
  const committed = (await api('/usp/proposals/commit', commitRequest)).data;
  assert.equal(committed.before[0].ref.id, space.id);
  assert.equal(committed.after[0].revision, space.revision + 1);
  assert.deepEqual((await api('/usp/proposals/commit', commitRequest)).data, committed);
  assert.equal((await pool.query('SELECT revision FROM registry_records WHERE id=$1', [space.id])).rows[0].revision,
    space.revision + 1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM registry_revisions WHERE record_id=$1 AND revision=$2',
    [space.id, space.revision + 1])).rows[0].n, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM usp_outbox WHERE stream_id=$1 AND sequence=$2',
    [committed.event.streamId, committed.event.sequence])).rows[0].n, 1);
  const latest = (await capture()).data;
  assert.notEqual(latest.digest, manifest.digest);
  const historical = (await api('/usp/targets/resolve', { scope, pin: spacePin })).data;
  assert.equal(historical.state, 'available');
  assert.equal(historical.data.pin.revision, space.revision);
  assert.equal((await pool.query('SELECT sha256 FROM sources WHERE id=$1', [pointer.sourceRevision.ref.id])).rows[0].sha256,
    sourceRow.sha256);
  const caseId = (await pool.query('SELECT seed_case_id FROM registry_sites WHERE id=$1', [siteId])).rows[0].seed_case_id;
  assert(caseId);
  async function jobFixture() {
    const jobId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO jobs(id,case_id,operation,status,input_fingerprint,payload)
        VALUES($1,$2,'usp:packet0','queued',$3,'{}'::jsonb)`, [jobId, caseId, hash(packetBytes)]);
      await registerUspJobInputTx(client, jobId, scope, manifest.id, hash(packetBytes));
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    return jobId;
  }
  const jobId = await jobFixture();
  const first = await claimUspJobAttempt(jobId, 'hosted-worker-1');
  await heartbeatUspJobAttempt(first);
  await pool.query("UPDATE usp_job_attempts SET lease_until=now()-interval '1 second' WHERE job_id=$1 AND fence=$2",
    [jobId, first.fence]);
  const second = await claimUspJobAttempt(jobId, 'hosted-worker-2');
  assert(second.fence > first.fence);
  const asset = packet.artifact;
  const validatePacket = async (client: any, _job: Record<string, unknown>, output: any) => {
    const saved = (await client.query('SELECT artifact_hash FROM usp_packets WHERE id=$1', [output.assetId])).rows[0];
    assert.equal(saved?.artifact_hash, output.sha256);
  };
  await assert.rejects(acceptUspJobAttempt(first, asset, validatePacket), /superseded|expired/);
  assert.deepEqual(await acceptUspJobAttempt(second, asset, validatePacket), asset);
  assert.deepEqual(await acceptUspJobAttempt(second, asset, validatePacket), asset);
  assert.equal((await readUspJob(jobId)).status, 'succeeded');
  const cancelledId = await jobFixture();
  const cancelledAttempt = await claimUspJobAttempt(cancelledId, 'hosted-worker-3');
  await cancelUspJob(cancelledId, (await readUspJob(cancelledId)).version);
  await assert.rejects(acceptUspJobAttempt(cancelledAttempt, asset, validatePacket), /superseded|expired/);
  assert.equal((await readUspJob(cancelledId)).status, 'cancelled');
  Object.assign(report, { status: 'passed', siteId, sourceSha256: sourceRow.sha256,
    manifestId: manifest.id, manifestDigest: manifest.digest,
    targetId: space.id, targetRevisionBefore: space.revision,
    targetRevisionAfter: committed.after[0].revision,
    packetId: packet.packetId, packetSha256: packet.artifact.sha256,
    packetStatus: packet.status, commitReceiptId: committed.receiptId,
    event: committed.event, originalBytes: originalBytes.length,
    fencedJobId: jobId, fences: [first.fence, second.fence], cancelledJobId: cancelledId });
} finally {
  await pool.end();
  const output = resolve('.runtime/engineering/usp-fnd-live.json');
  await mkdir(resolve('.runtime/engineering'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
