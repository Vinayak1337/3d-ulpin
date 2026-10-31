import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { PoolClient } from 'pg';
import { zipSync } from 'fflate';
import { crc32, gzipSync } from 'node:zlib';
import { settings } from '../packages/server/src/infrastructure/config';
import { attachTableTx } from '../packages/server/src/modules/usp/ingestion/service';
import { inspectTabularSource } from '../packages/server/src/modules/usp/ingestion/tabular-source';
import { ArchiveMemberLineageSchema, INTAKE_PROBE_LIMITS, ZIP_LAYER_LIMITS, type IntakeCard }
  from '../packages/contracts/src/usp/intake';
import { LARGE_ORIGINAL_LIMITS, LargeUploadCreateSchema } from '../packages/contracts/src/usp/ingestion';
import { probeOriginal } from '../packages/server/src/modules/usp/ingestion/intake-probe';
import { intakeReaderRoute } from '../packages/server/src/modules/usp/ingestion/intake-draft';
import { locateZipMember, readZipMember, streamZipMember }
  from '../packages/server/src/modules/usp/ingestion/intake-zip';
import { IntakeArchiveService, queueZipLayersTx, receiveLargeLayer, retainZipMemberOriginal, ZIP_ARCHIVE_PROFILE,
  ZIP_RECEIPT_WAIT_MS }
  from '../packages/server/src/modules/usp/ingestion/intake-zip-layers';
import { runIntakeZipLayersJob } from '../packages/server/src/modules/usp/ingestion/intake-zip-layers-worker';
import { listedIntakeRows } from '../packages/server/src/modules/usp/ingestion/intake-ledger';
import { AppError } from '../packages/server/src/infrastructure/errors';
import { geojsonInventory } from '../packages/server/src/modules/usp/ingestion/registry';

const { S3Client } = createRequire(new URL('../packages/server/package.json', import.meta.url))('@aws-sdk/client-s3');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
// Real public layers kept in the repository (OSM / Google Open Buildings, test_only); zipped here, never committed.
const real = {
  'uttam/01-google-building-footprints.geojson': readFileSync('fixtures/google-uttam/01-google-building-footprints.geojson'),
  'uttam/02-osm-road-centrelines.geojson': readFileSync('fixtures/google-uttam/02-osm-road-centrelines.geojson'),
  'uttam/block-boundary.geojson': readFileSync('fixtures/google-uttam/block-boundary.geojson'),
  'uttam/README.md': readFileSync('fixtures/google-uttam/README.md'),
};
const reader = (bytes: Uint8Array) => async (start: number, end: number) => bytes.subarray(start, end);

test('a GeoJSON member is read back whole, deflated or stored, and checked against its directory entry', async () => {
  for (const level of [0, 6] as const) {
    const pack = zipSync(Object.fromEntries(Object.entries(real).map(([name, bytes]) => [name, [bytes, { level }]])));
    for (const [ordinal, name] of Object.keys(real).entries()) {
      const member = await readZipMember(reader(pack), pack.length, name, 16 * 1024 * 1024);
      assert.equal(sha(member.bytes), sha(real[name as keyof typeof real]));
      assert.equal(member.ordinal, ordinal);
    }
  }
});

test('a member that is missing, too large or damaged is refused by code', async () => {
  const pack = zipSync({ 'a.geojson': real['uttam/block-boundary.geojson'] });
  const size = real['uttam/block-boundary.geojson'].length;
  const refused = (path: string, max: number, bytes = pack) =>
    readZipMember(reader(bytes), bytes.length, path, max).then(() => 'read', (error: Error) => error.message);
  assert.equal(await refused('b.geojson', size), 'ZIP_MEMBER_NOT_FOUND');
  assert.equal(await refused('a.geojson', size - 1), 'ZIP_LAYER_SIZE');
  const damaged = Buffer.from(pack);
  damaged[60] ^= 0xff; // inside the first member's compressed bytes, past its 30 + 9 byte local header
  assert.match(await refused('a.geojson', size, damaged), /^ZIP_MEMBER_INTEGRITY$/);
});

// In-memory ledger for the job's own statements and the job authority's; no database, object store, processor or
// runtime is opened.
class Ledger {
  readonly caseId = randomUUID();
  readonly archiveId = randomUUID();
  readonly itemId = randomUUID();
  revision = 7;
  readonly rows = new Map<string, any>();
  readonly events: unknown[] = [];
  readonly jobs: any[] = [];
  readonly metadata = new Map<string, any>();
  readonly attempts: any[] = [];
  /** ZL2. The lineage each retain or finalize wrote with its source, keyed by the source it created. */
  readonly inspections = new Map<string, unknown>();
  readonly ancestors = new Map<string, any>();
  /** Rows the map route kept before its reader refused them: lineage written, no manual profile. */
  readonly partial = new Set<string>();
  /** ZL2. The member item whose next link fails once, as a stop between the retain and the link would. */
  linkFault: string | null = null;
  archive: any;

  constructor(readonly bytes: Uint8Array, readonly card: IntakeCard) {
    this.archive = { id: this.archiveId, case_id: this.caseId, family_id: this.archiveId, revision: 1,
      name: 'layers.zip', profile: ZIP_ARCHIVE_PROFILE, bytes: bytes.length, sha256: sha(bytes),
      object_key: `sources/${this.archiveId}/${sha(bytes)}`, status: 'needs_input', created_at: new Date(),
      inspection: { actor: 'zip-layer-control' } };
    // The archive's own item as ZF2 settles it: read, undecided, its words its reason.
    this.rows.set(this.itemId, { item_id: this.itemId, case_id: this.caseId, source_id: this.archiveId,
      parent_item_id: null, member_path: null, card, state: 'read', placement: 'undecided', plan_ref: null,
      records_seen: '0', limit_reason: 'The ZIP words.', family: 'archive', format: 'zip', size_class: 'S', wave: 4,
      pinned_by_officer: false });
    // The rows registration writes for each member (intake-service childrenTx).
    for (const member of card.members) {
      const id = randomUUID();
      this.rows.set(id, { item_id: id, case_id: this.caseId, source_id: null, parent_item_id: this.itemId,
        member_path: member.name, size_bytes: String(member.sizeBytes), limit_reason: member.refusalCode,
        card: member.card ? { ...member.card, members: [] } : null, state: 'probed', family: member.family,
        format: member.format, size_class: 'S', wave: 4, pinned_by_officer: false });
    }
  }

  member(path: string) { return [...this.rows.values()].find(row => row.member_path === path); }
  job(id: string) { return this.jobs.find(job => job.id === id); }

  async query(sql: string, values: any[] = []): Promise<{ rows: any[]; rowCount?: number }> {
    const rows = this.jobQuery(sql, values) ?? this.itemQuery(sql, values);
    if (!rows) throw new Error(`Unexpected ledger SQL: ${sql}`);
    return 'rows' in rows ? rows : { rows, rowCount: rows.length };
  }

