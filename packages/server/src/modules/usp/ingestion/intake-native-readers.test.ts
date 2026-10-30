import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, test } from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { zipSync } from 'fflate';
import {
  CITYGML_LIMITS, CITYJSON_LIMITS, DXF_LIMITS, GLTF_LIMITS, OBJ_LIMITS, CityGMLInputSchema, CityJSONInputSchema,
  CityJSONSummarySchema, DXFInputSchema, GltfInputSchema, IntakeItemSchema, ObjInputSchema, type CityJSONResult,
  type IntakeCard,
} from '@ulpin/contracts/usp';
import { closeStorageClient, sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { AppError } from '../../../infrastructure/errors';
import { boundedCityGMLObject, citygmlSourceTx, readCityGMLResult } from './citygml';
import { failCityGMLJob, runCityGMLJob } from './citygml-worker';
import { citygmlSummary } from './citygml-processor';
import { cityjsonSourceTx } from './cityjson';
import { failCityJSONJob } from './cityjson-worker';
import { dxfSourceTx } from './dxf';
import { failDXFJob } from './dxf-worker';
import { dxfSummary } from './dxf-processor';
import { ingestionBinding } from './events';
import { gltfSourceTx } from './gltf';
import { failGltfJob } from './gltf-worker';
import { gltfSummary } from './gltf-processor';
import type { IntakeSourceRow } from './intake-context';
import { queueIntakeDraftTx } from './intake-draft';
import { intakeItem } from './intake-ledger';
import { batchNativeReader, intakeNativeReaderJobId, intakeNativeReadWords, outlinesConverted,
  settleIntakeNativeReaderTx, type IntakeNativeReaderEnd } from './intake-native-readers';
import { probeOriginal } from './intake-probe';
import { fanOutZipLayers, type ZipLayerDependencies } from './intake-zip-layers';
import { readingOf } from './intake-reading';
import { convertNativeLayers, type NativeDerivativeDependencies } from './intake-native-derivative';
import { objSourceTx } from './obj';
import { failObjJob } from './obj-worker';
import { objSummary } from './obj-processor';

/** A probed card format; glb and gltf both go to the one glTF reader. */
type Format = 'dxf' | 'citygml' | 'cityjson' | 'glb' | 'gltf' | 'obj';
const dxfRoot = process.env.ULPIN_DXF_TEST_ROOT ?? 'E:/BhuAayam-data/task-data/desktop-dxf-native';
const gmlRoot = process.env.ULPIN_CITYGML_TEST_ROOT ?? 'E:/BhuAayam-data/task-data/desktop-citygml-native';
const gltfRoot = process.env.ULPIN_GLTF_TEST_ROOT ?? 'E:/BhuAayam-data/task-data/desktop-gltf-native';
const objRoot = process.env.ULPIN_OBJ_TEST_ROOT ?? 'E:/BhuAayam-data/task-data/desktop-obj-native';
const cityjsonPath = new URL('../../../../../../fixtures/usp/D1/single-roof/original.json', import.meta.url);
const gltfReader = { reader: 'gltf' as const, limit: GLTF_LIMITS.originalBytes, schema: GltfInputSchema,
  source: gltfSourceTx, fail: (id: string, caseId: string, code: string) => failGltfJob(id, caseId, code) };
const inputs = {
  dxf: { reader: 'dxf', path: `${dxfRoot}/sources/1_polylines.dxf`, limit: DXF_LIMITS.originalBytes,
    schema: DXFInputSchema, source: dxfSourceTx,
    fail: (id: string, caseId: string, code: string) => failDXFJob(id, caseId, code) },
  citygml: { reader: 'citygml', path: `${gmlRoot}/originals/Building_and_garage_LOD2-EPSG25832.gml`,
    limit: CITYGML_LIMITS.originalBytes, schema: CityGMLInputSchema, source: citygmlSourceTx,
    fail: (id: string, caseId: string, code: string) => failCityGMLJob(id, caseId, code) },
  cityjson: { reader: 'cityjson', path: cityjsonPath, limit: CITYJSON_LIMITS.originalBytes,
    schema: CityJSONInputSchema, source: cityjsonSourceTx,
    fail: (id: string, _caseId: string, code: string) => failCityJSONJob(id, code) },
  // NR4: the glTF and OBJ authority tests' own originals and saved native readings.
  glb: { ...gltfReader, path: `${gltfRoot}/originals/Box.glb`, reading: `${gltfRoot}/final-glb/gltf.json` },
  gltf: { ...gltfReader, path: `${gltfRoot}/originals/Box.gltf`,
    reading: `${gltfRoot}/final-external-gltf/gltf.json` },
  obj: { reader: 'obj', path: `${objRoot}/no_material.obj`, reading: `${objRoot}/complete-run01/obj.json`,
    limit: OBJ_LIMITS.originalBytes, schema: ObjInputSchema, source: objSourceTx,
    fail: (id: string, caseId: string, code: string) => failObjJob(id, caseId, code) },
} as const;
const globals = globalThis as unknown as { ulpinPool?: Pool };
let previousPool: Pool | undefined;
let previousSubject: string | undefined;

beforeEach(() => {
  previousPool = globals.ulpinPool;
  previousSubject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'nr1-protocol-operator';
});
afterEach(() => {
  globals.ulpinPool = previousPool;
  if (previousSubject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previousSubject;
});

function sourceBytes(format: Format): Buffer {
  const raw = readFileSync(inputs[format].path);
  if (format !== 'cityjson') return raw;
  // Existing native-reader fixture: standalone control using only the real D1 header/feature literals.
  // The 3DBAG API envelope itself has no root type and is not recognised by the current batch probe.
  const envelope = JSON.parse(raw.toString('utf8'));
  return Buffer.from(JSON.stringify({ ...envelope.metadata, ...envelope.feature, type: envelope.metadata.type }));
}

function sourceRow(format: Format, raw: Buffer, profile: string, bytes = raw.length): IntakeSourceRow {
  const id = randomUUID(), caseId = randomUUID(), hash = sha256(raw), binding = ingestionBinding(caseId);
  const large = profile === 'large-original-v1', reader = inputs[format].reader;
  const receipt = large ? { uploadId: randomUUID(), operatorSubject: binding.subject, objectEtag: 'protocol-etag',
    verifiedSha256: hash, verifiedBytes: bytes,
    provenance: { state: 'not_stated', origin: 'not_stated', acquiredAt: '2026-10-01T00:00:00.000Z' },
    conversion: 'unsupported', bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed' }
    : { version: `${reader}-native/1`, subject: binding.subject, accessSha256: binding.access,
      sha256: hash, bytes, receivedAt: '2026-10-01T00:00:00.000Z', lineageState: 'caller_declared',
      lineage: { issuer: null, originalUrl: null, acquiredAt: null, permissionReference: null,
        geography: null, limitations: ['test_only source and SQL protocol control'] } };
  const name = format === 'cityjson' ? 'city.json' : `file.${format}`;
  return { id, case_id: caseId, family_id: id, revision: 1, name,
    profile, bytes, sha256: hash, object_key: `${large ? 'large-originals' : 'sources'}/${id}/${hash}`,
    status: 'needs_input', inspection: { [large ? 'largeOriginal' : `${reader}Original`]: receipt } };
}

// SQL is a protocol double: no property, source, job or geometry is persisted by these tests.
class BatchProtocol {
  jobs = new Map<string, any>();
  metadata = new Map<string, any>();
  attempts = new Map<string, any>();
  terminalDelay: (() => void) | undefined;
  events: any[] = [];
  calls: string[] = [];
  latest = 1;
  current: Record<string, any>;
  item: Record<string, any>;
  client: PoolClient;

  constructor(readonly source: IntakeSourceRow, readonly card: IntakeCard) {
    this.current = { id: source.case_id, revision: 3, archived: false, frame: null, context: null, site_id: null };
    this.item = { item_id: source.id, source_id: source.id, case_id: source.case_id, parent_item_id: null,
      member_path: null, name: source.name, family: card.family, format: card.format, size_bytes: source.bytes,
      size_class: 'S', wave: 2, state: 'probed', placement: 'undecided', card, card_sha256: null,
      probe_version: card.version, plan_ref: null, parts_planned: null, parts_done: 0, records_seen: 0,
      limit_reason: null, pinned_by_officer: false,
      created_at: '2026-10-22T00:00:00.000Z', updated_at: '2026-10-22T00:00:00.000Z' };
    this.client = Object.assign(new EventEmitter(), { query: this.query, release: () => {} }) as unknown as PoolClient;
  }

  sourceQuery(sql: string, args: any[]): any[] | undefined {
    if (sql.includes('FROM cases')) return args[0] === this.source.case_id ? [this.current] : [];
    if (sql.includes('max(revision)')) return [{ revision: this.latest }];
    if (sql.includes('FROM sources')) return [this.source];
    if (sql.startsWith('SELECT card FROM usp_intake_items')) return [{ card: this.item.card }];
    return undefined;
  }

  itemQuery(sql: string, args: any[]): any[] | undefined {
    if (sql.includes("plan_ref->>'nativeReaderJobId'=$2")) {
      const match = args[0] === this.source.case_id && args[1] === this.item.plan_ref?.nativeReaderJobId
        && args[2].includes(this.item.format);
      return match ? [{ item_id: this.item.item_id, source_id: this.item.source_id, card: this.item.card }] : [];
    }
    if (sql.startsWith('SELECT item_id,case_id,plan_ref') || sql.startsWith('SELECT state,placement,plan_ref')
      || sql.startsWith('SELECT * FROM usp_intake_items')) {
      return [this.item];
    }
    if (sql.startsWith('UPDATE usp_intake_items SET state=')) {
      Object.assign(this.item, { state: args[2], placement: args[3], plan_ref: args[4],
        records_seen: args[5], limit_reason: args[6] });
      return [];
    }
    if (sql.startsWith('SELECT item_id AS')) return [{ itemId: this.item.item_id, state: this.item.state,
      family: this.item.family, format: this.item.format, sizeClass: 'S', wave: 2, pinnedByOfficer: false }];
    return undefined;
  }

  jobQuery(sql: string, args: any[]): any[] | undefined {
    const derivative = "operation='intake-native-derivative'";
    if (sql.startsWith('INSERT INTO jobs')) {
      const operation = /VALUES\(\$1,\$2,\$3,'([a-z-]+)'/.exec(sql)![1];
      this.jobs.set(args[0], { id: args[0], case_id: args[1], source_id: args[2],
        operation, case_revision: args[3], input_fingerprint: args[4],
        payload: args[5], status: 'queued' });
      return [];
    }
    if (sql.includes(derivative)) {
      return [...this.jobs.values()]
        .filter(job => job.source_id === args[0] && job.operation === 'intake-native-derivative');
    }
    if (sql.includes('FROM jobs')) {
      if (sql.includes("operation='citygml-native' FOR UPDATE")) this.terminalDelay?.();
      const job = this.jobs.get(args[0]);
      return job ? [{ ...job, input_sha256: this.metadata.get(args[0])?.input_sha256 }] : [];
    }
    if (sql.startsWith('INSERT INTO usp_job_metadata')) {
      this.metadata.set(args[0], { logical_state: 'queued', input_sha256: args[2] });
      return [];
    }
    if (sql.includes('FROM usp_job_metadata')) return [this.metadata.get(args[0])];
    if (sql.includes('FROM usp_job_attempts')) {
      const attempt = this.attempts.get(args[0]);
      return attempt ? [attempt] : [];
    }
    if (sql.startsWith('INSERT INTO usp_job_attempts')) {
      const lease_until = new Date(Date.now() + 180_000);
      this.attempts.set(args[0], { number: args[1], fence: args[2], owner: args[3], input_sha256: args[4],
        state: 'active', lease_until });
      return [{ lease_until }];
    }
    if (sql.startsWith('UPDATE usp_job_attempts')) {
      const attempt = this.attempts.get(args[0]);
      if (attempt) {
        attempt.state = sql.includes("state='accepted'") ? 'accepted' : 'fenced';
        attempt.completion_sha256 = args[1];
      }
      return [];
    }
    if (sql.startsWith('UPDATE usp_job_metadata')) {
      const meta = this.metadata.get(args[0]);
      if (sql.includes("logical_state='succeeded'")) {
        Object.assign(meta, { logical_state: 'succeeded', result_ref: args[1], accepted_fence: args[2] });
      } else meta.logical_state = sql.includes("logical_state='running'") ? 'running' : 'failed';
      return [];
    }
    if (sql.startsWith('UPDATE jobs')) {
      let status = args[1];
      if (sql.includes("status='succeeded'")) status = 'succeeded';
      else if (sql.includes("status='running'")) status = 'running';
      Object.assign(this.jobs.get(args[0]), { status, error: args[2] });
      return [];
    }
    return undefined;
  }

  query = async (sql: string, args: any[] = []) => {
    this.calls.push(sql);
    let rows = this.sourceQuery(sql, args) ?? this.itemQuery(sql, args) ?? this.jobQuery(sql, args);
    if (sql.startsWith('SELECT set_config')) rows = [{ deadline_live: Date.now() < Date.parse(args[1]) }];
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('pg_advisory_xact_lock')) rows = [];
    if (sql.startsWith('INSERT INTO usp_outbox_streams')) rows = [];
    if (sql.startsWith('UPDATE usp_outbox_streams')) rows = [{ sequence: String(this.events.length + 1) }];
    if (sql.startsWith('INSERT INTO usp_outbox(')) {
      this.events.push(args[2]);
      rows = [];
    }
    if (!rows) throw new Error(`Unexpected protocol query: ${sql}`);
    return { rows: structuredClone(rows), rowCount: rows.length };
  };
}

async function batch(format: Format, profile = 'large-original-v1', bytes?: number) {
  const raw = sourceBytes(format), source = sourceRow(format, raw, profile, bytes);
  const card = await probeOriginal(async (start, end) => raw.subarray(start, end), raw.length, source.name);
  assert.equal(card.format, format);
  return new BatchProtocol(source, card);
}

function cityjsonSummary(raw: Buffer): CityJSONResult['summary'] {
  const script = 'import sys\nfrom geo.native_cityjson import read_cityjson, encode_cityjson_result\n'
    + 'sys.stdout.buffer.write(encode_cityjson_result(read_cityjson(sys.stdin.buffer.read())))';
  const output = execFileSync(process.env.ULPIN_NR1_PYTHON ?? 'python', ['-B', '-c', script], {
    cwd: new URL('../../../../../../services/geo', import.meta.url), input: raw, timeout: 20_000,
  });
  const native = JSON.parse(output.toString('utf8'));
  const geometries = native.objects.flatMap((object: any) => object.geometries);
  const keys = ['schemaVersion', 'status', 'sourceSha256', 'sourceBytes', 'objectCount', 'vertexCount',
    'boundaryIndexCount', 'decodedBounds', 'transformState', 'coordinateMode'];
  const summary = Object.fromEntries(keys.map(key => [key, native[key]]));
  return CityJSONSummarySchema.parse({ ...summary,
    supportedGeometryCount: geometries.filter((geometry: any) => geometry.status === 'supported').length,
    unsupportedGeometryCount: geometries.filter((geometry: any) => geometry.status === 'unsupported').length,
    referenceSystemState: native.frame.referenceSystemState, structuralReadingOnly: true,
    globalPlacement: 'not_qualified', watertightSolid: 'not_qualified',
    interiorFloors: 'not_established_by_reader', rights: 'not_assessed',
  });
}

function citygmlReading(path: string): Buffer {
  const value = JSON.parse(readFileSync(path).toString('utf8'));
  // Saved inventory literals are unchanged; only this test's lane bounds follow the current profile.
  Object.assign(value.limits, { input_bytes: CITYGML_LIMITS.originalBytes, output_bytes: CITYGML_LIMITS.artifactBytes,
    elements: CITYGML_LIMITS.elements, coordinate_values: CITYGML_LIMITS.coordinateValues });
  return Buffer.from(JSON.stringify(value));
}

function acceptedEnd(format: Format, fixture: BatchProtocol, jobId: string): IntakeNativeReaderEnd {
  const input = fixture.jobs.get(jobId).payload;
  if (format === 'dxf') return { format, summary: dxfSummary(
    readFileSync(`${dxfRoot}/runs/declared-final/drawing.json`), input) };
  if (format === 'citygml') return { format, summary: citygmlSummary(
    citygmlReading(`${gmlRoot}/run-02-lod2/projection.json`), input) };
  if (format === 'glb' || format === 'gltf') {
    return { format: 'gltf', summary: gltfSummary(readFileSync(inputs[format].reading), input) };
  }
  if (format === 'obj') return { format, summary: objSummary(readFileSync(inputs.obj.reading), input) };
  return { format, summary: cityjsonSummary(sourceBytes(format)) };
}

for (const format of Object.keys(inputs) as Format[]) {
  const input = inputs[format];
  const reader = input.reader;
  const present = existsSync(input.path);

  test(`${format}: batch receipt queues one native job; either replay finds the same job`, { skip: !present },
    async () => {
      const fixture = await batch(format);
      const { source, card, item, client, jobs, events } = fixture;
      const jobId = await queueIntakeDraftTx(client, source, card);
      assert.equal(jobId, intakeNativeReaderJobId(item.item_id, source, reader));
      assert.equal(jobs.size, 1);
      const payload = input.schema.parse(jobs.get(jobId!).payload);
      assert.deepEqual([payload.sourceId, payload.sourceSha256, payload.sourceBytes, payload.objectKey],
        [source.id, source.sha256, source.bytes, source.object_key]);
      assert.deepEqual([item.state, item.placement, item.plan_ref, item.limit_reason],
        ['reading', 'undecided', { nativeReaderJobId: jobId }, null]);
      assert.equal(IntakeItemSchema.parse(intakeItem(item)).nativeReaderJobId, jobId);
      assert.ok(events.some(event => event.change.kind === `${reader}-native.changed`));
      const published = events.length;
      assert.equal(await queueIntakeDraftTx(client, source, card), jobId);
      assert.equal(events.length, published);
      item.plan_ref = null;
      assert.equal(await queueIntakeDraftTx(client, source, card), jobId);
      assert.equal(jobs.size, 1);
      assert.notEqual(intakeNativeReaderJobId(item.item_id, { ...source, revision: 2 }, reader), jobId);
    });

  test(`${format}: a bounded native-profile receipt can also enrol in a batch`, { skip: !present }, async () => {
    const fixture = await batch(format, `${reader}-native-v1`);
    assert.ok(await queueIntakeDraftTx(fixture.client, fixture.source, fixture.card));
    assert.equal(fixture.jobs.size, 1);
    assert.equal(batchNativeReader({ ...fixture.source, profile: 'geojson-manual-v1' }, fixture.card), false);
  });

  test(`${format}: above its own byte limit nothing queues, with MiB limit words`, { skip: !present }, async () => {
    // Receipt-size control only: no oversized file is created, read or stored.
    const fixture = await batch(format, 'large-original-v1', input.limit + 1024 ** 2);
    assert.equal(await queueIntakeDraftTx(fixture.client, fixture.source, fixture.card), null);
    assert.equal(fixture.jobs.size, 0);
    assert.deepEqual([fixture.item.state, fixture.item.placement, fixture.item.plan_ref],
      ['probed', 'not_understood', null]);
    assert.ok(fixture.item.limit_reason.includes(`${input.limit / 1024 ** 2} MiB limit`));
    assert.doesNotMatch(fixture.item.limit_reason, /\d{5}|No reader in a batch/);
  });

  test(`${format}: batch authority rejects a changed card, binding or byte receipt`, { skip: !present }, async () => {
    const fixture = await batch(format), { source, item, client } = fixture;
    const receipt = source.inspection!.largeOriginal;
    assert.equal((await input.source(client, source.case_id, source.id)).source.id, source.id);
    item.card = { ...fixture.card, format: 'unknown' };
    await assert.rejects(input.source(client, source.case_id, source.id), { code: `${reader.toUpperCase()}_DENIED` });
    item.card = fixture.card;
    for (const patch of [{ operatorSubject: 'another-operator' }, { verifiedSha256: '0'.repeat(64) },
      { verifiedBytes: Number(source.bytes) + 1 }]) {
      source.inspection!.largeOriginal = { ...receipt, ...patch };
      await assert.rejects(input.source(client, source.case_id, source.id));
    }
    source.inspection!.largeOriginal = receipt;
    source.object_key += '-changed';
    await assert.rejects(input.source(client, source.case_id, source.id));
    source.object_key = source.object_key.replace('-changed', '');
    fixture.latest = 2;
    await assert.rejects(queueIntakeDraftTx(client, source, fixture.card), { status: 409 });
    assert.equal(fixture.jobs.size, 0);
  });

  test(`${format}: accepted summary remains candidate evidence, with no direct target`, { skip: !present },
    async () => {
      const fixture = await batch(format), { client, source, item } = fixture;
      const jobId = (await queueIntakeDraftTx(client, source, fixture.card))!;
      const end = acceptedEnd(format, fixture, jobId);
      assert.ok('summary' in end);
      if (format === 'cityjson') {
        // B3D1: a reading stating no reference system stays unplaced; one stating it is the next test.
        (end.summary as CityJSONResult['summary']).referenceSystemState = 'absent';
      }
      await settleIntakeNativeReaderTx(client, source.case_id, jobId, end);
      assert.ok(!fixture.calls.some(sql => /INSERT INTO (?:import_packages|usp_intake_targets|buildings)/.test(sql)));
      if (format === 'citygml') {
        assert.deepEqual([item.state, item.placement], ['reading', 'undecided']);
        assert.equal(fixture.jobs.size, 2);
        return;
      }
      assert.deepEqual([item.state, item.placement], ['read', 'undecided']);
      assert.equal(item.limit_reason, intakeNativeReadWords(end.summary));
      assert.match(item.limit_reason, /they are candidates/);
      assert.ok(item.limit_reason.includes(
        'kept as evidence and is not on the map yet; no record or card target is created'));
      assert.doesNotMatch(item.limit_reason, /No reader in a batch|\d+ (?:layers|surfaces|floors|units)/);
      const counts = { dxf: 'recordCount', citygml: 'elementCount', cityjson: 'objectCount', gltf: 'nodeCount',
        obj: 'polygonCount' };
      assert.equal(item.records_seen, (end.summary as any)[counts[reader]]);
      assert.equal(intakeItem(item).nativeReaderJobId, jobId);
      const published = fixture.events.length;
      await settleIntakeNativeReaderTx(client, source.case_id, jobId, end);
      await settleIntakeNativeReaderTx(client, randomUUID(), jobId, end);
      await settleIntakeNativeReaderTx(client, source.case_id, randomUUID(), end);
      assert.equal(fixture.events.length, published);
      assert.ok(!fixture.calls.some(sql => /INSERT INTO (?:import_packages|usp_intake_targets|buildings)/.test(sql)));
    });

  test(`${format}: failed and stale jobs settle their item in the same terminal transaction`, { skip: !present },
    async () => {
      for (const status of ['failed', 'stale'] as const) {
        const fixture = await batch(format), { client, source, item, jobs } = fixture;
        const jobId = (await queueIntakeDraftTx(client, source, fixture.card))!;
        globals.ulpinPool = { connect: async () => client, query: client.query } as unknown as Pool;
        const code = `${reader.toUpperCase()}_${status === 'stale' ? 'INPUT_STALE' : 'PROCESSING_FAILED'}`;
        if (status === 'stale') fixture.current.context = { changed: true };
        await input.fail(jobId, source.case_id, code);
        assert.deepEqual([jobs.get(jobId).status, item.state, item.placement], [status, 'read', 'not_understood']);
        assert.ok(item.limit_reason.includes(code));
        assert.match(item.limit_reason, status === 'stale' ? /went out of date/ : /reading stopped/);
        assert.equal(item.records_seen, 0);
        const terminal = fixture.calls.findIndex(sql => sql.startsWith('UPDATE jobs'));
        const settled = fixture.calls.findIndex((sql, index) => index > terminal
          && sql.startsWith('UPDATE usp_intake_items SET state='));
        assert.ok(terminal >= 0 && settled > terminal && fixture.calls.indexOf('COMMIT', settled) > settled);
      }
    });
}

test('DXF capacity failures name the current bounds and keep the original', {
  skip: !existsSync(inputs.dxf.path),
}, async () => {
  for (const code of ['DXF_ENTITY_LIMIT', 'DXF_OUTPUT_LIMIT']) {
    const fixture = await batch('dxf'), { client, source, item } = fixture;
    const original = structuredClone(source);
    const jobId = (await queueIntakeDraftTx(client, source, fixture.card))!;
    await settleIntakeNativeReaderTx(client, source.case_id, jobId, { format: 'dxf', status: 'failed', code });
    assert.deepEqual(source, original);
    assert.match(item.limit_reason, /The original is kept with its SHA-256/);
    const limit = code === 'DXF_ENTITY_LIMIT' ? DXF_LIMITS.entities.toLocaleString('en-IN') : DXF_LIMITS.pages;
    assert.ok(item.limit_reason.includes(String(limit)));
    if (code === 'DXF_OUTPUT_LIMIT') {
      assert.ok(item.limit_reason.includes(`${DXF_LIMITS.pageBytes / 1024 ** 2} MiB`));
      assert.ok(item.limit_reason.includes(`${DXF_LIMITS.artifactBytes / 1024 ** 2} MiB head`));
    }
    assert.equal(item.records_seen, 0);
  }
});

for (const format of ['cityjson', 'citygml'] as const) {
  test(`${format}: an accepted reading queues its outline conversion, citing the reading`, {
    skip: !existsSync(inputs[format].path),
  }, async () => {
    const fixture = await batch(format), { client, source, item, jobs } = fixture;
    const jobId = (await queueIntakeDraftTx(client, source, fixture.card))!;
    const end = acceptedEnd(format, fixture, jobId);
    if (format === 'cityjson') {
      assert.equal((end as { summary: CityJSONResult['summary'] }).summary.referenceSystemState, 'declared');
    }
    assert.ok(outlinesConverted(end));
    await settleIntakeNativeReaderTx(client, source.case_id, jobId, end);
    const [conversion] = [...jobs.values()].filter(job => job.operation === 'intake-native-derivative');
    assert.deepEqual([conversion.source_id, conversion.payload.itemId, conversion.payload.sourceSha256],
      [source.id, item.item_id, source.sha256]);
    assert.deepEqual([item.state, item.placement, item.plan_ref], ['reading', 'undecided', { nativeReaderJobId: jobId }]);
    const name = format === 'citygml' ? 'CityGML' : 'CityJSON';
    assert.equal(item.limit_reason, `The layers of this ${name} are being converted to GeoJSON, `
      + 'each to be taken in as its own file. Layers enter the map path once the whole conversion ends.');
    assert.equal(intakeItem(item).nativeReaderJobId, jobId);
    const published = fixture.events.length;
    await settleIntakeNativeReaderTx(client, source.case_id, jobId, end);
    assert.equal(jobs.size, 2);
    assert.equal(fixture.events.length, published);
    assert.ok(!fixture.calls.some(sql => /INSERT INTO (?:import_packages|usp_intake_targets|buildings)/.test(sql)));
    assert.equal(outlinesConverted({ format: 'dxf', summary: {} } as never), false);
    assert.equal(outlinesConverted({ format: 'citygml', status: 'failed', code: 'CITYGML_PROCESSING_FAILED' }), false);
  });
}

// Synthetic test_only CityGML; the native overflow below is an injected stop, not a claim about its size.
const memberControl = Buffer.from(`<CityModel xmlns="http://www.opengis.net/citygml/2.0"
  xmlns:gml="http://www.opengis.net/gml" xmlns:bldg="http://www.opengis.net/citygml/building/2.0">
  <gml:boundedBy><gml:Envelope srsName="urn:adv:crs:DE_DHDN_3GK3*DE_DHHN92_NH" srsDimension="3"/>
  </gml:boundedBy><cityObjectMember><bldg:Building gml:id="test-only-control">
  <bldg:lod0FootPrint><gml:MultiSurface><gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing>
  <gml:posList>0 0 7 2 0 7 2 2 7 0 0 7</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon>
  </gml:surfaceMember></gml:MultiSurface></bldg:lod0FootPrint></bldg:Building></cityObjectMember></CityModel>`);

async function memberBatch(name: string, zipped: boolean) {
  const source = sourceRow('citygml', memberControl, 'large-original-v1');
  source.name = name;
  const read = async (start: number, end: number) => memberControl.subarray(start, end);
  const card = await probeOriginal(read, memberControl.length, name);
  assert.equal(card.format, 'citygml');
  const fixture = new BatchProtocol(source, card);
  if (zipped) await enrolControlMember(fixture, name);
  return fixture;
}

async function enrolControlMember(fixture: BatchProtocol, name: string) {
  const pack = zipSync({ [`folder/${name}`]: memberControl });
  const card = await probeOriginal(async (start, end) => pack.subarray(start, end), pack.length, 'control.zip');
  const archiveId = randomUUID(), itemId = randomUUID();
  const archive = { ...fixture.source, id: archiveId, family_id: archiveId, name: 'control.zip',
    profile: 'zip-manual-v1', bytes: pack.length, sha256: sha256(pack),
    object_key: `sources/${archiveId}/${sha256(pack)}`, inspection: {}, created_at: new Date() };
  const member = { item_id: randomUUID(), member_path: `folder/${name}`, source_id: null as string | null,
    size_bytes: String(memberControl.length), card: card.members[0].card, limit_reason: null };
  const client = { query: async (sql: string, args: any[] = []) => {
    if (sql.startsWith('SELECT * FROM usp_intake_items')) {
      return { rows: [{ source_id: archiveId, card }], rowCount: 1 };
    }
    if (sql.startsWith('SELECT * FROM sources') && args[1] === archiveId) return { rows: [archive], rowCount: 1 };
    if (sql.startsWith('SELECT item_id,member_path')) return { rows: [member], rowCount: 1 };
    if (sql.startsWith('SELECT id FROM sources')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('UPDATE usp_intake_items SET source_id')) member.source_id = args[2];
    else if (!sql.startsWith('UPDATE usp_intake_items SET limit_reason')) return fixture.query(sql, args);
    return { rows: [], rowCount: 1 };
  } } as unknown as PoolClient;
  const dependencies: ZipLayerDependencies = {
    transaction: (async work => work(client)) as ZipLayerDependencies['transaction'],
    read: async (_key, start, end) => pack.subarray(start, end),
    retain: async () => assert.fail('A CityGML member must take the byte receipt, not the map route.'),
    retainMember: async (_caseId, _revision, file, lineage) => {
      assert.equal(file.name, name);
      assert.deepEqual(Buffer.from(file.bytes), memberControl);
      assert.equal(lineage.memberSha256, fixture.source.sha256);
      fixture.source.inspection!.archiveMember = lineage;
      return fixture.source.id;
    },
    register: async (_caseId, input) => {
      assert.equal((input as { sourceId: string }).sourceId, fixture.source.id);
      await queueIntakeDraftTx(fixture.client, fixture.source, fixture.card);
    },
    large: {} as never,
  };
  assert.deepEqual(await fanOutZipLayers(fixture.source.case_id, itemId, dependencies), [fixture.source.id]);
  assert.equal(member.source_id, fixture.source.id);
  assert.equal(fixture.jobs.size, 1);
}

test('a ZIP .xml member and the same .gml keep the output stop through a slow terminal lock', async t => {
  const epoch = Date.parse('2026-10-01T00:00:00Z');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: epoch });
  const words: unknown[] = [];
  for (const [name, zipped] of [['control.xml', true], ['control.gml', false]] as const) {
    const fixture = await memberBatch(name, zipped);
    const saved = structuredClone(fixture.source);
    const jobId = (await queueIntakeDraftTx(fixture.client, fixture.source, fixture.card))!;
    globals.ulpinPool = { connect: async () => fixture.client } as unknown as Pool;
    // A three-second case/job lock is longer than the old two-second terminal transaction allowance.
    fixture.terminalDelay = () => t.mock.timers.setTime(Date.now() + 3000);
    const started = Date.now();
    await runCityGMLJob(jobId, {
      tools: () => ({} as never), read: async () => memberControl,
      process: async () => {
        t.mock.timers.setTime(Date.now() + 21_000);
        throw new AppError(413, 'CITYGML_OUTPUT_LIMIT', 'Injected inventory output bound.');
      },
    });
    const native = fixture.jobs.get(jobId);
    assert.equal(native.status, 'failed');
    assert.equal(native.error, 'CITYGML_OUTPUT_LIMIT');
    assert.equal(Date.now() - started, 24_000);
    assert.ok(Date.now() < fixture.attempts.get(jobId).lease_until.getTime());
    assert.equal(fixture.attempts.get(jobId).state, 'fenced');
    assert.deepEqual([...fixture.jobs.values()].map(job => job.operation),
      ['citygml-native', 'intake-native-derivative']);
    await settleIntakeNativeReaderTx(fixture.client, fixture.source.case_id, jobId,
      { format: 'citygml', status: 'failed', code: native.error });
    assert.equal(fixture.jobs.size, 2);
    words.push(readingOf(fixture.item, fixture.card,
      { nativeStopped: { format: 'citygml', code: native.error } }));
    assert.deepEqual(fixture.source, saved);
  }
  assert.deepEqual(words[0], words[1]);
});

test('a native read exceeding its work deadline records TIMEOUT inside the 150s total and 180s lease', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse('2026-10-01T00:00:00Z') });
  const fixture = await memberBatch('control.xml', true);
  const jobId = (await queueIntakeDraftTx(fixture.client, fixture.source, fixture.card))!;
  globals.ulpinPool = { connect: async () => fixture.client } as unknown as Pool;
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const started = Date.now();
  fixture.terminalDelay = () => t.mock.timers.setTime(Date.now() + 3000);
  const work = runCityGMLJob(jobId, {
    tools: () => ({} as never), read: async () => memberControl,
    process: async (_input, _source, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        // Model both bounded reaper phases (5s verification and 5s exit), before terminal SQL starts.
        t.mock.timers.setTime(Date.now() + 10_000);
        reject(signal.reason);
      }, { once: true });
      entered();
    }),
  });
  await ready;
  t.mock.timers.tick(CITYGML_LIMITS.workerMs - 15_000);
  await new Promise<void>(resolve => setImmediate(resolve));
  if (fixture.jobs.get(jobId).status === 'running') t.mock.timers.tick(15_000);
  await work;
  assert.equal(fixture.jobs.get(jobId).error, 'CITYGML_TIMEOUT');
  assert.equal(fixture.attempts.get(jobId).state, 'fenced');
  assert.equal(Date.now() - started, 148_000);
  assert.ok(Date.now() - started <= CITYGML_LIMITS.workerMs);
  assert.ok(Date.now() < fixture.attempts.get(jobId).lease_until.getTime());
});

