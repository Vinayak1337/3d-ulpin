import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { UspSnapshotManifestSchema, projectCodeForPayload } from '../packages/contracts/src/usp';
import { fingerprint } from '../packages/server/src/modules/cases/domain';
import { localRequestContext } from '../packages/server/src/modules/usp/principal';
import { assignProjectCode, mutateProjectIdentity, prepareProjectIdentityReview,
  resolveProjectIdentity } from '../packages/server/src/modules/usp/project-identity';

// Memory SQL protocol controls only. The unchanged foreign D1 source has a
// building exterior, not the technical space/identity/snapshot below. No real
// property correspondence, accepted document job or persisted allocation is claimed.
const bytes = readFileSync(new URL('../fixtures/usp/D1/single-roof/original.json', import.meta.url));
const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
const subject = 'project-identity-authority-control';
const globals = globalThis as unknown as { ulpinPool?: unknown };

function fixture() {
  const scopeId = randomUUID(), recordId = randomUUID(), sourceId = randomUUID(), caseId = randomUUID();
  const ctx = localRequestContext(randomUUID());
  const scope = { kind: 'snapshot' as const, scopeId, world: { namespace: 'world', id: 'identity-control' },
    manifestId: randomUUID(), snapshotDigest: 'a'.repeat(64), stage: 'recorded' as const };
  const pin = { ref: { namespace: 'registry_record', id: recordId }, revision: 2 };
  const location = { anchorState: 'not_supplied', parcels: [], locator: {
    structureKind: 'S', structureNumber: 1, levels: ['L?'], spaceKind: 'V', spaceNumber: 1 } };
  const code = projectCodeForPayload('0123456789ABCDEFGHJK');
  const captured = { object_id: recordId, revision: 2, body: { id: recordId, site_id: scopeId,
    kind: 'space', identifier: 'technical-space-only', body: { synthetic: true,
      evidence: [{ sourceId, locator: 'unchanged foreign source; no real space correspondence' }] },
    projectIdentity: { code, status: 'assigned', location, successors: [] }, historicalAliases: [] }, body_sha256: '' };
  captured.body_sha256 = fingerprint(captured.body);
  const source = { id: sourceId, case_id: caseId, revision: 1, sha256: sourceSha256,
    bytes: bytes.length, object_key: 'memory-only-no-object-read', inspection: {} };
  const sourceHash = fingerprint(source);
  const manifest = UspSnapshotManifestSchema.parse({ schemaVersion: 'usp/1', id: scope.manifestId,
    digest: scope.snapshotDigest, scope, capturedAt: '2026-10-05T00:00:00Z',
    selection: { kind: 'targets', pins: [pin] }, members: [
      { pin, bodySha256: captured.body_sha256,
        bodyRef: fingerprint(['registry_record', recordId, 2, captured.body]), authority: 'registry' },
      { pin: { ref: { namespace: 'source_revision', id: sourceId }, revision: 1 },
        bodySha256: sourceHash, bodyRef: 'technical-source-pin', authority: 'source' },
    ].sort((a, b) => a.pin.ref.namespace.localeCompare(b.pin.ref.namespace)),
    frame: { horizontal: null, vertical: null, unit: null, transform: null },
    policyVersion: ctx.policyVersion, accessViewId: ctx.accessViewId, validAt: null, asOf: null,
    coverage: { state: 'complete', reasonCodes: [] } });
  const reviewId = randomUUID();
  const assignment = { scope, expectedManifestId: scope.manifestId, reviewId, requestKey: 'exact-replay',
    recordId, expectedRecordVersion: 1 };
  const mutation = { scope, expectedManifestId: scope.manifestId, reviewId, requestKey: 'exact-replay',
    operation: 'retire' as const, predecessors: [recordId], successors: [], expectedVersions: { [recordId]: 1 } };
  const receipt = (command: typeof assignment | typeof mutation, operation: string) => ({
    kind: 'project_identity', receiptId: randomUUID(), operation, requestKey: command.requestKey,
    commandSha256: fingerprint(command), reviewId, before: [{ ...pin, revision: 1 }], after: [pin],
    snapshot: scope, outcome: { codes: { [recordId]: code } },
    event: { streamId: `registry:${scopeId}`, sequence: '1' }, committedAt: '2026-10-05T00:00:00Z',
  });
  const state = { source: structuredClone(source) as Record<string, any>, sourceHash,
    archived: false, queries: [] as string[], releases: 0, recordReads: 0, writes: 0 };
  const receipts = new Map([
    ['project_identity_assign', receipt(assignment, 'project_identity_assign')],
    ['project_identity_retire', receipt(mutation, 'project_identity_retire')],
  ]);
  const query = async (sql: string, values: any[] = []) => {
    const q = sql.replace(/\s+/g, ' ').trim(); state.queries.push(q);
    const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(q) || q.startsWith('SELECT pg_advisory_xact_lock')) return result();
    if (/^(INSERT|UPDATE|DELETE)/.test(q)) { state.writes++; throw new Error('No writes allowed in this control'); }
    if (q.startsWith('SELECT command_sha256,body FROM usp_command_receipts')) {
      const saved = receipts.get(values[2]);
      return result(saved ? [{ command_sha256: saved.commandSha256, body: saved }] : []);
    }
    if (q.startsWith('SELECT body FROM usp_snapshots')) return result([{ body: manifest }]);
    if (q.startsWith('SELECT body,body_sha256 FROM usp_snapshot_bodies')) return result([{ body: source, body_sha256: state.sourceHash }]);
    if (q.startsWith('SELECT * FROM sources WHERE id=')) return result([state.source]);
    if (q.startsWith('SELECT id FROM cases WHERE id=')) return result([{ id: caseId }]);
    if (q.startsWith('SELECT id,revision,archived,frame,context,site_id FROM cases')) return result([{ id: caseId, archived: state.archived }]);
    if (q.startsWith('SELECT object_id,revision,body,body_sha256 FROM usp_snapshot_bodies')) {
      state.recordReads++; return result([captured]);
    }
    if (q.startsWith('SELECT id,site_id,kind,revision,body FROM registry_records')) return result([
      { id: recordId, site_id: scopeId, kind: 'building', revision: 1, body: {} },
    ]);
    throw new Error(`Unimplemented memory SQL: ${q}`);
  };
  const pool = { connect: async () => ({ query, release: () => { state.releases++; } }) };
  return { ctx, scope, source, captured, state, pool, code, assignment, mutation, receipts, location, recordId };
}