  private jobQuery(sql: string, values: any[]): any[] | null {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('SELECT pg_advisory')) return [];
    if (sql.startsWith('SELECT id FROM cases')) return [{ id: this.caseId }];
    if (sql.startsWith('SELECT max(revision)')) return [{ revision: this.archive.revision }];
    if (sql.startsWith('SELECT status FROM jobs WHERE source_id')) {
      return this.jobs.filter(job => job.source_id === values[0]);
    }
    if (sql.startsWith('SELECT * FROM jobs') || sql.startsWith('SELECT status FROM jobs')
      || sql.startsWith('SELECT operation FROM jobs')) {
      return this.jobs.filter(job => job.id === values[0]);
    }
    if (sql.startsWith('INSERT INTO jobs')) {
      this.jobs.push({ id: values[0], case_id: values[1], source_id: values[2], operation: 'intake-zip-layers',
        status: 'queued', case_revision: values[3], input_fingerprint: values[4], payload: values[5] });
      return [];
    }
    if (sql.startsWith('UPDATE jobs SET status=$2')) {
      Object.assign(this.job(values[0]), { status: values[1], error: values[2] });
      return [];
    }
    if (sql.startsWith('UPDATE jobs SET status=')) {
      if (sql.includes('next_attempt_at=COALESCE')) this.job(values[0]).next_attempt_at = values[1];
      if (sql.includes('attempts=$2')) this.job(values[0]).attempts = values[1];
      this.job(values[0]).status = /status='(\w+)'/.exec(sql)![1];
      return [];
    }
    if (sql.startsWith('INSERT INTO usp_job_metadata')) {
      this.metadata.set(values[0], { job_id: values[0], input_manifest_id: values[1], input_sha256: values[2],
        scope: values[3], logical_state: 'queued', version: 1 });
      return [];
    }
    if (sql.includes('FROM usp_job_metadata')) return this.metadata.has(values[0]) ? [this.metadata.get(values[0])] : [];
    if (sql.startsWith('UPDATE usp_job_metadata')) {
      this.metadata.get(values[0]).logical_state = /logical_state='(\w+)'/.exec(sql)![1];
      return [];
    }
    const attempts = this.attempts.filter(attempt => attempt.job_id === values[0]);
    const latest = attempts.at(-1);
    if (sql.startsWith('SELECT count(*)::int n FROM usp_job_attempts')) {
      return [{ n: attempts.filter(attempt => attempt.state !== 'yielded').length }];
    }
    if (sql.startsWith('SELECT * FROM usp_job_attempts')) return latest ? [latest] : [];
    if (sql.startsWith('SELECT 1 FROM usp_job_attempts')) {
      return attempts.filter(attempt => attempt.state === 'active' && attempt.lease_until > new Date());
    }
    if (sql.startsWith('INSERT INTO usp_job_attempts')) {
      const lease_until = new Date(Date.now() + 180_000);
      this.attempts.push({ job_id: values[0], number: values[1], fence: values[2], owner: values[3],
        input_sha256: values[4], state: 'active', lease_until });
      return [{ lease_until }];
    }
    if (sql.startsWith('UPDATE usp_job_attempts SET lease_until')) {
      return latest?.state === 'active' && latest.fence === values[2] ? [{ lease_until: latest.lease_until }] : [];
    }
    if (sql.startsWith('UPDATE usp_job_attempts SET failure_cause=')) {
      attempts.find(attempt => attempt.number === values[1]).failure_cause = values[2];
      return [];
    }
    if (sql.startsWith('UPDATE usp_job_attempts SET state=')) {
      latest.state = /state='(\w+)'/.exec(sql)![1];
      return [];
    }
    return null;
  }

  private itemQuery(sql: string, values: any[]): any[] | { rows: any[]; rowCount: number } | null {
    if (sql.startsWith('SELECT id,revision,archived FROM cases')) {
      return [{ id: this.caseId, revision: this.revision, archived: false }];
    }
    if (sql.startsWith('SELECT revision FROM cases')) return [{ revision: this.revision }];
    if (sql.startsWith('SELECT * FROM sources')) {
      const source = values[1] === this.archiveId ? this.archive : this.ancestors.get(values[1]);
      return source ? [source] : [];
    }
    if (sql.startsWith(`SELECT id FROM sources WHERE case_id=$1 AND inspection->'archiveMember' @>`)) {
      return [...this.inspections].filter(([id, lineage]) => Object.entries(values[1])
        .every(([key, value]) => (lineage as Record<string, unknown>)[key] === value)
        && !(this.partial.has(id) && sql.includes("inspection ? 'manualProfile'"))).map(([id]) => ({ id }));
    }
    if (sql.startsWith('SELECT * FROM usp_intake_items WHERE source_id')) {
      return [...this.rows.values()].filter(row => row.source_id === values[0] && !row.parent_item_id);
    }
    if (/^SELECT (?:\*|card) FROM usp_intake_items/.test(sql)) {
      const row = this.rows.get(values[1]);
      return row && !row.parent_item_id ? [row] : [];
    }
    if (sql.startsWith('INSERT INTO usp_intake_items(')) {
      if ([...this.rows.values()].some(row => row.parent_item_id === values[2]
        && row.member_path === values[3])) return [];
      this.rows.set(values[0], { item_id: values[0], case_id: values[1], parent_item_id: values[2],
        member_path: values[3], size_bytes: null, size_class: null, card: null, source_id: null, limit_reason: null,
        state: 'probed', family: 'unknown', format: 'unknown', wave: 4, pinned_by_officer: false });
      return [{ item_id: values[0] }];
    }
    if (sql.startsWith('SELECT item_id,member_path')) {
      return [...this.rows.values()].filter(row => row.parent_item_id === values[1]);
    }
    if (sql.startsWith('SELECT item_id AS')) {
      const row = this.rows.get(values[1]);
      return [{ itemId: row.item_id, state: row.state, family: row.family, format: row.format,
        sizeClass: row.size_class, wave: row.wave, pinnedByOfficer: row.pinned_by_officer }];
    }
    if (sql.startsWith('SELECT state,placement,plan_ref')) return [this.rows.get(values[1])];
    if (sql.startsWith('UPDATE usp_intake_items SET state=$3')) {
      Object.assign(this.rows.get(values[1]), { state: values[2], placement: values[3], plan_ref: values[4],
        records_seen: String(values[5]), limit_reason: values[6] });
      return [];
    }
    if (sql.startsWith('UPDATE usp_intake_items SET source_id')) {
      if (values[1] === this.linkFault) {
        this.linkFault = null;
        throw new Error('ZIP_LAYER_UNAVAILABLE');
      }
      const row = this.rows.get(values[1]);
      if (row.source_id) return { rows: [], rowCount: 0 };
      Object.assign(row, { source_id: values[2], limit_reason: null });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE usp_intake_items SET limit_reason')) {
      const row = this.rows.get(values[1]);
      const next = sql.includes('limit_reason=NULL') ? null : values[2];
      if ((sql.includes('source_id IS NULL') && row.source_id) || row.limit_reason === next) {
        return { rows: [], rowCount: 0 };
      }
      row.limit_reason = next;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE usp_outbox_streams')) return [{ sequence: String(this.events.length + 1) }];
    if (sql.startsWith('INSERT INTO usp_outbox(')) { this.events.push(values[2]); return []; }
    if (sql.includes('usp_outbox')) return [];
    return null;
  }
}

type LayerOptions = {
  name?: string;
  failRetain?: (name: string) => AppError | null;
  /** The map route's own reader check, run after it keeps the original, as the /sources retain does today. */
  mapRoute?: (bytes: Uint8Array) => unknown;
};

async function layersJob(pack: Uint8Array, options: LayerOptions = {}) {
  const card = await probeOriginal(reader(pack), pack.length, options.name ?? 'layers.zip');
  const ledger = new Ledger(pack, card);
  ledger.archive.name = options.name ?? 'layers.zip';
  const client = { query: ledger.query.bind(ledger) } as unknown as PoolClient;
  const order: string[] = [];
  const retained: { name: string; bytes: Uint8Array; lineage: unknown; input: any;
    sourceId: string; profile: string }[] = [];
  const keep = (file: { name: string; bytes: Uint8Array }, input: any, lineage: unknown, profile: string) => {
    const refusal = options.failRetain?.(file.name);
    if (refusal) throw refusal;
    order.push(`retain:${file.name}`);
    const sourceId = randomUUID();
    retained.push({ ...file, lineage, input, sourceId, profile });
    ledger.inspections.set(sourceId, lineage);
    ledger.revision++;
    return sourceId;
  };
  const mapRoute = (bytes: Uint8Array, lineage: unknown) => {
    try { options.mapRoute?.(bytes); }
    catch (error) {
      const partial = randomUUID();
      ledger.inspections.set(partial, lineage);
      ledger.partial.add(partial);
      ledger.revision++;
      throw error;
    }
  };
  const dependencies = {
    read: async (_key: string, start: number, end: number) => pack.subarray(start, end),
    retain: async (_caseId: string, input: any, file: { name: string; bytes: Uint8Array }, lineage: unknown) => {
      mapRoute(file.bytes, lineage);
      return { source: { sourceId: keep(file, input, lineage, 'geojson-manual-v1') } };
    },
    retainMember: async (_caseId: string, revision: number, file: { name: string; bytes: Uint8Array },
      lineage: unknown) => keep(file, { format: 'original', expectedWorkspaceRevision: revision },
      lineage, 'large-original-v1'),
    register: async (_caseId: string, input: any) => { order.push(`register:${input.sourceId}`); return {}; },
  };
  // What the enrol request now does: queue the job in the transaction that publishes the probe card.
  const queue = () => queueZipLayersTx(client, ledger.archive, card, ledger.itemId);
  // What the dispatcher does: run the job; its own transactions reach the ledger through the shared pool.
  const run = async (jobId: string, overrides: Record<string, unknown> = {}) => {
    const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
    const previous = globals.ulpinPool;
    globals.ulpinPool = { query: client.query, connect: async () => ({ query: client.query, release: () => {} }) };
    try { await runIntakeZipLayersJob(jobId, { ...dependencies, ...overrides } as never); }
    finally {
      if (previous === undefined) delete globals.ulpinPool;
      else globals.ulpinPool = previous;
    }
  };
  return { ledger, card, order, retained, queue, run };
}

async function configured(action: () => Promise<void>) {
  const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'zip-layer-control';
  try { await action(); }
  finally {
    if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
  }
}

for (const change of ['sibling table read', 'future revision', 'access before transaction', 'access before store']) {
  test(`archive retention after ${change} keeps its revision and access fences`, t => configured(async () => {
    const bytes = zipSync(real);
    const ledger = new Ledger(bytes, await probeOriginal(reader(bytes), bytes.length, 'layers.zip'));
    const register = readFileSync('E:/BhuAayam-data/datasets/nyc-10013-linked/'
      + 'nyc-landmarks-preservation-commission/gpmc-yuvp.csv');
    const table = { ...ledger.archive, id: randomUUID(), family_id: randomUUID(), profile: 'large-original-v1',
      name: 'gpmc-yuvp.csv', bytes: register.length, sha256: sha(register),
      inspection: { largeOriginal: { operatorSubject: 'zip-layer-control' } } };
    const sources = [table], operations = new Map<string, any>(), stored: Uint8Array[] = [];
    const query = async (sql: string, values: any[] = []): Promise<any> => {
      if (sql.startsWith('SELECT id,revision FROM cases')) return { rows: [{ revision: ledger.revision }] };
      if (sql.includes('FROM registry_case_feature_mappings') || sql.includes('FROM import_packages')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM operations')) {
        return { rows: operations.has(values[1]) ? [operations.get(values[1])] : [] };
      }
      if (sql.startsWith('INSERT INTO operations')) {
        operations.set(values[1], { payload_hash: values[2], result: values[3] });
        return { rows: [] };
      }
      if (sql.startsWith('SELECT id,family_id,revision,sha256 FROM sources')) return { rows: sources };
      if (sql.startsWith('SELECT * FROM sources') || sql.startsWith('SELECT id FROM sources')) {
        if (sql.includes('sha256=$2')) {
          if (change === 'access before store') process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'changed-zip-context';
          return { rows: sources.filter(row => row.sha256 === values[1] && row.profile === values[2]) };
        }
        return { rows: sources.filter(row => row.id === values[sql.includes('WHERE case_id=') ? 1 : 0]) };
      }
      if (sql.startsWith('INSERT INTO sources')) {
        sources.push({ id: values[0], case_id: values[1], family_id: values[0], revision: 1,
          name: values[2], profile: values[3], bytes: values[4], sha256: values[5], object_key: values[6],
          status: 'needs_input', inspection: values[7] });
        return { rows: [] };
      }
      if (sql.startsWith('UPDATE sources SET inspection=')) {
        Object.assign(table.inspection, JSON.parse(values[1]));
        return { rows: [] };
      }
      if (sql.startsWith('UPDATE cases SET revision=')) {
        ledger.revision++;
        return { rows: [] };
      }
      return ledger.query(sql, values);
    };
    for (const name of ['s3Endpoint', 's3Region', 's3Bucket', 's3AccessKey', 's3SecretKey'] as const) {
      t.mock.getter(settings, name, () => 'zip-retain-test-only');
    }
    t.mock.method(S3Client.prototype, 'send', async (command: any) => {
      if (command.constructor.name === 'GetObjectCommand') {
        return { Body: { transformToByteArray: async () => stored.at(-1) } };
      }
      assert.equal(command.constructor.name, 'PutObjectCommand');
      stored.push(command.input.Body);
      return {};
    });
    const globals = globalThis as typeof globalThis & { ulpinPool?: unknown }, previous = globals.ulpinPool;
    globals.ulpinPool = { query, connect: async () => {
      if (change === 'access before transaction') process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'changed-zip-context';
      return { query, release: () => {} };
    } };
    try {
      const dropRevision = ledger.revision;
      if (change === 'sibling table read') {
        await attachTableTx({ query } as unknown as PoolClient, { caseId: ledger.caseId, sourceId: table.id,
          actor: 'zip-layer-control', expectedWorkspaceRevision: null, read: table },
        inspectTabularSource(register, { format: 'csv', sheet: 'csv', table: null, headerRows: [1] }));
        assert.equal(ledger.revision, dropRevision + 1);
      }
      const retain = (requestKey: string) => new IntakeArchiveService().retain(ledger.caseId,
        { requestKey, expectedWorkspaceRevision: dropRevision + (change === 'future revision' ? 1 : 0) },
        { name: 'layers.zip', bytes });
      if (change === 'sibling table read') {
        const requestKey = randomUUID(), receipt = await retain(requestKey);
        assert.deepEqual(await retain(requestKey), receipt);
        assert.deepEqual(await retain(randomUUID()), receipt);
        assert.equal(receipt.sha256, sha(bytes));
        assert.equal(sha(stored[0]), sha(bytes));
        assert.deepEqual([stored.length, sources.length, ledger.revision], [1, 2, dropRevision + 2]);
      } else {
        await assert.rejects(retain(randomUUID()),
          { code: change === 'future revision' ? 'STALE_REVISION' : 'INGESTION_ACCESS_CHANGED' });
        assert.deepEqual([stored.length, sources.length, operations.size, ledger.revision], [0, 1, 0, dropRevision]);
      }
    } finally { globals.ulpinPool = previous; }
  }));
}