const outlinePython = process.env.ULPIN_GEO_PYTHON
  ?? 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const memberOutlineScript = `
import hashlib, json, sys, tempfile
from pathlib import Path
sys.path.insert(0, 'services/geo')
from geo.native_gis import convert_native_file
from geo.native_citygml import extract, encode_result
raw = sys.stdin.buffer.read()
folder = Path(tempfile.mkdtemp())
path = folder / sys.argv[1]
path.write_bytes(raw)
layers = convert_native_file(path, 'citygml', folder / 'out', hashlib.sha256(raw).hexdigest())
print(json.dumps({'native': encode_result(extract(raw)).decode('utf-8'), 'layers': layers}))
`;

test('ZIP .xml and standalone .gml outline reads give identical words and leave an unlisted AdV system unplaced', {
  skip: !existsSync(outlinePython),
}, async () => {
  const readings: unknown[] = [];
  for (const [name, zipped] of [['control.xml', true], ['control.gml', false]] as const) {
    const fixture = await memberBatch(name, zipped);
    const jobId = (await queueIntakeDraftTx(fixture.client, fixture.source, fixture.card))!;
    const { native, layers } = JSON.parse(execFileSync(outlinePython, ['-B', '-c', memberOutlineScript, name], {
      input: memberControl, encoding: 'utf8', timeout: 20_000,
    }));
    const summary = citygmlSummary(Buffer.from(native), fixture.jobs.get(jobId).payload);
    assert.equal(summary.buildingAndPartCount, 1);
    await settleIntakeNativeReaderTx(fixture.client, fixture.source.case_id, jobId, { format: 'citygml', summary });
    assert.deepEqual([...fixture.jobs.values()].map(job => job.operation),
      ['citygml-native', 'intake-native-derivative']);
    assert.equal(layers[0].state, 'not_converted');
    assert.match(layers[0].reason, /srsName form the reader does not know/);
    const dependencies: NativeDerivativeDependencies = {
      transaction: (async work => work(fixture.client)) as NativeDerivativeDependencies['transaction'],
      convert: async request => {
        assert.equal(request.format, 'citygml');
        assert.equal(request.sha256, sha256(memberControl));
        return { conversion: 'native_gis_to_geojson@1', readerVersion: 'citygml-ground-outline/1',
          sourceId: fixture.source.id, sourceSha256: request.sha256, layers };
      },
      read: async () => assert.fail('An unplaced layer has no derivative object.'),
      register: async () => assert.fail('An unplaced layer must not enrol a map original.'),
      large: {} as never,
    };
    assert.deepEqual(await convertNativeLayers(fixture.source.case_id, fixture.item.item_id, dependencies), []);
    assert.deepEqual([fixture.item.state, fixture.item.placement], ['read', 'not_understood']);
    assert.equal(fixture.item.plan_ref.nativeReaderJobId, jobId);
    assert.match(fixture.item.limit_reason, /urn:adv:crs:DE_DHDN_3GK3\*DE_DHHN92_NH/);
    readings.push(readingOf(fixture.item, fixture.card, { native: summary }));
    assert.equal(fixture.source.sha256, sha256(memberControl));
  }
  assert.deepEqual(readings[0], readings[1]);
});

