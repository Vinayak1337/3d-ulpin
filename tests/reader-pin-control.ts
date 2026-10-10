import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mock } from 'node:test';
import type { PoolClient } from 'pg';
import { settings } from '../packages/server/src/infrastructure/config';
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

type Row = Record<string, any>;
const mappingState = { state: 'completed', next_publish_index: 1, sealed_chunks: 1, records: 0, accepted: 0,
  quarantined: 0, normalized: 0, unresolved: 0, duplicate_keys: 0, schema_drift_chunks: 0, proposal: null,
  issue_code: null, unknown_remainder: false };

/** One manual source in a case that later receives other files: SQL protocol, not a database. */
export class ManualCaseControl {
  readonly caseId = randomUUID();
  revision = 1;
  archived = false;
  others: Row[] = [];
  recipe: Row | undefined;
  jobs = new Map<string, Row>();

  constructor(readonly source: Row) {
    source.case_id = this.caseId;
  }

  get client() {
    return this as unknown as PoolClient;
  }

  get latest() {
    const family = [this.source, ...this.others].filter(row => row.family_id === this.source.family_id);
    return Math.max(...family.map(row => row.revision));
  }

  /** Another file arrives: a new family, or with `own` the next revision of this source's family. */
  receive(own = false) {
    const id = randomUUID();
    this.others.push({ id, case_id: this.caseId, family_id: own ? this.source.family_id : id,
      revision: own ? this.latest + 1 : 1, sha256: fingerprint({ protocol: id }) });
    this.revision++;
  }

  enroll(input: Row, operation: string) {
    this.jobs.set(input.jobId, { id: input.jobId, case_id: input.caseId, source_id: input.sourceId, operation,
      case_revision: input.caseRevision, payload: input, input_fingerprint: fingerprint(input) });
  }

  async query(sql: string, args: any[] = []) {
    const rows = this.write(sql, args) ?? this.read(sql, args);
    if (!rows) throw new Error(`Unexpected manual case SQL: ${sql}`);
    return { rows, rowCount: rows.length };
  }

  protected write(sql: string, args: any[]): Row[] | undefined {
    if (sql.startsWith('INSERT INTO jobs(')) {
      this.jobs.set(args[0], { id: args[0], case_id: args[1], source_id: args[2], operation: 'chunk-mapping',
        case_revision: args[3], input_fingerprint: args[4], payload: args[5] });
    } else if (sql.startsWith('INSERT INTO usp_mapping_recipes(')) this.recipe = structuredClone(args[5]);
    else if (sql.startsWith('UPDATE usp_mapping_recipes')) this.recipe = structuredClone(args[3]);
    else if (sql.startsWith('UPDATE usp_outbox_streams')) return [{ sequence: '1' }];
    else if (!/^(BEGIN|COMMIT|ROLLBACK|INSERT INTO|SELECT pg_advisory_xact_lock)/.test(sql)) return undefined;
    return [];
  }

  protected read(sql: string, args: any[]): Row[] | undefined {
    if (/FROM (registry_case_feature_mappings|import_packages|operations|usp_job_metadata|usp_chunk_mapping_slots)/
      .test(sql)) return [];
    if (sql.includes('count(*)')) return [{ n: 0 }];
    if (sql.includes('FROM cases')) return [{ id: this.caseId, revision: this.revision, archived: this.archived }];
    if (sql.includes('max(revision)')) return [{ revision: this.latest }];
    if (sql.startsWith('SELECT id,family_id,revision,sha256 FROM sources')) return this.summaries();
    if (sql.includes('FROM sources WHERE id=$1')) return this.all().filter(row => row.id === args[0]);
    if (sql.includes('FROM sources')) return [structuredClone(this.source)];
    if (sql.startsWith('SELECT id FROM jobs')) return this.rawJobs().slice(-1).map(job => ({ id: job.id }));
    if (sql.includes('FROM jobs')) return this.jobs.has(args[0]) ? [structuredClone(this.jobs.get(args[0]))] : [];
    if (sql.includes('FROM usp_mapping_recipes')) return this.recipe ? [{ body: structuredClone(this.recipe) }] : [];
    if (/FROM usp_(streaming_vector|chunk_mapping)_imports/.test(sql)) return [{ ...mappingState }];
    return undefined;
  }

  all() {
    return [this.source, ...this.others].map(row => structuredClone(row));
  }

  private summaries() {
    return this.all().map(({ id, family_id, revision, sha256 }) => ({ id, family_id, revision, sha256 }))
      .sort((left, right) => left.id < right.id ? -1 : 1);
  }

  private rawJobs() {
    return [...this.jobs.values()].filter(job => job.operation === 'streaming-vector');
  }
}

/** Route the service pool and private object reads to a protocol control for one test. */
export async function servicePoolControl(control: ManualCaseControl, bytes: Uint8Array, run: () => Promise<void>) {
  const globals = globalThis as any;
  const prior = globals.ulpinPool;
  globals.ulpinPool = { connect: async () => ({ query: control.query.bind(control), release() {} }),
    query: control.query.bind(control) };
  const require = createRequire(new URL('../packages/server/package.json', import.meta.url));
  const { S3Client } = require('@aws-sdk/client-s3');
  for (const name of ['s3Endpoint', 's3Region', 's3Bucket', 's3AccessKey', 's3SecretKey'] as const) {
    mock.getter(settings, name, () => name === 's3Endpoint' ? 'http://127.0.0.1:1' : 'k15-memory-control');
  }
  mock.method(S3Client.prototype, 'send', async () => ({ Body: { transformToByteArray: async () => bytes } }));
  try { await run(); }
  finally {
    if (prior === undefined) delete globals.ulpinPool;
    else globals.ulpinPool = prior;
    mock.restoreAll();
  }
}