for (const [label, original] of Object.entries({ public: real['uttam/block-boundary.geojson'],
  synthetic: Buffer.from('{"type":"FeatureCollection","features":[]}') })) {
  test(`gzip ${label} queues one member job, retains lineage and enrols its byte-probed GeoJSON`, () =>
    configured(async () => {
      const pack = gzipSync(original);
      const fixture = await layersJob(pack, { name: 'boundary.geojson.gz' });
      const { ledger } = fixture;
      const { service, log } = receipts(ledger);
      const chunks: Uint8Array[] = [];
      const receive = service.receivePart;
      service.receivePart = async (claim, bytes) => { chunks.push(bytes); return receive(claim, bytes); };
      const cards: IntakeCard[] = [];
      const jobId = await fixture.queue();
      assert.ok(jobId, 'a gzip item queues the existing member job');
      assert.equal(await fixture.queue(), null, 'only one queued job');
      assert.equal(log.created.length, 0, 'no extraction in the request');
      await fixture.run(jobId, { large: service, register: async () => {
        const bytes = Buffer.concat(chunks);
        cards.push(await probeOriginal(reader(bytes), bytes.length, log.created[0].filename));
        return {};
      } });
      assert.equal(ledger.job(jobId).status, 'succeeded');
      assert.equal(log.created[0].filename, 'boundary.geojson');
      assert.equal(log.created[0].profile, undefined, 'a small gzip member keeps v1');
      assert.equal(log.hash.digest('hex'), sha(original));
      assert.equal(cards[0].format, 'geojson');
      assert.deepEqual(log.batches, [ledger.archiveId]);
      const member = ledger.member('boundary.geojson');
      assert.equal(member.parent_item_id, ledger.itemId);
      assert.equal(member.source_id, log.sourceId);
      const lineage = ArchiveMemberLineageSchema.parse(ledger.inspections.get(log.sourceId));
      assert.deepEqual([lineage.parentItemId, lineage.parentSourceId, lineage.parentSha256,
        lineage.memberPath, lineage.memberSha256, lineage.memberBytes, lineage.compressedBytes],
      [ledger.itemId, ledger.archiveId, sha(pack), 'boundary.geojson', sha(original), original.length, pack.length]);
      assert.equal(sha(ledger.bytes), sha(pack), 'the gzip original is unchanged');
      assert.equal(ledger.rows.get(ledger.itemId).limit_reason,
        'Compressed (gzip): 1 file taken out as its own item: boundary.geojson.');
      assert.equal(await fixture.queue(), null, 're-enrolment retains no duplicate');
    }));
}

for (const fault of ['ratio', 'corrupt', 'empty'] as const) {
  test(`gzip ${fault} keeps the original with failure words and makes no derived original`, () =>
    configured(async () => {
      const original = fault === 'corrupt' ? real['uttam/block-boundary.geojson'] : Buffer.alloc(0);
      const pack = gzipSync(fault === 'ratio' ? Buffer.alloc(100_000) : original);
      if (fault === 'corrupt') pack[pack.length - 8] ^= 0xff;
      const fixture = await layersJob(pack, { name: 'member.gzip' });
      const { service, log } = receipts(fixture.ledger);
      const jobId = await fixture.queue();
      assert.ok(jobId);
      await fixture.run(jobId, { large: service });
      assert.equal(log.created.length, 0);
      const words = fixture.ledger.rows.get(fixture.ledger.itemId).limit_reason;
      if (fault === 'ratio') {
        assert.match(words, /GZIP_RATIO_LIMIT.*100.*compressed.*bytes/);
        assert.match(words, new RegExp(String(pack.length)));
      } else assert.match(words, fault === 'corrupt' ? /GZIP_MEMBER_INTEGRITY/ : /GZIP_EMPTY_MEMBER/);
      assert.match(words, /Compressed \(gzip\):.*kept/);
      assert.equal(await fixture.queue(), null, 'a final byte refusal is not retried');
      assert.equal(sha(fixture.ledger.bytes), sha(pack));
    }));
}

test('concatenated gzip streams become one NDJSON original, despite its misleading csv suffix', () =>
  configured(async () => {
    const feature = Buffer.from('{"type":"Feature","properties":{},"geometry":null}\n');
    const pack = Buffer.concat([gzipSync(feature), gzipSync(feature)]);
    const fixture = await layersJob(pack, { name: 'features.geojsonl.csv.GZIP' });
    const { service, log } = receipts(fixture.ledger);
    const chunks: Uint8Array[] = [];
    service.receivePart = async (claim, bytes) => {
      chunks.push(bytes);
      log.hash.update(bytes);
      return { id: randomUUID(), revision: claim.expectedRevision + 1,
        currentCaseRevision: fixture.ledger.revision };
    };
    let card: IntakeCard | undefined;
    await fixture.run((await fixture.queue())!, { large: service, register: async () => {
      const bytes = Buffer.concat(chunks);
      card = await probeOriginal(reader(bytes), bytes.length, log.created[0].filename);
      return {};
    } });
    assert.equal(log.hash.digest('hex'), sha(Buffer.concat([feature, feature])));
    assert.equal(log.created[0].filename, 'features.geojsonl.csv');
    assert.equal(card?.format, 'ndjson');
    assert.equal(card?.family, 'vector');
    assert.equal(intakeReaderRoute(card!, { bytes: feature.length * 2, inspection: {} }), 'streamed_geojson');
    assert.equal(log.created.length, 1);
  }));

test('gzip recovers a retained but unlinked child through its lineage without reading or copying again', () =>
  configured(async () => {
    const pack = gzipSync(real['uttam/block-boundary.geojson']);
    const fixture = await layersJob(pack, { name: 'boundary.geojson.gz' });
    const { ledger } = fixture;
    const { service, log } = receipts(ledger);
    const jobId = (await fixture.queue())!;
    ledger.linkFault = ledger.member('boundary.geojson').item_id;
    await fixture.run(jobId, { large: service });
    assert.equal(log.created.length, 1);
    assert.equal(ledger.member('boundary.geojson').source_id, null);
    let reads = 0;
    await fixture.run((await fixture.queue())!, { large: service, read: async () => {
      reads++;
      throw new Error('must not read the gzip again');
    } });
    assert.equal(log.created.length, 1);
    assert.equal(reads, 0);
    assert.equal(ledger.member('boundary.geojson').source_id, log.sourceId);
    assert.deepEqual(fixture.order, [`register:${log.sourceId}`]);
    assert.equal(await fixture.queue(), null);
  }));

test('a non-gzip file named .gz queues no member job and makes no child', async () => {
  const fixture = await layersJob(Buffer.from('not compressed'), { name: 'plain.gz' });
  assert.notEqual(fixture.card.format, 'gzip');
  assert.equal(await fixture.queue(), null);
  assert.equal(fixture.ledger.rows.size, 1);
});

const paths = 'uttam/01-google-building-footprints.geojson, uttam/02-osm-road-centrelines.geojson, '
  + 'uttam/block-boundary.geojson, uttam/README.md.';
const stopped = (code: string) => `4 members. Taking the members out of this ZIP stopped (${code}); `
  + `enrol the ZIP again to retry. 4 files waiting to be taken out as their own items: ${paths}`;
const layerWords = (being: string) => being
  ? `4 members. 4 files being taken out as their own items: ${paths}`
  : `4 members. 3 GeoJSON layers, 1 unknown file taken out as their own items: ${paths} `
    + '1 file kept, not read: uttam/README.md (own item; no batch reader).';

test('the job keeps and enrols every independent member, including a README with no reader', () =>
  configured(async () => {
    const pack = zipSync(real);
    const { ledger, order, retained, queue, run } = await layersJob(pack);
    const jobId = (await queue())!;
    assert.equal(retained.length, 0);
    assert.equal(ledger.rows.get(ledger.itemId).limit_reason, layerWords(' being'));
    await run(jobId);
    assert.equal(ledger.job(jobId).status, 'succeeded');
    assert.equal(ledger.rows.get(ledger.itemId).limit_reason, layerWords(''));
    const kept = retained.map(file => file.sourceId);
    assert.deepEqual(retained.map(file => file.name), Object.keys(real).map(path => path.split('/').pop()));
    for (const [ordinal, file] of retained.entries()) {
      const path = (file.lineage as { memberPath: string }).memberPath;
      assert.equal(sha(file.bytes), sha(real[path as keyof typeof real]));
      const lineage = ArchiveMemberLineageSchema.parse(file.lineage);
      assert.deepEqual({ ...lineage, crc32: 0 }, { version: 'zip-layer/1', parentSourceId: ledger.archiveId,
        parentSourceRevision: 1, parentSha256: sha(pack), parentItemId: ledger.itemId, memberPath: path, ordinal,
        memberBytes: file.bytes.length, compressedBytes: lineage.compressedBytes, crc32: 0,
        memberSha256: sha(file.bytes) });
      assert.equal(file.input.format, path.endsWith('.geojson') ? 'geojson' : 'original');
      assert.equal(ledger.member(path).source_id, kept[ordinal]);
    }
    assert.equal(ledger.member('uttam/README.md').source_id, kept[3]);
    // Every layer is kept before any is enrolled, so no layer's draft associates the case first.
    assert.deepEqual(order.map(step => step.split(':')[0]), ['retain', 'retain', 'retain', 'retain',
      'register', 'register', 'register', 'register']);
    // Every layer kept and enrolled: enrolling the archive again queues nothing.
    assert.equal(await queue(), null);
    // A failed enrolment is retried by a fresh job, which keeps nothing twice and enrols the same originals again.
    ledger.member('uttam/block-boundary.geojson').limit_reason = 'ZIP_LAYER_UNAVAILABLE: kept but not enrolled.';
    order.length = 0;
    const retry = (await queue())!;
    assert.notEqual(retry, jobId);
    await run(retry);
    assert.deepEqual(order, kept.map(id => `register:${id}`));
    assert.equal(retained.length, kept.length, 'retry retains no second member original');
    assert.equal(ledger.rows.size, ledger.card.members.length + 1, 'retry adds no second member item');
    assert.equal(ledger.member('uttam/block-boundary.geojson').limit_reason, null);
    assert.equal(await queue(), null);
  }));

