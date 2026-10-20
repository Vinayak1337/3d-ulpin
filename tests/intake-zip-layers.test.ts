import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { zipSync } from 'fflate';
import { ArchiveMemberLineageSchema, ZIP_LAYER_LIMITS, type IntakeCard } from '../packages/contracts/src/usp/intake';
import { probeOriginal } from '../packages/server/src/modules/usp/ingestion/intake-probe';
import { locateZipMember, readZipMember, streamZipMember }
  from '../packages/server/src/modules/usp/ingestion/intake-zip';
import { queueZipLayersTx, ZIP_ARCHIVE_PROFILE } from '../packages/server/src/modules/usp/ingestion/intake-zip-layers';
import { runIntakeZipLayersJob } from '../packages/server/src/modules/usp/ingestion/intake-zip-layers-worker';
import { AppError } from '../packages/server/src/infrastructure/errors';

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
  readonly inspections = new Map<string, unknown>();
  archive: any;

  constructor(readonly bytes: Uint8Array, readonly card: IntakeCard) {
    this.archive = { id: this.archiveId, case_id: this.caseId, family_id: this.archiveId, revision: 1,
      name: 'layers.zip', profile: ZIP_ARCHIVE_PROFILE, bytes: bytes.length, sha256: sha(bytes),
      object_key: `sources/${this.archiveId}/${sha(bytes)}`, status: 'needs_input',
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
    if (sql.startsWith('SELECT * FROM jobs') || sql.startsWith('SELECT status FROM jobs')) {
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
    if (sql.startsWith('SELECT * FROM sources')) return values[1] === this.archiveId ? [this.archive] : [];
    if (sql.startsWith('UPDATE sources SET inspection')) { this.inspections.set(values[0], values[1]); return []; }
    if (sql.startsWith('SELECT * FROM usp_intake_items WHERE source_id')) {
      return [...this.rows.values()].filter(row => row.source_id === values[0] && !row.parent_item_id);
    }
    if (/^SELECT (?:\*|card) FROM usp_intake_items/.test(sql)) {
      const row = this.rows.get(values[1]);
      return row && !row.parent_item_id ? [row] : [];
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

async function layersJob(pack: Uint8Array, options: { failRetain?: (name: string) => AppError | null } = {}) {
  const card = await probeOriginal(reader(pack), pack.length, 'layers.zip');
  const ledger = new Ledger(pack, card);
  const client = { query: ledger.query.bind(ledger) } as unknown as PoolClient;
  const order: string[] = [];
  const retained: { name: string; bytes: Uint8Array; lineage: unknown; input: any; sourceId: string }[] = [];
  const dependencies = {
    read: async (_key: string, start: number, end: number) => pack.subarray(start, end),
    retain: async (_caseId: string, input: any, file: { name: string; bytes: Uint8Array }, lineage: unknown) => {
      const refusal = options.failRetain?.(file.name);
      if (refusal) throw refusal;
      order.push(`retain:${file.name}`);
      const sourceId = randomUUID();
      retained.push({ ...file, lineage, input, sourceId });
      ledger.revision++;
      return { source: { sourceId } } as never;
    },
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

const others = ' Not taken in: uttam/README.md (not a map layer).';
const stopped = (code: string) =>
  `Taking the layers out of this ZIP stopped (${code}); enrol the ZIP again to retry.${others}`;
// ZW1: the archive's words while its job is queued or running, and once it is done.
const layerWords = (being: string) => `3 map layers in this ZIP are${being} taken in as their own files: `
  + 'uttam/01-google-building-footprints.geojson, uttam/02-osm-road-centrelines.geojson, '
  + `uttam/block-boundary.geojson.${others}`;

test('the job keeps each GeoJSON layer of a real ZIP as its own child original and item; the README not', () =>
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
    assert.deepEqual(retained.map(file => file.name),
      ['01-google-building-footprints.geojson', '02-osm-road-centrelines.geojson', 'block-boundary.geojson']);
    for (const [ordinal, file] of retained.entries()) {
      const path = `uttam/${file.name}`;
      assert.equal(sha(file.bytes), sha(real[path as keyof typeof real]));
      const lineage = ArchiveMemberLineageSchema.parse(file.lineage);
      assert.deepEqual({ ...lineage, crc32: 0 }, { version: 'zip-layer/1', parentSourceId: ledger.archiveId,
        parentSourceRevision: 1, parentSha256: sha(pack), parentItemId: ledger.itemId, memberPath: path, ordinal,
        memberBytes: file.bytes.length, compressedBytes: lineage.compressedBytes, crc32: 0,
        memberSha256: sha(file.bytes) });
      assert.equal(file.input.format, 'geojson');
      assert.equal(ledger.member(path).source_id, kept[ordinal]);
    }
    assert.equal(ledger.member('uttam/README.md').source_id, null);
    // Every layer is kept before any is enrolled, so no layer's draft associates the case first.
    assert.deepEqual(order.map(step => step.split(':')[0]), ['retain', 'retain', 'retain',
      'register', 'register', 'register']);
    // Every layer kept and enrolled: enrolling the archive again queues nothing.
    assert.equal(await queue(), null);
    // A failed enrolment is retried by a fresh job, which keeps nothing twice and enrols the same originals again.
    ledger.member('uttam/block-boundary.geojson').limit_reason = 'ZIP_LAYER_UNAVAILABLE: kept but not enrolled.';
    order.length = 0;
    const retry = (await queue())!;
    assert.notEqual(retry, jobId);
    await run(retry);
    assert.deepEqual(order, kept.map(id => `register:${id}`));
    assert.equal(ledger.member('uttam/block-boundary.geojson').limit_reason, null);
    assert.equal(await queue(), null);
  }));

test('a layer the GeoJSON receipt refuses stays in the archive with a code; its siblings are kept', () =>
  configured(async () => {
    const { ledger, retained, queue, run } = await layersJob(zipSync(real), { failRetain: name =>
      name.startsWith('02-') ? new AppError(422, 'GEOJSON_INVALID', 'parser text that must not be stored') : null });
    const jobId = (await queue())!;
    await run(jobId);
    assert.equal(retained.length, 2);
    const refused = ledger.member('uttam/02-osm-road-centrelines.geojson');
    assert.equal(refused.source_id, null);
    assert.match(refused.limit_reason, /^GEOJSON_INVALID: this GeoJSON member stays inside the archive/);
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

test('a real mixed ZIP with ArcGIS JSON, PDFs and models queues no job and keeps no layer', () =>
  configured(async () => {
    const pack = readFileSync('fixtures/lake-view-complete-inputs.zip');
    const { card, ledger, retained, queue } = await layersJob(pack);
    assert.ok(card.members.length > 30);
    assert.equal(await queue(), null);
    assert.equal(ledger.jobs.length, 0);
    assert.equal(retained.length, 0);
    assert.equal(ledger.rows.get(ledger.itemId).limit_reason, 'The ZIP words.');
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
    const reason = ledger.rows.get(ledger.itemId).limit_reason;
    assert.equal(reason, stopped('INTAKE_ZIP_LAYERS_FAILED'));
    assert.doesNotMatch(reason, /connection lost/);
    const retry = (await queue())!;
    assert.notEqual(retry, jobId);
    assert.equal(ledger.rows.get(ledger.itemId).limit_reason, layerWords(' being'));
    await run(retry);
    assert.equal(retained.length, 3);
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

/** The /uploads byte receipt in memory: it hashes each part it is handed and keeps none. */
function receipts(ledger: Ledger, refusal?: AppError) {
  const log = { created: [] as any[], parts: [] as number[], sourceId: randomUUID(), hash: createHash('sha256') };
  const status = (revision: number) => ({ id: randomUUID(), revision, currentCaseRevision: ledger.revision });
  const service = {
    create: async (_caseId: string, input: any) => {
      if (refusal) throw refusal;
      log.created.push(input);
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
    finalize: async () => {
      ledger.revision++;
      return { source: { sourceId: log.sourceId } };
    },
    abort: async () => {},
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
    assert.deepEqual(retained.map(file => file.name),
      ['01-google-building-footprints.geojson', '02-osm-road-centrelines.geojson', 'block-boundary.geojson']);
    assert.deepEqual(log.created.map(input => [input.filename, input.bytes, input.sha256, input.mediaType]),
      [['large-buildings.geojson', large.length, sha(large), 'application/octet-stream']]);
    assert.equal(log.hash.digest('hex'), sha(large));
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
    assert.deepEqual(order.slice(-4), [...retained.map(file => `register:${file.sourceId}`),
      `register:${log.sourceId}`]);
    assert.match(ledger.rows.get(ledger.itemId).limit_reason, /^4 map layers in this ZIP are taken in .*large-build/);
    assert.equal(await queue(), null);
  }));

test('a large layer whose CRC-32 does not match keeps nothing and says so', () => configured(async () => {
  // The member's CRC-32 in its central directory entry (16 bytes into the entry, whose name starts at byte 46).
  const damaged = Buffer.from(largePack());
  damaged[damaged.lastIndexOf(largePath) - 46 + 16] ^= 0xff;
  const { ledger, retained, queue, run } = await layersJob(damaged);
  const { service, log } = receipts(ledger);
  await run((await queue())!, { large: service });
  assert.deepEqual([log.created.length, retained.length], [0, 3]);
  const member = ledger.member(largePath);
  assert.equal(member.source_id, null);
  assert.match(member.limit_reason, /^ZIP_MEMBER_INTEGRITY: this GeoJSON member stays inside the archive/);
}));

test('a layer above the large ceiling or past a full receipt allowance stays in the ZIP in words', () =>
  configured(async () => {
    const above = await layersJob(largePack());
    const unused = receipts(above.ledger);
    above.ledger.member(largePath).size_bytes = String(1024 * 1024 * 1024 + 1);
    await above.run((await above.queue())!, { large: unused.service });
    assert.equal(unused.log.created.length, 0);
    assert.equal(above.ledger.member(largePath).limit_reason, 'ZIP_LAYER_SIZE: this GeoJSON member of 1073741825 '
      + 'bytes is kept inside the archive; members above 1073741824 bytes are not kept as their own original.');
    assert.equal(await above.queue(), null);
    const full = await layersJob(largePack());
    const refused = receipts(full.ledger, new AppError(429, 'UPLOAD_QUOTA', 'receipt text'));
    await full.run((await full.queue())!, { large: refused.service });
    assert.equal(full.ledger.member(largePath).limit_reason, `UPLOAD_QUOTA: this GeoJSON member of ${large.length} `
      + 'bytes stays inside the archive; the large-original receipt allowance is full, so it was not kept as its '
      + 'own original. Enrol the archive again to retry once a receipt is free.');
    assert.notEqual(await full.queue(), null);
  }));