test('CityGML inventory within 16 MiB is accepted, stored, read back and queues its outline derivative', {
  skip: !existsSync(`${gmlRoot}/run-02-lod2/receipt.json`),
}, async t => {
  const fixture = await batch('citygml');
  const jobId = (await queueIntakeDraftTx(fixture.client, fixture.source, fixture.card))!;
  const job = fixture.jobs.get(jobId);
  const input = job.payload;
  const native = Buffer.from(citygmlReading(`${gmlRoot}/run-02-lod2/projection.json`));
  assert.ok(native.length <= CITYGML_LIMITS.artifactBytes);
  const summary = citygmlSummary(native, input);
  input.tools = { platform: 'windows-x86_64', readerSha256: input.readerSha256,
    pythonSha256: 'a'.repeat(64), profileSha256: 'a'.repeat(64), supervisorSha256: 'a'.repeat(64),
    dependencyLockSha256: 'a'.repeat(64), codeSha256: 'a'.repeat(64) };
  job.input_fingerprint = fingerprint(input);
  fixture.metadata.get(jobId).input_sha256 = fingerprint(input);
  const supervision = JSON.parse(readFileSync(`${gmlRoot}/run-02-lod2/receipt.json`, 'utf8')).execution;
  const stored = new Map<string, Buffer>([[fixture.source.object_key, sourceBytes('citygml')]]);
  const require = createRequire(new URL('../../../../package.json', import.meta.url));
  const { S3Client } = require('@aws-sdk/client-s3');
  const names = ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'];
  const previous = names.map(name => process.env[name]);
  process.env.S3_ENDPOINT = 'http://127.0.0.1:1';
  process.env.S3_ACCESS_KEY = process.env.S3_SECRET_KEY = 'test-only-memory-storage';
  closeStorageClient();
  t.after(() => {
    closeStorageClient();
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  });
  t.mock.method(S3Client.prototype, 'send', async (command: any) => {
    const key = command.input.Key;
    if (command.constructor.name === 'PutObjectCommand') {
      assert.equal(command.input.IfNoneMatch, '*');
      stored.set(key, Buffer.from(command.input.Body));
      return {};
    }
    assert.equal(command.constructor.name, 'GetObjectCommand');
    const bytes = stored.get(key)!;
    return { Body: Readable.from([bytes]), ContentLength: bytes.length, ETag: 'test-only-memory-object' };
  });
  globals.ulpinPool = { connect: async () => fixture.client } as unknown as Pool;
  await runCityGMLJob(jobId, { tools: () => ({} as never),
    process: async (_input, original) => {
      assert.equal(sha256(original), fixture.source.sha256);
      return { bytes: native, hash: sha256(native), summary, supervision };
    } });
  assert.equal(job.status, 'succeeded', job.error);
  assert.equal(fixture.attempts.get(jobId).state, 'accepted');
  const asset = fixture.metadata.get(jobId).result_ref;
  const receipt = await readCityGMLResult(input, asset.sha256, Number(asset.assetId.split(':').at(-1)));
  assert.equal(receipt.artifact.bytes, native.length);
  assert.equal(sha256(await boundedCityGMLObject(receipt.artifact.key, receipt.artifact.bytes)), sha256(native));
  assert.deepEqual([...fixture.jobs.values()].map(row => row.operation),
    ['citygml-native', 'intake-native-derivative']);
  assert.equal(receipt.summary.registryAdmission, false);
  assert.equal(sha256(stored.get(fixture.source.object_key)!), fixture.source.sha256);
  assert.ok(!fixture.calls.some(sql => /INSERT INTO (?:import_packages|usp_intake_targets|buildings)/.test(sql)));
});