test('a small Point GeoJSON keeps the manual route while PDF and CSV use the byte receipt', () =>
  configured(async () => {
    // Protocol-only geometry, not an operational location or a proposed registry record.
    const point = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature',
      properties: {}, geometry: { type: 'Point', coordinates: [1, 2] } }] }));
    const files = { 'map/point.geojson': point, 'docs/plan.pdf': Buffer.from('%PDF-1.4\n%%EOF'),
      'tables/register.csv': Buffer.from('key,value\na,b\n') };
    const fixture = await layersJob(zipSync(files));
    assert.deepEqual(fixture.card.members[0].card?.geometryTypes, ['Point']);
    await fixture.run((await fixture.queue())!);
    const [map, pdf, csv] = fixture.retained;
    assert.deepEqual([map.profile, pdf.profile, csv.profile],
      ['geojson-manual-v1', 'large-original-v1', 'large-original-v1']);
    assert.equal(map.input.format, 'geojson');
    assert.equal(map.input.expectedWorkspaceRevision, 7);
    assert.match(map.input.requestKey, /^[a-f0-9-]{36}$/);
    assert.deepEqual([pdf.input.format, csv.input.format], ['original', 'original']);
    for (const file of fixture.retained) {
      const path = (file.lineage as { memberPath: keyof typeof files }).memberPath;
      assert.equal(sha(file.bytes), sha(files[path]));
      assert.equal(fixture.ledger.member(path).source_id, file.sourceId);
      assert.ok(fixture.order.includes(`register:${file.sourceId}`));
    }
    assert.equal(await fixture.queue(), null);
  }));

test('a member whose retain fails stays in the archive with a code; its siblings are kept', () =>
  configured(async () => {
    const { ledger, retained, queue, run } = await layersJob(zipSync(real), { failRetain: name =>
      name.startsWith('02-') ? new AppError(422, 'GEOJSON_INVALID', 'parser text that must not be stored') : null });
    const jobId = (await queue())!;
    await run(jobId);
    assert.equal(retained.length, 3);
    const refused = ledger.member('uttam/02-osm-road-centrelines.geojson');
    assert.equal(refused.source_id, null);
    assert.match(refused.limit_reason, /^GEOJSON_INVALID: this member stays inside the archive/);
    assert.doesNotMatch(refused.limit_reason, /parser text/);
    // The job itself succeeded; the refused layer still waits, so enrolling again queues the retry ZF1 promised.
    assert.equal(ledger.job(jobId).status, 'succeeded');
    assert.notEqual(await queue(), null);
  }));

test('layers held back by the layer limit or size queue no retry', () => configured(async () => {
  const { ledger, queue, run } = await layersJob(zipSync(real));
  await run((await queue())!);
  Object.assign(ledger.member('uttam/01-google-building-footprints.geojson'),
    { source_id: null, limit_reason: 'ZIP_LAYER_SIZE: kept inside the archive.' });
  Object.assign(ledger.member('uttam/block-boundary.geojson'),
    { source_id: null, limit_reason: 'ZIP_LAYER_LIMIT: kept inside the archive.' });
  assert.equal(await queue(), null);
}));

test('an empty member stays final while its real sibling is kept, without a quota wait', () =>
  configured(async () => {
    const fixture = await layersJob(zipSync({ 'empty.csv': new Uint8Array(),
      'uttam/README.md': real['uttam/README.md'] }));
    const jobId = (await fixture.queue())!;
    await fixture.run(jobId);
    assert.equal(fixture.ledger.member('empty.csv').limit_reason,
      'ZIP_EMPTY_MEMBER: this empty file is kept inside the archive; '
      + 'the original receipt accepts nonempty members only.');
    assert.equal(fixture.ledger.job(jobId).status, 'succeeded');
    assert.equal(fixture.retained.length, 1);
    assert.equal(await fixture.queue(), null);
  }));

test('the mixed Lake View fixture retains and enrols its PDFs, tables and unsupported models', () =>
  configured(async () => {
    const pack = readFileSync('fixtures/lake-view-complete-inputs.zip');
    const { card, ledger, retained, order, queue, run } = await layersJob(pack);
    assert.ok(card.members.length > 30);
    await run((await queue())!);
    assert.equal(retained.length, card.members.filter(member => !member.refusalCode && member.sizeBytes).length);
    assert.equal(order.filter(step => step.startsWith('register:')).length, retained.length);
    assert.ok(retained.some(file => file.name.endsWith('.pdf')));
    assert.match(ledger.rows.get(ledger.itemId).limit_reason, /PDFs.*taken out as their own items/);
    assert.match(ledger.rows.get(ledger.itemId).limit_reason, /kept, not read/);
    assert.equal(await queue(), null);
  }));

test('a changed archive source makes the claim refuse; the job ends stale with the code in the ZIP\'s words', () =>
  configured(async () => {
    const { ledger, retained, queue, run } = await layersJob(zipSync(real));
    const jobId = (await queue())!;
    ledger.archive.sha256 = 'b'.repeat(64);
    await run(jobId);
    assert.equal(retained.length, 0);
    assert.equal(ledger.attempts.length, 0);
    assert.deepEqual([ledger.job(jobId).status, ledger.job(jobId).error], ['stale', 'STALE_REVISION']);
    assert.equal(ledger.rows.get(ledger.itemId).limit_reason, stopped('STALE_REVISION'));
  }));

test('an active attempt prevents another claim from touching members', () =>
  configured(async () => {
    const fixture = await layersJob(zipSync(real));
    const jobId = (await fixture.queue())!;
    fixture.ledger.job(jobId).status = 'running';
    fixture.ledger.attempts.push({ job_id: jobId, state: 'active', lease_until: new Date(Date.now() + 180_000) });
    await fixture.run(jobId);
    assert.equal(fixture.retained.length, 0);
    assert.equal(fixture.ledger.attempts.length, 1);
    assert.equal(fixture.ledger.job(jobId).status, 'running');
  }));

test('a job that fails as a whole writes its code only, and enrolling again queues a fresh job', () =>
  configured(async () => {
    const { ledger, retained, queue, run } = await layersJob(zipSync(real));
    const jobId = (await queue())!;
    // A second enrolment while the job is queued queues none.
    assert.equal(await queue(), null);
    const lost = async () => { throw new Error('connection lost near uttam/README.md'); };
    await assert.rejects(run(jobId, { transaction: lost }), /connection lost/);
    assert.equal(retained.length, 0);
    assert.deepEqual([ledger.job(jobId).status, ledger.job(jobId).error], ['failed', 'INTAKE_ZIP_LAYERS_FAILED']);
    assert.equal(ledger.attempts[0].state, 'fenced');
    assert.deepEqual(ledger.attempts[0].failure_cause, {
      errorCode: 'INTAKE_ZIP_LAYERS_FAILED', class: 'Error', message: 'connection lost near uttam/README.md',
    });
    const reason = ledger.rows.get(ledger.itemId).limit_reason;
    assert.equal(reason, stopped('INTAKE_ZIP_LAYERS_FAILED'));
    assert.doesNotMatch(reason, /connection lost/);
    const retry = (await queue())!;
    assert.notEqual(retry, jobId);
    assert.equal(ledger.rows.get(ledger.itemId).limit_reason, layerWords(' being'));
    await run(retry);
    assert.equal(retained.length, 4);
    assert.equal(ledger.rows.get(ledger.itemId).limit_reason, layerWords(''));
  }));

test('a member streamed in ranges yields the bytes the whole read does; a damaged one stops by code', async () => {
  for (const level of [0, 6] as const) {
    const pack = zipSync(Object.fromEntries(Object.entries(real).map(([name, bytes]) => [name, [bytes, { level }]])));
    for (const name of Object.keys(real)) {
      const chunks: Uint8Array[] = [];
      const located = await locateZipMember(reader(pack), pack.length, name);
      const stream = streamZipMember(reader(pack), located, ZIP_LAYER_LIMITS.memberBytes);
      for await (const chunk of stream) chunks.push(chunk);
      assert.equal(sha(Buffer.concat(chunks)), sha(real[name as keyof typeof real]));
    }
  }
  const damaged = Buffer.from(zipSync({ 'a.geojson': real['uttam/block-boundary.geojson'] }));
  damaged[60] ^= 0xff;
  const located = await locateZipMember(reader(damaged), damaged.length, 'a.geojson');
  const drain = (maxBytes: number) => async () => {
    for await (const _ of streamZipMember(reader(damaged), located, maxBytes));
  };
  await assert.rejects(drain(ZIP_LAYER_LIMITS.memberBytes), /^Error: ZIP_MEMBER_INTEGRITY$/);
  await assert.rejects(drain(located.entry.size - 1), /^Error: ZIP_LAYER_SIZE$/);
});

// ZL1. A 20 MiB GeoJSON layer made in the test by repeating one real Google Open Buildings feature (test_only).
const feature = JSON.stringify(JSON.parse(real['uttam/01-google-building-footprints.geojson'].toString()).features[0]);
const large = Buffer.from(`{"type":"FeatureCollection","features":[${
  Array(Math.ceil(20 * 1024 * 1024 / (feature.length + 1))).fill(feature).join(',')}]}`);
