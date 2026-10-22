import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';
import type { Pool, PoolClient } from 'pg';
import {
  CITYGML_LIMITS, CITYJSON_LIMITS, DXF_LIMITS, GLTF_LIMITS, OBJ_LIMITS, CityGMLInputSchema, CityJSONInputSchema,
  CityJSONSummarySchema, DXFInputSchema, GltfInputSchema, IntakeItemSchema, ObjInputSchema, type CityJSONResult,
  type IntakeCard,
} from '@ulpin/contracts/usp';
import { sha256 } from '../../../infrastructure/storage';
import { citygmlSourceTx } from './citygml';
import { failCityGMLJob } from './citygml-worker';
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
    if (sql.includes('FROM jobs')) return this.jobs.has(args[0]) ? [this.jobs.get(args[0])] : [];
    if (sql.startsWith('INSERT INTO usp_job_metadata')) {
      this.metadata.set(args[0], { logical_state: 'queued' });
      return [];
    }
    if (sql.includes('FROM usp_job_metadata')) return [this.metadata.get(args[0])];
    if (sql.includes('FROM usp_job_attempts') || sql.startsWith('UPDATE usp_job_attempts')) return [];
    if (sql.startsWith('UPDATE usp_job_metadata')) {
      this.metadata.get(args[0]).logical_state = 'failed';
      return [];
    }
    if (sql.startsWith('UPDATE jobs')) {
      Object.assign(this.jobs.get(args[0]), { status: args[1], error: args[2] });
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

function acceptedEnd(format: Format, fixture: BatchProtocol, jobId: string): IntakeNativeReaderEnd {
  const input = fixture.jobs.get(jobId).payload;
  if (format === 'dxf') return { format, summary: dxfSummary(
    readFileSync(`${dxfRoot}/runs/declared-final/drawing.json`), input) };
  if (format === 'citygml') return { format, summary: citygmlSummary(
    readFileSync(`${gmlRoot}/run-02-lod2/projection.json`), input) };
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
      + 'each to be taken in as its own file.');
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

test('a partial CityGML summary stays partial and never invents a surface count or CRS', {
  skip: !existsSync(`${gmlRoot}/run-02-local/projection.json`),
}, () => {
  const raw = readFileSync(`${gmlRoot}/originals/Building_LOD1-LocalEngineeringCRS.gml`);
  const summary = citygmlSummary(readFileSync(`${gmlRoot}/run-02-local/projection.json`),
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