async function control(work: (f: ReturnType<typeof fixture>) => Promise<void>) {
  const previousSubject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT, previousPool = globals.ulpinPool;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = subject;
  const f = fixture(); globals.ulpinPool = f.pool;
  try { await work(f); assert.equal(f.state.writes, 0); }
  finally {
    globals.ulpinPool = previousPool;
    if (previousSubject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previousSubject;
  }
}
const error = (status: number, code?: string) => (value: any) => value.status === status && (!code || value.code === code);

test('retained D1 source supplies only a foreign building and part, not an identity target', async () => control(async f => {
  assert.equal(sourceSha256, '5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2');
  const original = JSON.parse(bytes.toString('utf8'));
  assert.deepEqual(Object.values(original.feature.CityObjects).map((object: any) => object.type).sort(), ['Building', 'BuildingPart']);
  await assert.rejects(prepareProjectIdentityReview(f.ctx, { operation: 'assign', scope: f.scope,
    recordIds: [f.recordId], expectedVersions: { [f.recordId]: 1 }, reason: 'Technical refusal control',
    evidence: [{ sourceId: f.source.id, revision: 1, locator: 'foreign exterior only' }], location: f.location } as any),
  error(422, 'USP_IDENTITY_TARGET'));
}));

test('exact identity read preserves lifecycle/revision and refuses source drift or revoked document access', async () => control(async f => {
  const input = { scope: f.scope, identifier: f.code };
  const resolved = await resolveProjectIdentity(f.ctx, input as any);
  assert.equal(resolved.status, 'assigned'); assert.equal(resolved.recordVersion, 2);
  assert.equal(resolved.projectCode, f.code); assert.equal(resolved.location, 'NO-ANCHOR / S01 / L? / V001');
  f.state.source.revision = 2;
  await assert.rejects(resolveProjectIdentity(f.ctx, input as any), error(409));
  assert.equal(f.state.recordReads, 1, 'deny before disclosing the captured identity');
  f.state.source.revision = 1;
  f.state.source.inspection = { documentOriginal: { subject } }; f.state.archived = true;
  await assert.rejects(resolveProjectIdentity(f.ctx, input as any), error(403, 'DOCUMENT_DENIED'));
  assert.equal(f.state.recordReads, 1);
}));

test('assignment and lifecycle receipt replay retain exact payload checks and current source authority', async () => control(async f => {
  for (const [operation, command, execute] of [
    ['project_identity_assign', f.assignment, assignProjectCode],
    ['project_identity_retire', f.mutation, mutateProjectIdentity],
  ] as const) {
    assert.deepEqual(await execute(f.ctx, command as any), f.receipts.get(operation));
    await assert.rejects(execute(f.ctx, { ...command, reviewId: randomUUID() } as any), error(409));
    f.state.source.revision = 2;
    await assert.rejects(execute(f.ctx, command as any), error(409));
    f.state.source.revision = 1;
    f.state.source.inspection = { documentOriginal: { subject } }; f.state.archived = true;
    await assert.rejects(execute(f.ctx, command as any), error(403, 'DOCUMENT_DENIED'));
    f.state.source.inspection = {}; f.state.archived = false;
  }
}));

test('identity reads retain role/body integrity and reject a corrupt captured source', async () => control(async f => {
  const input = { scope: f.scope, identifier: f.code };
  await assert.rejects(resolveProjectIdentity({ ...f.ctx, principal: { ...f.ctx.principal, roles: [] } }, input as any), error(403));
  assert.equal(f.state.queries.length, 0);
  await assert.rejects(resolveProjectIdentity({ ...f.ctx, accessViewId: 'changed-view' }, input as any), error(409));
  f.captured.body.projectIdentity.status = 'retired';
  await assert.rejects(resolveProjectIdentity(f.ctx, input as any), error(409, 'USP_IDENTITY_SNAPSHOT_CORRUPT'));
  f.captured.body.projectIdentity.status = 'assigned';
  f.state.sourceHash = 'b'.repeat(64);
  await assert.rejects(resolveProjectIdentity(f.ctx, input as any), error(409, 'USP_REVISION_UNAVAILABLE'));
}));