const largePath = 'uttam/large-buildings.geojson';
// Stored: a repeated feature deflates past the probe's ratio bound, which would refuse the member as a layer.
const largePack = () => zipSync({ ...real, [largePath]: [large, { level: 0 }] });

/**
 * The /uploads byte receipt in memory: it hashes each part it is handed and keeps none. Its finalize writes the
 * lineage with the source, or, given a crash, fails once and keeps neither, as a rolled-back transaction does.
 */
function receipts(ledger: Ledger, refusal?: AppError, crash?: AppError) {
  const log = { created: [] as any[], batches: [] as (string | undefined)[], parts: [] as number[],
    sourceId: randomUUID(), hash: createHash('sha256'), aborted: 0 };
  const status = (revision: number) => ({ id: randomUUID(), revision, currentCaseRevision: ledger.revision });
  const service = {
    create: async (_caseId: string, input: any, batchSourceId?: string) => {
      LargeUploadCreateSchema.parse(input);
      if (refusal) throw refusal;
      log.created.push(input);
      log.batches.push(batchSourceId);
      return status(1);
    },
    claimPart: async (_caseId: string, _id: string, input: any) => input,
    receivePart: async (claim: any, bytes: Uint8Array) => {
      assert.equal(sha(bytes), claim.sha256);
      log.parts.push(bytes.length);
      log.hash.update(bytes);
      return status(claim.expectedRevision + 1);
    },
    failPart: async () => {},
    findDerived: async (_caseId: string, _lineage: unknown): Promise<any> => null,
    finalize: async (_caseId: string, _id: string, _input: unknown, lineage: unknown) => {
      if (crash) {
        const error = crash;
        crash = undefined;
        throw error;
      }
      ledger.revision++;
      ledger.inspections.set(log.sourceId, lineage);
      return { source: { sourceId: log.sourceId } };
    },
    abort: async () => { log.aborted++; },
  };
  return { service, log };
}

test('a GeoJSON layer over 16 MiB is streamed out as its own large original, named and enrolled', () =>
  configured(async () => {
    const pack = largePack();
    const { ledger, order, retained, queue, run } = await layersJob(pack);
    const { service, log } = receipts(ledger);
    let widest = 0;
    const read = async (_key: string, start: number, end: number) => {
      widest = Math.max(widest, end - start);
      return pack.subarray(start, end);
    };
    const jobId = (await queue())!;
    await run(jobId, { large: service, read });
    assert.equal(ledger.job(jobId).status, 'succeeded');
    // The small layers keep today's path; the large one goes through the receipt, never the whole-member retain.
    assert.deepEqual(retained.map(file => file.name), Object.keys(real).map(path => path.split('/').pop()));
    assert.deepEqual(log.created.map(input => [input.filename, input.bytes, input.sha256, input.mediaType]),
      [['large-buildings.geojson', large.length, sha(large), 'application/octet-stream']]);
    assert.equal(log.hash.digest('hex'), sha(large));
    assert.equal(log.created[0].profile, undefined, 'members below 128 MiB keep v1');
    // Peak held bytes, measured as the widest buffer the copy asks for or hands on: 1 MiB reads, 8 MiB parts.
    assert.ok(large.length > 20 * 1024 * 1024);
    assert.deepEqual(log.parts, [8 * 1024 * 1024, 8 * 1024 * 1024, large.length - 16 * 1024 * 1024]);
    assert.equal(widest, 1024 * 1024);
    const member = ledger.member(largePath);
    assert.deepEqual([member.source_id, member.limit_reason], [log.sourceId, null]);
    const lineage = ledger.inspections.get(log.sourceId) as Record<string, unknown>;
    assert.deepEqual({ ...lineage, crc32: 0 }, { version: 'zip-layer/1', parentSourceId: ledger.archiveId,
      parentSourceRevision: 1, parentSha256: sha(pack), parentItemId: ledger.itemId, memberPath: largePath,
      ordinal: 4, memberBytes: large.length, compressedBytes: large.length, crc32: 0, memberSha256: sha(large) });
    // Kept before any is enrolled; the large child is enrolled like any dropped file, which queues its large read.
    assert.deepEqual(order.slice(-5), [...retained.map(file => `register:${file.sourceId}`),
      `register:${log.sourceId}`]);
    assert.match(ledger.rows.get(ledger.itemId).limit_reason,
      /^5 members\. 4 GeoJSON layers, 1 unknown file taken out .*large-build/);
    assert.equal(await queue(), null);
  }));

for (const kind of ['zip', 'gzip'] as const) {
  test(`${kind} member above 128 MiB uses v2, yields for admission and storage, then links full lineage`, () =>
    configured(async () => {
      const original = Buffer.alloc(LARGE_ORIGINAL_LIMITS.maxOriginalBytes + 1, 32);
      const path = 'map/large.geojson';
      // Synthetic transport bytes only: no operational features, source or geometry.
      const pack = kind === 'zip' ? zipSync({ [path]: original }, { level: 0 })
        : gzipSync(original, { level: 0 });
      const fixture = await layersJob(pack, { name: kind === 'zip' ? 'layers.zip' : 'large.geojson.gz' });
      const { ledger } = fixture;
      const memberPath = kind === 'zip' ? path : 'large.geojson';
      const { service, log } = receipts(ledger);
      let full = true;
      let pending: any = null;
      let derived: unknown;
      const create = service.create;
      service.create = async (...args) => {
        assert.equal(args[1].profile, 'large-original/2');
        if (full) throw new AppError(429, 'UPLOAD_QUOTA', 'private admission text',
          { limit: 'open_receipts', freesAt: null });
        return create(...args);
      };
      service.findDerived = async () => {
        if (pending?.state === 'retained') ledger.inspections.set(log.sourceId, derived);
        return pending;
      };
      service.finalize = async (_caseId, _id, _input, lineage) => {
        pending = { id: randomUUID(), revision: 50, currentCaseRevision: ledger.revision,
          state: 'finalizing', source: null, parts: [] };
        derived = lineage;
        return pending;
      };
      const jobId = (await fixture.queue())!;
      await fixture.run(jobId, { large: service });
      assert.equal(ledger.job(jobId).status, 'queued', 'v2 admission is a retry, not failure');
      assert.equal(ledger.attempts.at(-1).state, 'yielded');
      assert.match(ledger.member(memberPath).limit_reason, /Waiting for a free receipt/);
      full = false;
      await fixture.run(jobId, { large: service });
      assert.equal(ledger.job(jobId).status, 'queued', 'queued v2 storage yields the archive job');
      assert.equal(log.created[0].profile, 'large-original/2');
      assert.deepEqual(log.batches, [ledger.archiveId]);
      assert.equal(log.parts.length, 17);
      assert.equal(log.parts.at(-1), 1);
      assert.equal(log.hash.digest('hex'), sha(original));
      assert.equal(log.aborted, 0, 'pending storage is never aborted');
      assert.equal(ledger.member(memberPath).source_id, null);
      assert.match(ledger.member(memberPath).limit_reason, /UPLOAD_FINALIZING/);
      // A second dispatch while storage is still running reuses its receipt, never sends the parts twice.
      await fixture.run(jobId, { large: service });
      assert.equal(log.created.length, 1);
      assert.equal(log.parts.length, 17);
      const lineage = derived as Record<string, unknown>;
      assert.deepEqual(lineage, { version: 'zip-layer/1', parentSourceId: ledger.archiveId,
        parentSourceRevision: 1, parentSha256: sha(pack), parentItemId: ledger.itemId, memberPath,
        ordinal: 0, memberBytes: original.length,
        compressedBytes: kind === 'zip' ? original.length : pack.length,
        crc32: crc32(original), memberSha256: sha(original) });
      pending = { ...pending, state: 'retained', source: { sourceId: log.sourceId } };
      await fixture.run(jobId, { large: service });
      assert.equal(ledger.job(jobId).status, 'succeeded');
      assert.equal(ledger.member(memberPath).source_id, log.sourceId);
      assert.deepEqual(ledger.inspections.get(log.sourceId), lineage);
      assert.deepEqual(fixture.order, [`register:${log.sourceId}`]);
      assert.equal(log.created.length, 1);
      assert.equal(sha(pack), ledger.archive.sha256, 'archive original unchanged');
    }));
}

test('an interrupted v2 member receipt resumes saved parts and their immutable request keys', () =>
  configured(async () => {
    const fixture = await layersJob(zipSync({ 'member.csv': Buffer.from('test_only') }));
    const { ledger } = fixture;
    const { service, log } = receipts(ledger);
    const chunk = Buffer.alloc(LARGE_ORIGINAL_LIMITS.partBytes, 32), tail = Buffer.from(' ');
    const hash = createHash('sha256');
    for (let part = 0; part < 16; part++) hash.update(chunk);
    const digest = hash.update(tail).digest('hex'), bytes = chunk.length * 16 + 1;
    const lineage = { version: 'zip-layer/1', parentSourceId: ledger.archiveId, parentSourceRevision: 1,
      parentSha256: ledger.archive.sha256, parentItemId: ledger.itemId, memberPath: 'large.csv', ordinal: 0,
      memberBytes: bytes, compressedBytes: bytes, crc32: 0, memberSha256: digest } as const;
    const requestKey = randomUUID();
    service.findDerived = async () => ({ id: randomUUID(), state: 'receiving', revision: 4,
      currentCaseRevision: ledger.revision, source: null, parts: [
        { partNumber: 1, state: 'received', requestKey: randomUUID() },
        { partNumber: 2, state: 'failed', requestKey } ] });
    const claimPart = service.claimPart;
    service.claimPart = async (...args) => {
      if (args[2].partNumber === 2) assert.equal(args[2].requestKey, requestKey);
      return claimPart(...args);
    };
    async function* parts() {
      for (let part = 0; part < 16; part++) yield chunk;
      yield tail;
    }
    const sourceId = await receiveLargeLayer(ledger.caseId, { revision: ledger.revision },
      { name: 'large.csv', bytes, sha256: digest }, parts(), { large: service } as never, lineage);
    assert.equal(sourceId, log.sourceId);
    assert.equal(log.created.length, 0, 'reuses the receipt admitted before the interruption');
    assert.equal(log.parts.length, 16, 'does not upload the already received part again');
    assert.deepEqual(ledger.inspections.get(sourceId), lineage);
  }));