test('CityGML byte-derived coordinate allowance keeps old and new small inventories readable', {
  skip: !existsSync(`${gmlRoot}/run-02-lod2/projection.json`),
}, () => {
  const raw = sourceBytes('citygml');
  const input = { sourceSha256: sha256(raw), sourceBytes: raw.length } as any;
  const previous = citygmlReading(`${gmlRoot}/run-02-lod2/projection.json`);
  const value = JSON.parse(previous.toString());
  value.limits.coordinate_values = Math.floor((CITYGML_LIMITS.originalBytes + 1) / 2);
  assert.deepEqual(citygmlSummary(Buffer.from(JSON.stringify(value)), input), citygmlSummary(previous, input));
  value.limits.coordinate_values += 1;
  assert.throws(() => citygmlSummary(Buffer.from(JSON.stringify(value)), input));
});

test('oversized CityGML inventory stops before JSON decoding and names the finite bound', async () => {
  assert.equal(CITYGML_LIMITS.artifactBytes, 16 * 1024**2);
  let stop: AppError | undefined;
  try { citygmlSummary(Buffer.alloc(CITYGML_LIMITS.artifactBytes + 1), {} as never); }
  catch (error) { stop = error as AppError; }
  assert.equal(stop?.status, 413);
  assert.equal(stop?.code, 'CITYGML_OUTPUT_LIMIT');
  assert.match(stop!.message, /16 MiB limit; the unchanged original is kept with its SHA-256/);
  const fixture = await memberBatch('control.gml', false);
  const jobId = (await queueIntakeDraftTx(fixture.client, fixture.source, fixture.card))!;
  globals.ulpinPool = { connect: async () => fixture.client } as unknown as Pool;
  await runCityGMLJob(jobId, { tools: () => ({} as never), read: async () => memberControl,
    process: async () => { throw stop; } });
  assert.equal(fixture.jobs.get(jobId).error, 'CITYGML_OUTPUT_LIMIT');
  assert.equal(fixture.jobs.get(jobId).status, 'failed');
  const reading = readingOf(fixture.item, fixture.card,
    { nativeStopped: { format: 'citygml', code: 'CITYGML_OUTPUT_LIMIT' } });
  assert.ok(reading.holds.some(entry => entry.words.includes('(16 MiB)')));
  assert.deepEqual([...fixture.jobs.values()].map(job => job.operation),
    ['citygml-native', 'intake-native-derivative']);
  assert.equal(fixture.item.state, 'reading');
  assert.equal(fixture.item.plan_ref.nativeReaderJobId, jobId);
});

