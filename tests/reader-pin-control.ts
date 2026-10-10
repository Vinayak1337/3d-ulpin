import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { fingerprint } from '../packages/server/src/modules/cases/domain';
import { ingestionBinding } from '../packages/server/src/modules/usp/ingestion/events';

export type ReaderControl = {
  name: string;
  version: string;
  profile: string;
  marker: string;
  operation: string;
  asset: (jobId: string) => string;
  lineage?: Record<string, unknown>;
  source: (client: PoolClient, caseId: string, sourceId: string) => Promise<any>;
  input: (ctx: any, jobId: string) => any;
  check: (client: PoolClient, input: any) => Promise<any>;
  capture: (client: PoolClient, caseId: string, sourceId: string, jobId: string) => Promise<any>;
};

export function readerFixture(reader: ReaderControl) {
  const caseId = randomUUID();
  const sourceId = randomUUID();
  const binding = ingestionBinding(caseId);
  const hash = fingerprint({ protocol: sourceId });
  const current = { id: caseId, revision: 1, archived: false, frame: null, context: null, site_id: null };
  const lineage = reader.lineage ?? { issuer: null, originalUrl: null, acquiredAt: null,
    permissionReference: null, geography: null, limitations: [] };
  const marker = { version: reader.version, subject: binding.subject, accessSha256: binding.access,
    sha256: hash, bytes: 1, receivedAt: new Date().toISOString(), lineageState: 'caller_declared', lineage };
  if (reader.name === 'raster' || reader.name === 'point') delete (marker as any).accessSha256;
  const source = { id: sourceId, case_id: caseId, family_id: sourceId, revision: 1,
    profile: reader.profile, sha256: hash, bytes: 1, object_key: `sources/${sourceId}/${hash}`,
    inspection: { [reader.marker]: marker } };
  const state = { latest: 1, job: null as any };
  const client = { async query(sql: string) {
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes('FROM cases')) return { rows: [structuredClone(current)] };
    if (sql.includes('max(revision)')) return { rows: [{ revision: state.latest }] };
    if (sql.includes('FROM sources')) return { rows: [structuredClone(source)] };
    if (sql.includes('FROM jobs')) return { rows: [structuredClone(state.job)] };
    throw new Error(`Unexpected reader protocol SQL: ${sql}`);
  } } as unknown as PoolClient;
  return { caseId, sourceId, binding, current, source, state, client };
}

export function acceptedReaderJob(reader: ReaderControl, input: any) {
  const digest = fingerprint(input);
  const resultHash = fingerprint({ protocolResult: input.jobId });
  return { id: input.jobId, operation: reader.operation, case_id: input.caseId, source_id: input.sourceId,
    case_revision: input.caseRevision, payload: input, input_fingerprint: digest, input_sha256: digest,
    input_manifest_id: input.sourceId, scope: { kind: 'intake', workspaceId: input.caseId,
      version: input.caseRevision + 1 }, status: 'succeeded', logical_state: 'succeeded', error: null,
    result_ref: { assetId: reader.asset(input.jobId), version: 1, sha256: resultHash },
    accepted_fence: 1, attempt_state: 'accepted', attempt_fence: 1,
    attempt_input_sha256: digest, completion_sha256: resultHash };
}

export async function readerLifecycle(reader: ReaderControl) {
  const f = readerFixture(reader);
  const ctx = await reader.source(f.client, f.caseId, f.sourceId);
  const input = reader.input(ctx, randomUUID());
  f.state.job = acceptedReaderJob(reader, input);
  const enrolled = fingerprint(f.state.job);
  for (const phase of ['before_claim', 'heartbeat_or_execution', 'after_completion']) {
    f.current.revision++;
    await reader.check(f.client, input);
    const row = await reader.capture(f.client, f.caseId, f.sourceId, input.jobId);
    assert.equal(row.stale, false, phase);
    assert.equal(fingerprint(f.state.job), enrolled, phase);
  }
  f.state.latest = 2;
  await assert.rejects(() => reader.check(f.client, input), (e: any) => e.status === 409);
  assert.equal((await reader.capture(f.client, f.caseId, f.sourceId, input.jobId)).stale, true);
  f.state.latest = 1;
  f.current.archived = true;
  await assert.rejects(() => reader.check(f.client, input), (e: any) => e.status === 403);
  f.current.archived = false;
  f.current.context = { changed: true } as any;
  await assert.rejects(() => reader.check(f.client, input), (e: any) => e.status === 409);
  assert.equal((await reader.capture(f.client, f.caseId, f.sourceId, input.jobId)).stale, true);
  f.current.context = null;
  f.current.revision = 0;
  await assert.rejects(() => reader.check(f.client, input), (e: any) => e.status === 409);
}

export async function localReaderControl(run: () => Promise<void>) {
  const prior = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'k14-protocol-control';
  try { await run(); }
  finally {
    if (prior === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = prior;
  }
}