test('a large layer whose CRC-32 does not match keeps nothing and says so', () => configured(async () => {
  // The member's CRC-32 in its central directory entry (16 bytes into the entry, whose name starts at byte 46).
  const damaged = Buffer.from(largePack());
  damaged[damaged.lastIndexOf(largePath) - 46 + 16] ^= 0xff;
  const { ledger, retained, queue, run } = await layersJob(damaged);
  const { service, log } = receipts(ledger);
  await run((await queue())!, { large: service });
  assert.deepEqual([log.created.length, retained.length], [0, 4]);
  const member = ledger.member(largePath);
  assert.equal(member.source_id, null);
  assert.match(member.limit_reason, /^ZIP_MEMBER_INTEGRITY: this member stays inside the archive/);
}));

test('a layer above the large ceiling stays in the ZIP in words', () =>
  configured(async () => {
    const above = await layersJob(largePack());
    const unused = receipts(above.ledger);
    above.ledger.member(largePath).size_bytes = String(1024 * 1024 * 1024 + 1);
    await above.run((await above.queue())!, { large: unused.service });
    assert.equal(unused.log.created.length, 0);
    assert.equal(above.ledger.member(largePath).limit_reason, 'ZIP_LAYER_SIZE: this member of 1073741825 '
      + 'bytes is kept inside the archive; members above 1073741824 bytes are not kept as their own original.');
    assert.equal(await above.queue(), null);
  }));

for (const expiry of ['known', 'null', 'immediate'] as const) {
  test(`a full allowance (${expiry} freesAt) waits without spending attempts, then keeps the member automatically`,
    t => configured(async () => {
      const fixture = await layersJob(zipSync({ 'uttam/README.md': real['uttam/README.md'] }));
      const { ledger, queue, run } = fixture;
      let now = ledger.archive.created_at.getTime(), full = true;
      t.mock.method(Date, 'now', () => now);
      const { service, log } = receipts(ledger);
      const create = service.create;
      service.create = async (...args) => {
        assert.equal(ledger.attempts.at(-1).state, 'active', 'receipt work is fenced');
        if (full) throw new AppError(429, 'UPLOAD_QUOTA', 'must not reach officer words',
          { limit: 'open_receipts_operator',
            freesAt: expiry === 'null' ? null : new Date(now + (expiry === 'known' ? 10_000 : 1)).toISOString() });
        return create(...args);
      };
      const retainMember = (caseId: string, revision: number, file: { name: string; bytes: Uint8Array },
        lineage: any) => retainZipMemberOriginal(caseId, revision, file, lineage, { large: service } as never);
      const jobId = (await queue())!;
      for (let retry = 0; retry < 5; retry++) {
        await run(jobId, { retainMember });
        const member = ledger.member('uttam/README.md');
        assert.equal(member.source_id, null);
        assert.match(member.limit_reason, /Waiting for a free receipt/);
        assert.doesNotMatch(member.limit_reason, /must not reach|Enrol/);
        assert.equal(ledger.job(jobId).status, 'queued');
        assert.equal(ledger.attempts.length, retry + 1);
        assert.ok(ledger.attempts.every(attempt => attempt.state === 'yielded'));
        assert.equal(ledger.job(jobId).attempts, 1, 'ZIP yields do not spend failure attempts');
        const delay = { known: 10_000, null: 120_000, immediate: 2000 }[expiry];
        assert.equal(Date.parse(ledger.job(jobId).next_attempt_at), now + delay);
        now = Date.parse(ledger.job(jobId).next_attempt_at);
      }
      full = false;
      await run(jobId, { retainMember });
      assert.equal(ledger.job(jobId).status, 'succeeded');
      assert.equal(ledger.member('uttam/README.md').source_id, log.sourceId);
      assert.equal(ledger.member('uttam/README.md').limit_reason, null);
      assert.equal(log.hash.digest('hex'), sha(real['uttam/README.md']));
      assert.equal(log.created.length, 1);
      assert.equal(ledger.attempts.length, 6);
      assert.equal(ledger.attempts.at(-1).state, 'accepted');
      assert.equal(ledger.job(jobId).attempts, 1);
      assert.deepEqual(fixture.order, [`register:${log.sourceId}`]);
      assert.equal(await queue(), null);
    }));
}

test('a large member waits only until the durable archive-retention bound, then says how long it waited',
  t => configured(async () => {
    const fixture = await layersJob(largePack());
    const { ledger, queue, run } = fixture;
    let now = ledger.archive.created_at.getTime();
    t.mock.method(Date, 'now', () => now);
    const { service, log } = receipts(ledger, new AppError(429, 'UPLOAD_QUOTA', 'receipt text',
      { limit: 'open_receipts', freesAt: new Date(now + 24 * 60 * 60_000).toISOString() }));
    const jobId = (await queue())!;
    await run(jobId, { large: service });
    assert.match(ledger.member(largePath).limit_reason, /Waiting for a free receipt/);
    assert.equal(Date.parse(ledger.job(jobId).next_attempt_at), now + ZIP_RECEIPT_WAIT_MS);
    assert.equal(ledger.attempts.length, 1);
    assert.equal(ledger.attempts[0].state, 'yielded');
    assert.equal(await queue(), null, 're-enrolment cannot reset the same waiting job');
    ledger.member(largePath).limit_reason = 'UPLOAD_QUOTA: officer words are not scheduling state.';
    now = Date.parse(ledger.job(jobId).next_attempt_at);
    await run(jobId, { large: service });
    assert.match(ledger.member(largePath).limit_reason,
      /UPLOAD_QUOTA:.*after waiting 1800 seconds \(30-minute bound from archive retention\)/);
    assert.match(ledger.member(largePath).limit_reason, /Enrol the archive again/);
    assert.equal(ledger.job(jobId).status, 'succeeded');
    assert.equal(log.created.length, 0);
    assert.equal(fixture.retained.length, 4, 'kept siblings are not copied again');
    assert.equal(sha(ledger.bytes), ledger.archive.sha256);
    // A new job is still bounded by the same retain, not its new dispatch time.
    await run((await queue())!, { large: service });
    assert.equal(ledger.jobs.at(-1).status, 'succeeded');
    assert.doesNotMatch(ledger.member(largePath).limit_reason, /Waiting for a free receipt/);
  }));

test('a large layer of 600 MiB is copied under a 50-minute deadline, as the large reader reads it', () =>
  configured(async () => {
    const pack = largePack();
    const { ledger, queue, run } = await layersJob(pack);
    const { service, log } = receipts(ledger);
    ledger.member(largePath).size_bytes = String(600 * 1024 * 1024);
    let longest = 0;
    const read = async (_key: string, start: number, end: number, _size: number, deadline: number) => {
      const left = deadline - Date.now();
      longest = Math.max(longest, left);
      // The small layers keep their one-minute member read; the large copy stops at its first read.
      if (left > 60_000) throw new Error('ZIP_LAYER_UNAVAILABLE');
      return pack.subarray(start, end);
    };
    await run((await queue())!, { large: service, read });
    assert.equal(log.created.length, 0);
    assert.ok(longest <= 50 * 60 * 1000 && longest > 50 * 60 * 1000 - 5000, `deadline ${longest} ms`);
  }));

test('a large layer whose finalize fails keeps no lineage and no link; enrolling again keeps it once', () =>
  configured(async () => {
    const { ledger, queue, run } = await layersJob(largePack());
    const { service, log } = receipts(ledger, undefined,
      new AppError(503, 'FINALIZATION_INTERRUPTED', 'receipt text'));
    await run((await queue())!, { large: service });
    const member = ledger.member(largePath);
    assert.deepEqual([member.source_id, ledger.inspections.has(log.sourceId), log.aborted], [null, false, 1]);
    assert.match(member.limit_reason, /^FINALIZATION_INTERRUPTED: this member stays inside the archive/);
    await run((await queue())!, { large: service });
    assert.deepEqual([member.source_id, member.limit_reason, log.created.length, log.aborted],
      [log.sourceId, null, 2, 1]);
    assert.equal((ledger.inspections.get(log.sourceId) as { memberPath: string }).memberPath, largePath);
    assert.equal(await queue(), null);
  }));

test('a large layer kept but not linked is linked to that child on the next enrolment; nothing new is kept', () =>
  configured(async () => {
    const { ledger, order, retained, queue, run } = await layersJob(largePack());
    const { service, log } = receipts(ledger);
    const member = ledger.member(largePath);
    ledger.linkFault = member.item_id;
    await run((await queue())!, { large: service });
    assert.deepEqual([member.source_id, ledger.inspections.has(log.sourceId), log.created.length],
      [null, true, 1]);
    assert.match(member.limit_reason, /^ZIP_LAYER_UNAVAILABLE: this member stays inside the archive/);
    let reads = 0;
    const read = async () => { reads++; throw new Error('ZIP_LAYER_UNAVAILABLE'); };
    await run((await queue())!, { large: service, read });
    // Found by its lineage and linked before any byte is read; no second receipt, no second small retain.
    assert.deepEqual([member.source_id, member.limit_reason, log.created.length, retained.length, reads],
      [log.sourceId, null, 1, 4, 0]);
    assert.ok(order.includes(`register:${log.sourceId}`));
    assert.equal(await queue(), null);
  }));

test('nested ZIP jobs unpack through depth two; a deeper child stays retained without enrolment', () =>
  configured(async () => {
    let pack = zipSync({ 'leaf.csv': Buffer.from('key,value\na,b\n') });
    for (let depth = 3; depth >= 1; depth--) pack = zipSync({ [`depth-${depth}.zip`]: pack }, { level: 0 });
    let current = await layersJob(pack);
    for (let depth = 0; depth <= INTAKE_PROBE_LIMITS.nestingDepth; depth++) {
      await current.run((await current.queue())!);
      const child = current.retained[0];
      assert.ok(child);
      assert.equal(current.retained.length, 1);
      assert.equal(sha(child.bytes), (child.lineage as { memberSha256: string }).memberSha256);
      if (depth === INTAKE_PROBE_LIMITS.nestingDepth) {
        assert.equal(current.order.filter(step => step.startsWith('register:')).length, 0);
        assert.match(current.ledger.member(child.name).limit_reason, /ZIP_NESTING_LIMIT:.*not read/);
        assert.match(current.ledger.rows.get(current.ledger.itemId).limit_reason, /own item; ZIP_NESTING_LIMIT/);
        assert.equal(await current.queue(), null);
        const deeper = await layersJob(child.bytes);
        deeper.ledger.archive.inspection.archiveMember = child.lineage;
        deeper.ledger.ancestors.set(current.ledger.archiveId, current.ledger.archive);
        for (const [id, ancestor] of current.ledger.ancestors) deeper.ledger.ancestors.set(id, ancestor);
        assert.equal(await deeper.queue(), null, 'A later direct enrolment cannot bypass the depth fence.');
        assert.equal(deeper.ledger.rows.get(deeper.ledger.itemId).state, 'read_to_limit');
        break;
      }
      assert.equal(current.order.filter(step => step.startsWith('register:')).length, 1);
      const next = await layersJob(child.bytes);
      next.ledger.archive.inspection.archiveMember = child.lineage;
      next.ledger.ancestors.set(current.ledger.archiveId, current.ledger.archive);
      for (const [id, ancestor] of current.ledger.ancestors) next.ledger.ancestors.set(id, ancestor);
      current = next;
    }
  }));