test('only failed CityGML inventory overflow queues a separate outline conversion', {
  skip: !existsSync(inputs.citygml.path),
}, async () => {
  for (const [status, code, converts] of [
    ['failed', 'CITYGML_OUTPUT_LIMIT', true],
    ['failed', 'CITYGML_PROCESSING_FAILED', false],
    ['failed', 'CITYGML_STRUCTURE_LIMIT', false],
  ] as const) {
    const fixture = await batch('citygml'), { client, source, item, jobs } = fixture;
    const jobId = (await queueIntakeDraftTx(client, source, fixture.card))!;
    globals.ulpinPool = { connect: async () => client, query: client.query } as unknown as Pool;
    await failCityGMLJob(jobId, source.case_id, code);
    assert.equal(jobs.get(jobId).status, status);
    assert.equal(jobs.get(jobId).error, code);
    assert.equal(outlinesConverted({ format: 'citygml', status, code }), converts);
    const conversions = [...jobs.values()].filter(job => job.operation === 'intake-native-derivative');
    assert.equal(conversions.length, converts ? 1 : 0);
    if (converts) {
      assert.equal(conversions[0].payload.sourceSha256, source.sha256);
      assert.equal(item.plan_ref.nativeReaderJobId, jobId);
      await settleIntakeNativeReaderTx(client, source.case_id, jobId, { format: 'citygml', status, code });
      assert.equal(jobs.size, 2);
    } else {
      assert.deepEqual([item.state, item.placement], ['read', 'not_understood']);
      assert.ok(item.limit_reason.includes(code));
    }
  }
  assert.equal(outlinesConverted({ format: 'citygml', status: 'stale', code: 'CITYGML_OUTPUT_LIMIT' }), false);
  for (const format of ['dxf', 'cityjson', 'gltf', 'obj'] as const) {
    assert.equal(outlinesConverted({ format, status: 'failed', code: 'CITYGML_OUTPUT_LIMIT' }), false);
  }
});