test('the general byte receipt stores a small PDF once and finalizes its lineage before enrolment', () =>
  configured(async () => {
    const pdf = Buffer.from('%PDF-1.4\n%%EOF');
    const fixture = await layersJob(zipSync({ 'docs/plan.pdf': pdf }));
    const { service, log } = receipts(fixture.ledger);
    const extracted = await readZipMember(reader(fixture.ledger.bytes), fixture.ledger.bytes.length,
      'docs/plan.pdf', ZIP_LAYER_LIMITS.memberBytes);
    const lineage = ArchiveMemberLineageSchema.parse({ version: 'zip-layer/1',
      parentSourceId: fixture.ledger.archiveId, parentSourceRevision: 1,
      parentSha256: sha(fixture.ledger.bytes), parentItemId: fixture.ledger.itemId,
      memberPath: 'docs/plan.pdf', ordinal: 0, memberBytes: pdf.length,
      compressedBytes: extracted.compressedBytes, crc32: extracted.crc32, memberSha256: sha(pdf) });
    await fixture.run((await fixture.queue())!, { retainMember: (caseId: string, revision: number,
      file: { name: string; bytes: Uint8Array }, member: typeof lineage) =>
      retainZipMemberOriginal(caseId, revision, file, member, { large: service } as never) });
    assert.deepEqual(log.parts, [pdf.length]);
    assert.equal(log.created[0].filename, 'plan.pdf');
    // TC2: the member's receipt names the ZIP as its batch item.
    assert.deepEqual(log.batches, [fixture.ledger.archiveId]);
    assert.equal(log.hash.digest('hex'), sha(pdf));
    assert.deepEqual(fixture.ledger.inspections.get(log.sourceId), lineage);
    assert.equal(fixture.ledger.member('docs/plan.pdf').source_id, log.sourceId);
    assert.deepEqual(fixture.order, [`register:${log.sourceId}`]);
  }));

test('the fenced mixed job leaves a shapefile grouped and keeps PDF, CSV, image and GeoJSON siblings', () =>
  configured(async () => {
    const shape = Buffer.alloc(100);
    shape.writeUInt32BE(9994);
    shape.writeUInt32LE(1000, 28);
    shape.writeUInt32LE(5, 32);
    const files = { 'map/roads.shp': shape, 'map/roads.shx': shape, 'map/roads.dbf': Buffer.from('DBF control'),
      'docs/plan.pdf': Buffer.from('%PDF-1.4\n%%EOF'), 'register.csv': Buffer.from('key,value\na,b\n'),
      'photo.png': Buffer.from('89504e470d0a1a0a', 'hex'),
      'map/blocks.geojson': real['uttam/block-boundary.geojson'] };
    const fixture = await layersJob(zipSync(files, { level: 0 }));
    const originalHash = sha(fixture.ledger.bytes);
    await fixture.run((await fixture.queue())!);
    assert.deepEqual(fixture.retained.map(file => file.name),
      ['plan.pdf', 'register.csv', 'photo.png', 'blocks.geojson']);
    for (const file of fixture.retained) {
      const path = (file.lineage as { memberPath: keyof typeof files }).memberPath;
      assert.equal(sha(file.bytes), sha(files[path]));
      assert.ok(fixture.order.includes(`register:${file.sourceId}`));
    }
    assert.equal(fixture.ledger.member('map/roads.shp').source_id, null);
    assert.equal(sha(fixture.ledger.bytes), originalHash);
    assert.match(fixture.ledger.rows.get(fixture.ledger.itemId).limit_reason,
      /1 shapefile layer grouped.*1 PDF, 1 CSV, 1 png file, 1 GeoJSON layer taken out/);
  }));

test('the fenced job never copies an unsafe path but still enrols a safe sibling', () =>
  configured(async () => {
    const fixture = await layersJob(zipSync({ '../outside.pdf': Buffer.from('%PDF-1.4\n%%EOF'),
      'safe.csv': Buffer.from('key,value\na,b\n') }));
    await fixture.run((await fixture.queue())!);
    assert.deepEqual(fixture.retained.map(file => file.name), ['safe.csv']);
    assert.equal(fixture.ledger.member('../outside.pdf').source_id, null);
    assert.match(fixture.ledger.rows.get(fixture.ledger.itemId).limit_reason, /ZIP_UNSAFE_PATH/);
  }));

const tweedRoot = 'E:/BhuAayam-data/datasets/map-formats/tweed-shire-council/';
const tweedZip = `${tweedRoot}TSC_Buildings_OD_8831041243266425049.zip`;
const tweedGpkg = `${tweedRoot}TSC_Buildings_OD_-1703359794462598529.gpkg`;

test('retained public Tweed originals fan out together as a GeoPackage and a nested shapefile ZIP',
  { skip: !existsSync(tweedZip) || !existsSync(tweedGpkg) }, () => configured(async () => {
    const originals = { 'maps/buildings.gpkg': readFileSync(tweedGpkg),
      'maps/buildings.zip': readFileSync(tweedZip) };
    const fixture = await layersJob(zipSync(originals, { level: 0 }));
    assert.deepEqual(fixture.card.members.map(member => member.format), ['geopackage', 'zip']);
    await fixture.run((await fixture.queue())!);
    assert.equal(fixture.retained.length, 2);
    for (const file of fixture.retained) {
      const path = (file.lineage as { memberPath: keyof typeof originals }).memberPath;
      assert.equal(sha(file.bytes), sha(originals[path]));
      assert.ok(fixture.order.includes(`register:${file.sourceId}`));
    }
    const nested = await probeOriginal(reader(originals['maps/buildings.zip']),
      originals['maps/buildings.zip'].length, 'buildings.zip');
    assert.ok(nested.members.some(member => member.format === 'shapefile'));
    assert.equal(sha(readFileSync(tweedGpkg)), sha(originals['maps/buildings.gpkg']));
    assert.equal(sha(readFileSync(tweedZip)), sha(originals['maps/buildings.zip']));
  }));

function cappedMembers() {
  return Object.fromEntries(Array.from({ length: ZIP_LAYER_LIMITS.layers + 2 }, (_, index) => {
    const number = ZIP_LAYER_LIMITS.layers + 2 - index;
    if (index % 3 === 0) return [`maps/${number}.geojson`, real['uttam/block-boundary.geojson']];
    if (index % 3 === 1) return [`docs/${number}.pdf`, Buffer.from('%PDF-1.4\n%%EOF')];
    return [`registers/${number}.csv`, Buffer.from('key,value\na,b\n')];
  }));
}

test('one archive caps all independent originals together and names overflow in archive order', () =>
  configured(async () => {
    const files = cappedMembers();
    const paths = Object.keys(files);
    const fixture = await layersJob(zipSync(files));
    // The SQL read orders by path; selection must restore archive order before applying the cap.
    const children = [...fixture.ledger.rows.values()].filter(row => row.parent_item_id)
      .sort((left, right) => left.member_path.localeCompare(right.member_path));
    for (const child of children) fixture.ledger.rows.delete(child.item_id);
    for (const child of children) fixture.ledger.rows.set(child.item_id, child);
    await fixture.run((await fixture.queue())!);
    assert.equal(fixture.retained.length, ZIP_LAYER_LIMITS.layers);
    assert.equal(fixture.order.filter(step => step.startsWith('register:')).length, ZIP_LAYER_LIMITS.layers);
    assert.deepEqual(fixture.retained.map(file => (file.lineage as { memberPath: string }).memberPath),
      paths.slice(0, ZIP_LAYER_LIMITS.layers));
    for (const path of paths.slice(ZIP_LAYER_LIMITS.layers)) {
      assert.equal(fixture.ledger.member(path).source_id, null);
      assert.equal(fixture.ledger.member(path).limit_reason, `ZIP_LAYER_LIMIT: the first `
        + `${ZIP_LAYER_LIMITS.layers} independent members of this archive are taken out in archive order; `
        + 'this one stays inside the archive, not read.');
    }
    const words = fixture.ledger.rows.get(fixture.ledger.itemId).limit_reason;
    assert.match(words, /2 files kept, not read:.*ZIP_LAYER_LIMIT/);
    assert.ok(words.indexOf(paths.at(-2)!) < words.indexOf(paths.at(-1)!));
    assert.ok(words.length <= 2000);
    assert.equal(await fixture.queue(), null);
  }));

test('a retry counts originals already kept against the same per-archive cap', () =>
  configured(async () => {
    const files = cappedMembers();
    const first = Object.keys(files)[0].split('/').pop();
    let interrupted = false;
    const fixture = await layersJob(zipSync(files), { failRetain: name => {
      if (name !== first || interrupted) return null;
      interrupted = true;
      return new AppError(503, 'ZIP_LAYER_UNAVAILABLE', 'interrupted receipt control');
    } });
    await fixture.run((await fixture.queue())!);
    assert.equal(fixture.retained.length, ZIP_LAYER_LIMITS.layers - 1);
    await fixture.run((await fixture.queue())!);
    assert.equal(fixture.retained.length, ZIP_LAYER_LIMITS.layers);
    for (const path of Object.keys(files).slice(ZIP_LAYER_LIMITS.layers)) {
      assert.equal(fixture.ledger.member(path).source_id, null);
      assert.match(fixture.ledger.member(path).limit_reason, /^ZIP_LAYER_LIMIT:/);
    }
    assert.equal(await fixture.queue(), null);
  }));

test('long or padded basenames fit the byte receipt while their exact paths stay in lineage', () =>
  configured(async () => {
    for (const path of ['docs/ plan.pdf ', `docs/${'long-'.repeat(40)}.pdf`]) {
      const fixture = await layersJob(zipSync({ [path]: Buffer.from('%PDF-1.4\n%%EOF') }));
      const { service, log } = receipts(fixture.ledger);
      await fixture.run((await fixture.queue())!, { retainMember: (caseId: string, revision: number,
        file: { name: string; bytes: Uint8Array }, lineage: any) =>
        retainZipMemberOriginal(caseId, revision, file, lineage, { large: service } as never) });
      assert.equal(log.created.length, 1);
      assert.ok(log.created[0].filename.length <= 150);
      assert.equal((fixture.ledger.inspections.get(log.sourceId) as { memberPath: string }).memberPath, path);
    }
  }));

// AUD2 gap 1. The map route keeps a GeoJSON its reader then refuses; the member goes through the byte receipt.
test('a GeoJSON member of 2,001 polygons the map route refuses is kept through the byte receipt, with lineage', () =>
  configured(async () => {
    // Protocol-only unit squares, not operational locations or proposed registry records.
    const squares = Array.from({ length: 2001 }, (_, at) => ({ type: 'Feature', properties: {},
      geometry: { type: 'Polygon', coordinates: [[[at, 0], [at + 1, 0], [at + 1, 1], [at, 1], [at, 0]]] } }));
    const blocks = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: squares }));
    const fixture = await layersJob(zipSync({ 'map/blocks.geojson': blocks }), { mapRoute: geojsonInventory });
    await fixture.run((await fixture.queue())!);
    const [kept] = fixture.retained;
    assert.deepEqual([fixture.retained.length, kept.profile, kept.name], [1, 'large-original-v1', 'blocks.geojson']);
    assert.equal(sha(kept.bytes), sha(blocks));
    const lineage = ArchiveMemberLineageSchema.parse(kept.lineage);
    assert.deepEqual([lineage.parentSourceId, lineage.parentSourceRevision, lineage.parentSha256,
      lineage.parentItemId, lineage.memberPath, lineage.memberBytes, lineage.memberSha256],
    [fixture.ledger.archiveId, 1, sha(fixture.ledger.bytes), fixture.ledger.itemId, 'map/blocks.geojson',
      blocks.length, sha(blocks)]);
    const member = fixture.ledger.member('map/blocks.geojson');
    assert.deepEqual([member.source_id, member.limit_reason], [kept.sourceId, null]);
    assert.ok(fixture.order.includes(`register:${kept.sourceId}`));
    assert.equal(fixture.ledger.rows.get(fixture.ledger.itemId).limit_reason,
      '1 member. 1 GeoJSON layer taken out as their own items: map/blocks.geojson.');
    assert.equal(await fixture.queue(), null);
  }));

test('a GeoJSON member holding one Feature is kept through the byte receipt and never linked to a refused row', () =>
  configured(async () => {
    const parsed = JSON.parse(real['uttam/01-google-building-footprints.geojson'].toString());
    const single = Buffer.from(JSON.stringify(parsed.features[0]));
    const fixture = await layersJob(zipSync({ 'map/one.geojson': single }), { mapRoute: geojsonInventory });
    assert.equal(fixture.card.members[0].format, 'geojson');
    const member = fixture.ledger.member('map/one.geojson');
    // A stop between the byte receipt and the link: the refused map row and the kept child share the lineage.
    fixture.ledger.linkFault = member.item_id;
    await fixture.run((await fixture.queue())!);
    assert.equal(member.source_id, null);
    await fixture.run((await fixture.queue())!);
    const [kept] = fixture.retained;
    assert.deepEqual([fixture.retained.length, kept.profile, sha(kept.bytes)], [1, 'large-original-v1', sha(single)]);
    assert.deepEqual([member.source_id, member.limit_reason], [kept.sourceId, null]);
    assert.equal(fixture.ledger.partial.size, 1);
    assert.ok(fixture.order.includes(`register:${kept.sourceId}`));
  }));

// AUD2 gap 6. A KML beside other kinds does not make the ZIP a KMZ.
test('a ZIP of a KML, a GeoJSON and a CSV takes out all three as their own items; none is dropped', () =>
  configured(async () => {
    const files = { 'a.kml': Buffer.from('<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>'),
      'b.geojson': real['uttam/block-boundary.geojson'], 'c.csv': Buffer.from('key,value\na,b\n') };
    const fixture = await layersJob(zipSync(files));
    assert.equal(fixture.card.format, 'zip');
    await fixture.run((await fixture.queue())!);
    assert.deepEqual(fixture.retained.map(file => [file.name, file.profile]),
      [['a.kml', 'large-original-v1'], ['b.geojson', 'geojson-manual-v1'], ['c.csv', 'large-original-v1']]);
    for (const file of fixture.retained) {
      const path = (file.lineage as { memberPath: keyof typeof files }).memberPath;
      assert.equal(sha(file.bytes), sha(files[path]));
      assert.equal(fixture.ledger.member(path).source_id, file.sourceId);
      assert.ok(fixture.order.includes(`register:${file.sourceId}`));
    }
    assert.equal(fixture.ledger.rows.get(fixture.ledger.itemId).limit_reason,
      '3 members. 1 kml file, 1 GeoJSON layer, 1 CSV taken out as their own items: a.kml, b.geojson, c.csv.');
  }));

// AUD3 gap 5. A second KML or a photo the KML does not reference is its own item, never hidden inside a KMZ.
const kmlText = (name: string) =>
  Buffer.from(`<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${name}</name></Document></kml>`);
const jpeg = Buffer.from('ffd8ffe000104a46494600', 'hex');

test('a ZIP of two KML documents takes out both as their own items for the KML reader', () =>
  configured(async () => {
    const files = { 'doc.kml': kmlText('west'), 'wards/east.kml': kmlText('east') };
    const fixture = await layersJob(zipSync(files));
    assert.equal(fixture.card.format, 'zip');
    await fixture.run((await fixture.queue())!);
    assert.deepEqual(fixture.retained.map(file => [file.name, sha(file.bytes)]),
      [['doc.kml', sha(files['doc.kml'])], ['east.kml', sha(files['wards/east.kml'])]]);
    assert.equal(fixture.ledger.rows.get(fixture.ledger.itemId).limit_reason,
      '2 members. 2 kml files taken out as their own items: doc.kml, wards/east.kml.');
  }));

test('a ZIP of a KML and a plan photo it does not reference takes out both; the photo is a page image', () =>
  configured(async () => {
    const fixture = await layersJob(zipSync({ 'doc.kml': kmlText('site'), 'plan.jpg': jpeg }));
    assert.equal(fixture.card.format, 'zip');
    await fixture.run((await fixture.queue())!);
    assert.deepEqual(fixture.retained.map(file => [file.name, file.profile]),
      [['doc.kml', 'large-original-v1'], ['plan.jpg', 'large-original-v1']]);
    assert.equal(fixture.ledger.rows.get(fixture.ledger.itemId).limit_reason,
      '2 members. 1 kml file, 1 jpeg file taken out as their own items: doc.kml, plan.jpg.');
  }));

test('a KMZ whose overlay image its KML references queues no fan-out; the image stays with the KMZ', async () => {
  const kml = Buffer.from('<kml xmlns="http://www.opengis.net/kml/2.2"><Document><GroundOverlay><Icon>'
    + '<href>files/overlay.jpg</href></Icon></GroundOverlay></Document></kml>');
  const fixture = await layersJob(zipSync({ 'doc.kml': kml, 'files/overlay.jpg': jpeg }));
  assert.equal(fixture.card.format, 'kmz');
  assert.equal(await fixture.queue(), null);
  assert.equal(fixture.retained.length, 0);
});

/** ZP2. Enrolment as intake registration writes it: the kept source's own top-level item, keyed by the source. */
function enrolInto(ledger: Ledger, refuse = (_sourceId: string) => false) {
  return async (_caseId: string, input: { sourceId: string }) => {
    if (refuse(input.sourceId)) throw new AppError(503, 'INTAKE_BUSY', 'not stored');
    ledger.rows.set(input.sourceId, { item_id: input.sourceId, case_id: ledger.caseId, source_id: input.sourceId,
      parent_item_id: null, member_path: null, state: 'probed' });
    return {};
  };
}

test('a ZIP with three members taken out lists three items plus the archive, not six', () =>
  configured(async () => {
    const files = { 'a.kml': Buffer.from('<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>'),
      'b.geojson': real['uttam/block-boundary.geojson'], 'c.csv': Buffer.from('key,value\na,b\n') };
    const fixture = await layersJob(zipSync(files));
    await fixture.run((await fixture.queue())!, { register: enrolInto(fixture.ledger) });
    const rows = [...fixture.ledger.rows.values()];
    assert.equal(rows.length, 7);
    const listed = listedIntakeRows(rows).map(row => row.item_id);
    assert.deepEqual(listed.sort(), [fixture.ledger.itemId, ...fixture.retained.map(file => file.sourceId)].sort());
    assert.match(fixture.ledger.rows.get(fixture.ledger.itemId).limit_reason, /^3 members\. .* taken out/);
  }));

test('a member not taken out, or kept but not enrolled, lists once with its own words', () =>
  configured(async () => {
    const files = { 'a.csv': Buffer.from('key,value\na,b\n'),
      'b.geojson': real['uttam/block-boundary.geojson'], 'c.csv': Buffer.from('key,value\nc,d\n') };
    const fixture = await layersJob(zipSync(files), { failRetain: name =>
      name === 'b.geojson' ? new AppError(422, 'GEOJSON_INVALID', 'not stored') : null });
    const named = (sourceId: string) => fixture.retained.find(file => file.sourceId === sourceId)?.name;
    await fixture.run((await fixture.queue())!,
      { register: enrolInto(fixture.ledger, sourceId => named(sourceId) === 'c.csv') });
    const listed = listedIntakeRows([...fixture.ledger.rows.values()]);
    const [kept, refused, unenrolled] = ['a.csv', 'b.geojson', 'c.csv'].map(path => fixture.ledger.member(path));
    assert.deepEqual(listed.map(row => row.item_id).sort(),
      [fixture.ledger.itemId, kept.source_id, refused.item_id, unenrolled.item_id].sort());
    assert.match(refused.limit_reason, /^GEOJSON_INVALID: this member stays inside the archive/);
    assert.match(unenrolled.limit_reason, /^INTAKE_BUSY: this member is kept as its own original but was not/);
  }));