test('a partial CityGML summary stays partial and never invents a surface count or CRS', {
  skip: !existsSync(`${gmlRoot}/run-02-local/projection.json`),
}, () => {
  const raw = readFileSync(`${gmlRoot}/originals/Building_LOD1-LocalEngineeringCRS.gml`);
  const summary = citygmlSummary(citygmlReading(`${gmlRoot}/run-02-local/projection.json`),
    { sourceSha256: sha256(raw), sourceBytes: raw.length } as any);
  assert.equal(summary.status, 'partial');
  const words = intakeNativeReadWords(summary);
  assert.match(words, /reading is partial/);
  for (const code of summary.findingCodes) assert.ok(words.includes(code));
  assert.doesNotMatch(words, /\d+ surfaces|EPSG:/);
});

test('the difficult real R12 DXF keeps absent units absent, not zero or a guessed CRS', {
  skip: !existsSync(`${dxfRoot}/runs/absent-final/drawing.json`),
}, () => {
  const raw = readFileSync(`${dxfRoot}/sources/ASCII_R12.dxf`);
  const summary = dxfSummary(readFileSync(`${dxfRoot}/runs/absent-final/drawing.json`),
    { sourceSha256: sha256(raw), sourceBytes: raw.length } as any);
  assert.match(intakeNativeReadWords(summary), /Drawing units: absent/);
  assert.match(intakeNativeReadWords(summary), /summary states no coordinate reference system/);
  assert.doesNotMatch(intakeNativeReadWords(summary), /EPSG|0 metres/);
});

test('a GLB reading states its node and primitive counts and stays unplaced: a glTF states no CRS', {
  skip: !existsSync(inputs.glb.reading),
}, async () => {
  const fixture = await batch('glb'), { client, source, item } = fixture;
  const jobId = (await queueIntakeDraftTx(client, source, fixture.card))!;
  const end = acceptedEnd('glb', fixture, jobId) as Extract<IntakeNativeReaderEnd, { format: 'gltf' }>;
  await settleIntakeNativeReaderTx(client, source.case_id, jobId, end);
  assert.deepEqual([end.summary.nodeCount, end.summary.primitiveCount, end.summary.projectedPositions], [2, 1, 24]);
  assert.ok(item.limit_reason.startsWith('The glTF reading is complete. It states 2 nodes and 1 mesh primitive; '
    + 'they are candidates. Positions read: 24;'));
  assert.equal(item.records_seen, 2);
  assert.match(item.limit_reason,
    /Placement on the earth: not stated\. A glTF states no coordinate reference system, /);
  assert.match(item.limit_reason, /so the model stays unplaced/);
  assert.doesNotMatch(item.limit_reason, /EPSG|metres|buildings?\b|unknown/);
});

test('the difficult external-buffer glTF and an OBJ missing its material settle as partial readings', {
  skip: !existsSync(inputs.gltf.reading) || !existsSync(`${objRoot}/partial-run01/obj.json`),
}, async () => {
  const gltf = await batch('gltf');
  const gltfJob = (await queueIntakeDraftTx(gltf.client, gltf.source, gltf.card))!;
  await settleIntakeNativeReaderTx(gltf.client, gltf.source.case_id, gltfJob, acceptedEnd('gltf', gltf, gltfJob));
  assert.match(gltf.item.limit_reason,
    /reading is partial\. .* Positions read: 0; companion files joined: 0; still missing: 1 \("Box0\.bin"\);/);
  const raw = readFileSync(`${objRoot}/missing_material_file.obj`);
  const summary = objSummary(readFileSync(`${objRoot}/partial-run01/obj.json`),
    { sourceSha256: sha256(raw), sourceBytes: raw.length } as any);
  const words = intakeNativeReadWords(summary);
  assert.match(words, /^The OBJ reading is partial\./);
  assert.ok(words.includes(`companion declarations not supplied: ${summary.missingCompanionDeclarationCount}.`));
  assert.ok(words.includes('Axes: not stated; units: not stated; coordinate reference system: not stated, '
    + 'so the model stays unplaced.'));
  assert.doesNotMatch(words, /unknown/);
});
