import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { SourceProfileSchema, StreamedProfileGenerationSchema, StreamedMappingReceiptSchema,
  IntakeItemPlanSchema, STREAMING_VECTOR_LIMITS as limits, streamingReadMs, type IntakeCard }
  from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { localOperatorSubject } from '../principal';
import { fingerprint } from '../../cases/domain';
import type { IntakeSourceRow } from './intake-context';
import { probeOriginal } from './intake-probe';
import { intakeItem } from './intake-ledger';
import { nativeDerivativeFormat, queueIntakeDraftTx } from './intake-draft';
import { convertNativeLayers, nativeParentState, NativeConversionSchema, queueNativeDerivativeTx, stateLayerCrsTx,
  NativeDerivativeLineageSchema, nativeConverterLayout, nativeConverterPin, assertConverterLayoutTx,
  type NativeDerivativeDependencies } from './intake-native-derivative';
import { converterIntakeProposal, lookupIntakeMemory } from './intake-draft-worker';
import { compileMapping } from './registry';
import { recordConverterLayoutTx } from './intake-large-worker';
import { intakeLargePhase, intakeLargeRows, intakeLargePlan, type IntakeLargeStore } from './intake-large';
import { assertStreamedIssuerEvidence } from './streamed-mapping';
import { IntakeService } from './intake-service';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { streamedSourceReference } from './streamed-map-receipt';
import { convert as requestConversion } from './intake-native-derivative-worker';
import { settleIntakeNativeReaderTx } from './intake-native-readers';
import { readingOf } from './intake-reading';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'native-derivative-protocol';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
// The geo service's own Python and the data drive's real test originals; a box without them skips these tests.
const python = process.env.ULPIN_GEO_PYTHON ?? 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const ready = existsSync(python) && existsSync('E:/BhuAayam-data/datasets/map-formats/niagara-falls');

/**
 * A GeoPackage of real test_only outlines built once in `folder`: Niagara, Tweed, and Tweed with its CRS removed (its
 * column and every geometry header name the undefined system -1). Each run is the real native conversion of it,
 * with the officer's answers if any.
 */
const script = `
import hashlib, json, sqlite3, struct, sys, tempfile
from pathlib import Path
sys.path.insert(0, 'services/geo'); sys.path.insert(0, 'services/geo/tests')
from geo.native_gis import convert_native_file
from test_native_conversion import TWEED_GPKG, niagara_gpkg
folder, answers = Path(sys.argv[1]), json.loads(sys.argv[2])
path = folder / 'niagara.gpkg'
if not path.exists():
    niagara_gpkg(folder, 2500)
    with sqlite3.connect(path) as db:
        db.execute("ATTACH ? AS tweed", (str(TWEED_GPKG),))
        db.execute('CREATE TABLE "buildings" AS SELECT * FROM tweed.Council_Buildings')
        db.execute("INSERT INTO gpkg_contents VALUES('buildings','features')")
        db.execute("INSERT INTO gpkg_geometry_columns VALUES('buildings','SHAPE',28356,0,0)")
        db.execute("INSERT INTO gpkg_spatial_ref_sys SELECT srs_id,organization,organization_coordsys_id,definition "
                   "FROM tweed.gpkg_spatial_ref_sys WHERE srs_id=28356")
        db.execute('CREATE TABLE "unstated" AS SELECT * FROM tweed.Council_Buildings')
        db.execute("INSERT INTO gpkg_contents VALUES('unstated','features')")
        db.execute("INSERT INTO gpkg_geometry_columns VALUES('unstated','SHAPE',-1,0,0)")
        db.create_function('undefined', 1, lambda blob: blob[:4] + struct.pack('<i', -1) + blob[8:])
        db.execute('UPDATE "unstated" SET SHAPE=undefined(SHAPE)')
out = Path(tempfile.mkdtemp(dir=folder))
raw = path.read_bytes()
print(json.dumps({'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
  'layers': convert_native_file(path, 'gpkg', out, hashlib.sha256(raw).hexdigest(), answers)}))`;

function converted(folder: string, answers: Record<string, string> = {}) {
  return JSON.parse(execFileSync(python, ['-B', '-c', script, folder, JSON.stringify(answers)], { encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));
}

/** Each converted layer's GeoJSON and sidecar are put in `files` under the keys the geo service stores them by. */
function stored(result: any, files: Map<string, Buffer>) {
  return result.layers.map((layer: any) => {
    if (layer.state !== 'converted') return layer;
    for (const name of ['geojson', 'sidecar']) {
      const objectKey = `native-derivatives/${result.sha256}/${layer.ordinal}/${name}-${layer[name].sha256}`;
      files.set(objectKey, readFileSync(layer[name].path));
      layer[name] = { objectKey, bytes: layer[name].bytes, sha256: layer[name].sha256 };
    }
    return layer;
  });
}

const caseId = '30000000-0000-4000-8000-000000000001';
const itemId = '30000000-0000-4000-8000-000000000002';
const sourceId = '30000000-0000-4000-8000-000000000003';

function retained(id: string, bytes: number, hash: string, name: string,
  inspection: Record<string, unknown> = {}): IntakeSourceRow & { inspection: Record<string, any> } {
  return { id, case_id: caseId, family_id: id, revision: 1, bytes, sha256: hash, profile: 'large-original-v1',
    object_key: `large-originals/${id}/${hash}`, name, status: 'needs_input', inspection: { ...inspection,
      largeOriginal: { uploadId: id, operatorSubject: localOperatorSubject(), objectEtag: 'etag',
        verifiedSha256: hash, verifiedBytes: bytes, conversion: 'unsupported',
        bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed',
        provenance: { origin: 'not_stated', acquiredAt: '2026-10-20T00:00:00.000Z', state: 'not_stated' } } } };
}

/** The statements the conversion job issues, over in-memory rows; any other statement fails the test. */
function ledger(original: ReturnType<typeof retained>) {
  const sources = new Map<string, any>([[original.id, original]]);
  const jobs: any[] = [];
  const uploads: any[] = [];
  const item = { item_id: itemId, case_id: caseId, source_id: original.id, parent_item_id: null,
    card: { format: 'geopackage', family: 'vector' }, state: 'reading', placement: 'undecided', plan_ref: null as any,
    records_seen: 0, limit_reason: 'converting', family: 'vector', format: 'geopackage', size_class: 'L', wave: 1,
    pinned_by_officer: false };
  const client = { query: async (sql: string, values: any[] = []) => {
    const rows = ((): any[] | null => {
      if (sql.startsWith('SELECT * FROM usp_intake_items')
        || sql.startsWith('SELECT item_id,source_id,card FROM usp_intake_items')) return [item];
      if (sql.startsWith('SELECT id,revision,archived FROM cases')) {
        return [{ id: caseId, revision: 4, archived: false }];
      }
      if (sql.startsWith('SELECT revision FROM cases')) return [{ revision: 4 }];
      if (sql.startsWith('SELECT * FROM sources')) return [sources.get(values[1])];
      if (sql.startsWith('SELECT id FROM sources')) return [...sources.values()].filter(row =>
        row.sha256 === values[1] && Number(row.bytes) === values[3]
          && fingerprint(row.inspection.nativeDerivative ?? null) === fingerprint(values[2]));
      if (sql.startsWith('SELECT s.id,u.body')) return uploads.filter(upload => {
        const row = sources.get(upload.source_id);
        return row && !row.inspection.nativeDerivative && upload.body.batchSourceId === values[1]
          && (row.name === values[2] || row.sha256 === values[3]);
      }).map(upload => ({ id: upload.source_id, body: upload.body, operator_subject: upload.operator_subject }));
      if (sql.startsWith('UPDATE sources')) {
        sources.get(values[0]).inspection.nativeDerivative = values[1];
        return [];
      }
      if (sql.startsWith('SELECT state,placement,plan_ref')) return [item];
      if (sql.startsWith('UPDATE usp_intake_items SET state=')) {
        Object.assign(item, { state: values[2], placement: values[3], plan_ref: values[4], limit_reason: values[6] });
        return [];
      }
      if (sql.startsWith('SELECT item_id AS')) return [{ itemId, state: item.state, family: 'vector',
        format: 'geopackage', sizeClass: 'L', wave: 1, pinnedByOfficer: false }];
      if (sql.startsWith('UPDATE usp_outbox_streams')) return [{ sequence: '1' }];
      if (sql.startsWith('INSERT INTO usp_outbox')) return [];
      if (sql.startsWith('SELECT pg_advisory')) return [];
      if (sql.startsWith('SELECT 1 FROM jobs')) return jobs.filter(job => job.status === 'running');
      if (sql.startsWith('SELECT id,status')) return jobs;
      if (sql.startsWith('INSERT INTO jobs')) {
        jobs.push({ id: values[0], case_id: values[1], source_id: values[2], operation: 'intake-native-derivative',
          case_revision: values[3], input_fingerprint: values[4], payload: values[5], status: 'queued' });
        return [];
      }
      if (sql.startsWith('SELECT * FROM jobs')) return jobs.filter(job => job.id === values[0]);
      if (sql.startsWith('SELECT * FROM usp_job_metadata') || sql.startsWith('INSERT INTO usp_job_metadata')) return [];
      return null;
    })();
    if (!rows) throw new Error(`Unexpected SQL: ${sql}`);
    return { rows, rowCount: rows.length };
  } } as unknown as PoolClient;
  return { client, sources, item, jobs, uploads };
}

/** The byte receipt /uploads drives, standing in for storage: it hashes each part and keeps the bytes it was sent. */
function receipt(sources: Map<string, any>, kept: Map<string, Buffer>, afterFinalize = () => {},
  onCreate = () => {}) {
  let parts: Buffer[] = [];
  let file: { filename: string; sha256: string; bytes: number };
  return {
    create: async (_case: string, input: any, batchSourceId?: string) => {
      // TC2: each layer's receipt names the converted file as its batch item.
      assert.equal(batchSourceId, sourceId);
      onCreate();
      file = input;
      parts = [];
      return { id: randomUUID(), revision: 1, currentCaseRevision: 4 };
    },
    claimPart: async (_case: string, id: string) => ({ id }),
    receivePart: async (_claim: unknown, bytes: Uint8Array) => {
      parts.push(Buffer.from(bytes));
      return { id: 'upload', revision: 1 + parts.length, currentCaseRevision: 4 };
    },
    failPart: async () => {},
    finalize: async (_case: string, _id: string, input: { sha256: string }, lineage?: unknown) => {
      const bytes = Buffer.concat(parts);
      assert.equal(sha(bytes), input.sha256);
      const id = randomUUID();
      sources.set(id, retained(id, bytes.length, input.sha256, file.filename,
        lineage ? { nativeDerivative: lineage } : {}));
      kept.set(id, bytes);
      afterFinalize();
      return { source: { sourceId: id } };
    },
    abort: async () => {},
  } as unknown as NativeDerivativeDependencies['large'];
}

for (const busySlot of [false, true]) {
  test(`a GeoPackage of 2,500 outlines and Tweed's 88: two children kept once (slot busy: ${busySlot})`,
    { skip: !ready }, async () => {
    const result = converted(mkdtempSync(join(tmpdir(), 'native-derivative-')));
    const files = new Map<string, Buffer>();
    const layers = stored(result, files);
    const original = retained(sourceId, result.bytes, result.sha256, 'outlines.gpkg');
    const { client, sources, item } = ledger(original);
    const kept = new Map<string, Buffer>();
    const registered: any[] = [];
    let conversions = 0;
    const dependencies: NativeDerivativeDependencies = {
      transaction: (async (work: (c: PoolClient) => unknown) => work(client)) as
        NativeDerivativeDependencies['transaction'],
      read: async (key, start, end) => files.get(key)!.subarray(start, end),
      convert: async request => {
        conversions++;
        assert.deepEqual(request, { sourceId, objectKey: original.object_key, sha256: result.sha256,
          bytes: result.bytes, format: 'gpkg' });
        return { conversion: 'native_gis_to_geojson@1', readerVersion: 'native-gis-window/1', sourceId,
          sourceSha256: result.sha256, layers };
      },
      register: async (_case, input) => { registered.push(input); return {}; },
      large: receipt(sources, kept),
    };
    let waits = 0, busy = busySlot;
    const create = dependencies.large.create;
    dependencies.large.create = async (...args) => {
      if (busy) throw new AppError(429, 'UPLOAD_QUOTA', 'Slots are busy.',
        { limit: 'open_receipts_case', freesAt: null });
      return create(...args);
    };
    dependencies.waitForSlot = async () => {
      waits++;
      assert.equal(item.state, 'reading');
      assert.match(item.limit_reason, /Converted and waiting for a free upload slot: buildings/);
      assert.match(item.limit_reason, /buildings \(88 written, 0 not written\)/);
      assert.doesNotMatch(item.limit_reason, /enrol the file again/);
      assert.equal(kept.size, 0);
      assert.equal(registered.length, 0);
      busy = false;
    };
    const children = await convertNativeLayers(caseId, itemId, dependencies);
    assert.equal(waits, Number(busySlot));
    assert.equal(children.length, 2);
    assert.deepEqual(children.map(id => sources.get(id).inspection.nativeDerivative.layer),
      ['buildings', 'footprints']);
    const child = sources.get(children[1]);
    assert.equal(child.name, 'footprints.geojson');
    assert.equal(nativeConverterLayout(child), null, 'A generic source layer still needs its kind stated.');
    assert.deepEqual({ ...child.inspection.nativeDerivative, sidecar: undefined }, { version: 'native-derivative/1',
      conversion: 'native_gis_to_geojson@1', readerVersion: 'native-gis-window/1', originalSourceId: sourceId,
      originalSourceRevision: 1, originalSha256: result.sha256, originalItemId: itemId, format: 'gpkg',
      layer: 'footprints', ordinal: 1, crs: 'EPSG:2958', crsSource: 'stated', features: 2500, notWritten: 0,
      sidecar: undefined, converterLayout: { ...layers[1].converterLayout,
        derivativeSha256: child.sha256, derivativeBytes: Number(child.bytes) } });
    assert.deepEqual(registered.map(entry => entry.sourceId), children);
    assert.equal(item.placement, 'needs_answer');
    assert.deepEqual(item.plan_ref, { nativeLayers: { unstated: ['unstated'], answers: [] } });
    assert.equal(item.limit_reason, '2 layers of this GeoPackage are converted to GeoJSON and taken in as their '
      + 'own files: buildings, footprints. Not converted until its coordinate reference system is stated: '
      + 'unstated (states no coordinate reference system). Features per converted layer: buildings (88 written, '
      + '0 not written), footprints (2,500 written, 0 not written).');

    // The large GeoJSON path takes the child unchanged: its card is GeoJSON with the stated system, and its
    // reader reads 2,500 accepted features in parts of 100 under that declaration.
    const bytes = kept.get(children[1])!;
    const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, child.name);
    assert.deepEqual([card.family, card.format, card.crs.state], ['vector', 'geojson', 'stated']);
    let accepted = 0;
    const closure = await readStreamingFeatures(Readable.from([bytes]), 'feature-collection', async item => {
      accepted += Number(sourceRecord(item).disposition === 'accepted');
    });
    assert.deepEqual([closure.features, accepted, Math.ceil(accepted / limits.chunkFeatures)], [2500, 2500, 25]);
    assert.equal(streamedSourceReference(closure.metadata).sourceCrs, 'EPSG:2958');

    // A rerun keeps nothing twice: the child is found by its lineage and hash and enrolled again.
    assert.deepEqual(await convertNativeLayers(caseId, itemId, dependencies), children);
    assert.equal(kept.size, 2);
    assert.equal(conversions, 2);
  });
}

test('an officer states the CRS of the layer whose file states none; only that layer is newly kept, as stated',
  { skip: !ready }, async () => {
    const folder = mkdtempSync(join(tmpdir(), 'native-derivative-'));
    const files = new Map<string, Buffer>();
    const first = converted(folder);
    const original = retained(sourceId, first.bytes, first.sha256, 'outlines.gpkg');
    const { client, sources, item, jobs } = ledger(original);
    const kept = new Map<string, Buffer>();
    const requests: any[] = [];
    const dependencies: NativeDerivativeDependencies = {
      transaction: (async (work: (c: PoolClient) => unknown) => work(client)) as
        NativeDerivativeDependencies['transaction'],
      read: async (key, start, end) => files.get(key)!.subarray(start, end),
      convert: async request => {
        requests.push(request);
        const result = converted(folder, request.layerCrs);
        return { conversion: 'native_gis_to_geojson@1', readerVersion: 'native-gis-window/1', sourceId,
          sourceSha256: result.sha256, layers: stored(result, files) };
      },
      register: async () => ({}),
      large: receipt(sources, kept),
    };
    const before = await convertNativeLayers(caseId, itemId, dependencies);
    assert.equal(item.placement, 'needs_answer');

    // A system the file states is never replaced; no answer is taken while a conversion runs.
    await assert.rejects(stateLayerCrsTx(client, original, itemId, { layer: 'buildings', crs: 'EPSG:4326' }),
      { code: 'INTAKE_LAYER_CRS_STATED' });
    jobs.push({ id: 'running', status: 'running' });
    await assert.rejects(stateLayerCrsTx(client, original, itemId, { layer: 'unstated', crs: 'EPSG:28356' }),
      { code: 'INTAKE_LAYER_CRS_CONVERTING' });
    jobs.pop();
    // SH2's job finished: the answer queues the conversion again as the next job.
    jobs.push({ id: 'first', status: 'succeeded' });
    await stateLayerCrsTx(client, original, itemId, { layer: 'unstated', crs: 'EPSG:28356' });
    assert.deepEqual(jobs.map(job => job.status), ['succeeded', 'queued']);
    assert.equal(jobs[1].payload.jobId, jobs[1].id);
    assert.equal(item.state, 'reading');
    await assert.rejects(stateLayerCrsTx(client, original, itemId, { layer: 'unstated', crs: 'EPSG:32756' }),
      { code: 'INTAKE_LAYER_CRS_ANSWERED' });
    const [answer] = item.plan_ref.nativeLayers.answers;
    assert.deepEqual({ ...answer, statedAt: undefined },
      { layer: 'unstated', crs: 'EPSG:28356', state: 'officer_stated', statedAt: undefined });

    // The tray shows the answer from the item; the card is the probe of the real GeoPackage.
    const bytes = readFileSync(join(folder, 'niagara.gpkg'));
    const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, 'outlines.gpkg');
    const now = new Date().toISOString();
    const row = { ...item, card, card_sha256: null, probe_version: null, name: 'outlines.gpkg', member_path: null,
      size_bytes: bytes.length, parts_planned: null, parts_done: 0, created_at: now, updated_at: now };
    assert.deepEqual(intakeItem(row).layerCrs, [{ layer: 'unstated',
      answer: { crs: 'EPSG:28356', state: 'officer_stated', statedAt: answer.statedAt } }]);

    const after = await convertNativeLayers(caseId, itemId, dependencies);
    assert.deepEqual(requests.map(request => request.layerCrs), [undefined, { unstated: 'EPSG:28356' }]);
    // The two layers kept before are found again by their lineage; only the answered one is kept anew.
    assert.deepEqual(after.slice(0, 2), before);
    assert.equal(kept.size, 3);
    const lineage = sources.get(after[2]).inspection.nativeDerivative;
    assert.deepEqual([lineage.layer, lineage.crs, lineage.crsSource, lineage.features],
      ['unstated', 'EPSG:28356', 'officer_stated', 88]);
    const geojson = kept.get(after[2])!;
    assert.deepEqual(JSON.parse(geojson.toString('utf8')).crs, { type: 'name', properties: { name: 'EPSG:28356' } });
    const child = await probeOriginal(async (start, end) => geojson.subarray(start, end), geojson.length,
      'unstated.geojson');
    assert.deepEqual([child.format, child.crs.state], ['geojson', 'stated']);
    assert.equal(item.placement, 'undecided');
    assert.equal(item.limit_reason, '3 layers of this GeoPackage are converted to GeoJSON and taken in as their own '
      + 'files: buildings, footprints, unstated (EPSG:28356, stated by the officer). Features per converted layer: '
      + 'buildings (88 written, 0 not written), footprints (2,500 written, 0 not written), unstated (88 written, '
      + '0 not written).');
    assert.deepEqual(item.plan_ref, { nativeLayers: { unstated: [], answers: [answer] } });
    assert.deepEqual(intakeItem({ ...row, plan_ref: item.plan_ref }).layerCrs, [{ layer: 'unstated',
      answer: { crs: 'EPSG:28356', state: 'officer_stated', statedAt: answer.statedAt } }]);
  });

test('a code the geo service does not know is refused before anything is written', async () => {
  const body = { requestKey: '30000000-0000-4000-8000-000000000009', layer: 'unstated', crs: 'EPSG:999999' };
  const transaction = async () => assert.fail('No transaction is opened for a refused code.');
  const unknown = new IntakeService({ transaction, resolve: async () => {
    throw new AppError(422, 'AREA_PROCESSING', 'The file\'s crs member declares ...; is not a recognized CRS.');
  } });
  await assert.rejects(unknown.layerCrs(caseId, itemId, body), { code: 'INTAKE_LAYER_CRS_UNKNOWN', status: 422 });
  // A code that resolves to another authority is not taken as this one.
  const other = new IntakeService({ transaction, resolve: async () => ({ authority: 'EPSG:4326' }) });
  await assert.rejects(other.layerCrs(caseId, itemId, { ...body, crs: 'EPSG:28356' }),
    { code: 'INTAKE_LAYER_CRS_UNKNOWN' });
  // The geo service being unreachable is its own fault, never a refusal of the code.
  const down = new IntakeService({ transaction, resolve: async () => {
    throw new AppError(503, 'AREA_PROCESSING', 'down');
  } });
  await assert.rejects(down.layerCrs(caseId, itemId, body), { status: 503 });
});

test('a conversion naming another original is refused before anything is kept', async () => {
  const original = retained(sourceId, 10, 'c'.repeat(64), 'outlines.gpkg');
  const { client, sources } = ledger(original);
  const dependencies = { transaction: async (work: (c: PoolClient) => unknown) => work(client),
    convert: async () => ({ conversion: 'native_gis_to_geojson@1', readerVersion: 'native-gis-window/1', sourceId,
      sourceSha256: 'd'.repeat(64), layers: [{ layer: 'a', ordinal: 0, state: 'not_converted', reason: 'x' }] }),
  } as unknown as NativeDerivativeDependencies;
  await assert.rejects(convertNativeLayers(caseId, itemId, dependencies), { code: 'NATIVE_DERIVATIVE_PINS' });
  assert.equal(sources.size, 1);
});

test('the original\'s words: every layer taken, refused or failed is named; nothing taken rests not understood', () => {
  const kept = { objectKey: `native-derivatives/${'a'.repeat(64)}/0/geojson-${'b'.repeat(64)}`, bytes: 10,
    sha256: 'b'.repeat(64) };
  const conversion = NativeConversionSchema.parse({ conversion: 'native_gis_to_geojson@1', readerVersion: 'r',
    sourceId, sourceSha256: 'a'.repeat(64), layers: [
      { layer: 'roads', ordinal: 0, state: 'converted', crs: 'EPSG:32643', crsSource: 'stated', features: 3,
        notWritten: 0, geojson: kept, sidecar: kept },
      { layer: 'blocks', ordinal: 1, state: 'not_converted',
        reason: 'stores measure (M) values on every geometry' }] });
  assert.deepEqual(nativeParentState('shapefile_zip', conversion,
    [{ layer: 'roads', sourceId: null, code: 'UPLOAD_QUOTA' }]), { state: 'read', placement: 'undecided',
    planRef: null, recordsSeen: 0, limitReason: 'Not converted: blocks (stores measure (M) values on every '
      + 'geometry). Converted but not taken in: roads (UPLOAD_QUOTA; enrol the file again to retry). '
      + 'Features per converted layer: roads (3 written, 0 not written).' });
  assert.equal(nativeParentState('gpkg', { ...conversion, layers: [conversion.layers[1]] }, []).placement,
    'not_understood');
});

test('each converted layer tells its written and not-written features and where the ones not written are named',
  () => {
    const kept = { objectKey: `native-derivatives/${'a'.repeat(64)}/0/geojson-${'b'.repeat(64)}`, bytes: 10,
      sha256: 'b'.repeat(64) };
    const conversion = NativeConversionSchema.parse({ conversion: 'native_gis_to_geojson@1', readerVersion: 'r',
      sourceId, sourceSha256: 'a'.repeat(64), layers: [
        { layer: 'plots', ordinal: 0, state: 'converted', crs: 'EPSG:32643', crsSource: 'stated', features: 1200,
          notWritten: 3, geojson: kept, sidecar: kept },
        { layer: 'roads', ordinal: 1, state: 'converted', crs: 'EPSG:32643', crsSource: 'stated', features: 7,
          notWritten: 0, geojson: kept, sidecar: kept }] });
    const state = nativeParentState('gpkg', conversion, [{ layer: 'plots', sourceId: randomUUID(), code: null },
      { layer: 'roads', sourceId: randomUUID(), code: null }]);
    assert.equal(state.placement, 'undecided');
    assert.equal(state.limitReason, '2 layers of this GeoPackage are converted to GeoJSON and taken in as their own '
      + 'files: plots, roads. Features per converted layer: plots (1,200 written, 3 not written), roads (7 written, '
      + '0 not written). A feature not written is not in that layer\'s GeoJSON; the stored locator file kept beside '
      + 'that GeoJSON names its position in the original and why. Open the reading of this file to see them listed.');
  });

test('an unresolvable stated CRS is kept, not converted, without promising a CRS answer', () => {
  const reason = 'states a coordinate reference system that does not resolve to one EPSG code';
  const conversion = NativeConversionSchema.parse({ conversion: 'native_gis_to_geojson@1', readerVersion: 'r',
    sourceId, sourceSha256: 'a'.repeat(64), layers: [
      { layer: 'unresolved', ordinal: 0, state: 'crs_unstated', statesCrs: true, reason }] });
  const unresolved = nativeParentState('shapefile_zip', conversion, []);
  const export_ = 'Export this layer with a coordinate reference system that resolves to one EPSG code and add the '
    + 'file again; a system the file states is never replaced.';
  assert.equal(unresolved.limitReason, `Kept, not converted: unresolved (${reason}). ${export_}`);
  assert.equal(unresolved.planRef, null);
  // No layer can take a CRS answer, so the item does not say it needs one.
  assert.equal(unresolved.placement, 'not_understood');
  const mixed = NativeConversionSchema.parse({ ...conversion, layers: [...conversion.layers,
    { layer: 'missing', ordinal: 1, state: 'crs_unstated', statesCrs: false,
      reason: 'states no coordinate reference system (no .prj)' }] });
  const both = nativeParentState('shapefile_zip', mixed, []);
  assert.equal(both.limitReason, 'Not converted until its coordinate reference system is stated: '
    + 'missing (states no coordinate reference system (no .prj)). '
    + `Kept, not converted: unresolved (${reason}). ${export_}`);
  assert.deepEqual(both.planRef, { nativeLayers: { unstated: ['missing'], answers: [] } });
  // Only the layer stating no system takes an answer; that one makes the item need it.
  assert.equal(both.placement, 'needs_answer');
});

// KML1. Google's libkml samples (test_only), converted by the real streamed KML reader.
const kmlSamples = 'E:/BhuAayam-data/task-data/desktop-kml-native/originals/kmlsamples.kml';
const kmlScript = `
import hashlib, json, sys, tempfile
from pathlib import Path
sys.path.insert(0, 'services/geo')
from geo.native_gis import convert_kml_file
path = Path(sys.argv[1])
raw = path.read_bytes()
layers, not_read = convert_kml_file(path, 'kml', Path(tempfile.mkdtemp()), hashlib.sha256(raw).hexdigest())
print(json.dumps({'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'layers': layers,
  'notRead': not_read}))`;

test('a KML of folders: each folder with placemarks kept and enrolled, read with its heights; the rest named',
  { skip: !existsSync(python) || !existsSync(kmlSamples) }, async () => {
    const result = JSON.parse(execFileSync(python, ['-B', '-c', kmlScript, kmlSamples], { encoding: 'utf8',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));
    const files = new Map<string, Buffer>();
    const layers = stored(result, files);
    const original = retained(sourceId, result.bytes, result.sha256, 'kmlsamples.kml');
    const { client, sources, item } = ledger(original);
    item.card = { format: 'kml', family: 'vector' };
    const kept = new Map<string, Buffer>();
    const dependencies: NativeDerivativeDependencies = {
      transaction: (async (work: (c: PoolClient) => unknown) => work(client)) as
        NativeDerivativeDependencies['transaction'],
      read: async (key, start, end) => files.get(key)!.subarray(start, end),
      convert: async request => {
        assert.equal(request.format, 'kml');
        return { conversion: 'native_gis_to_geojson@1', readerVersion: 'native-kml-stream/1', sourceId,
          sourceSha256: result.sha256, layers, notRead: result.notRead };
      },
      register: async () => ({}),
      large: receipt(sources, kept),
    };
    const children = await convertNativeLayers(caseId, itemId, dependencies);
    assert.equal(children.length, 6);
    const campus = sources.get(children[3]);
    assert.deepEqual([campus.name, campus.inspection.nativeDerivative.format, campus.inspection.nativeDerivative.crs,
      campus.inspection.nativeDerivative.crsSource], ['Google Campus.geojson', 'kml', 'EPSG:4326', 'stated']);
    assert.match(campus.inspection.nativeDerivative.crsBasis, /KML 2\.2 specification/);
    assert.equal(item.placement, 'undecided');
    assert.equal(item.limit_reason, '6 layers of this KML are converted to GeoJSON and taken in as their own '
      + 'files: Placemarks, Highlighted Icon, Paths, Google Campus, Extruded Polygon, Absolute and Relative. '
      + 'Not converted: Styles and Markup (holds no Placemark whose geometry could be written). Features per '
      + 'converted layer: Placemarks (3 written, 0 not written), Highlighted Icon (1 written, 0 not written), Paths '
      + '(6 written, 0 not written), Google Campus (4 written, 0 not written), Extruded Polygon (1 written, 0 not '
      + 'written), Absolute and Relative (4 written, 0 not written). Coordinate system: the KML 2.2 specification states longitude and latitude on WGS 84 (EPSG:4326). Kept in the original but '
      + 'not fetched or read: GroundOverlay (1), ScreenOverlay (7).');

    // The large GeoJSON path takes the child unchanged: four 3D building outlines, accepted under EPSG:4326.
    const bytes = kept.get(children[3])!;
    const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, campus.name);
    assert.deepEqual([card.family, card.format, card.crs.state], ['vector', 'geojson', 'stated']);
    let accepted = 0;
    const closure = await readStreamingFeatures(Readable.from([bytes]), 'feature-collection', async entry => {
      accepted += Number(sourceRecord(entry).disposition === 'accepted');
    });
    assert.deepEqual([closure.features, accepted], [4, 4]);
    assert.equal(streamedSourceReference(closure.metadata).sourceCrs, 'EPSG:4326');
  });

// B3D1. The real D1 3DBAG CityJSON (test_only), converted by the real outline reader after its CityJSON reading.
const cityjsonD1 = new URL('../../../../../../fixtures/usp/D1/single-roof/original.json', import.meta.url);
const outlineScript = `
import hashlib, json, sys, tempfile
from pathlib import Path
sys.path.insert(0, 'services/geo')
from geo.native_gis import convert_native_file
path = Path(sys.argv[1])
raw = path.read_bytes()
digest = hashlib.sha256(raw).hexdigest()
print(json.dumps({'bytes': len(raw), 'sha256': digest,
  'layers': convert_native_file(path, sys.argv[2], Path(tempfile.mkdtemp()), digest)}))`;

test('a CityJSON stating EPSG:7415: its building outline is kept in EPSG:28992 and read by the large path',
  { skip: !existsSync(python) }, async () => {
    const result = JSON.parse(execFileSync(python, ['-B', '-c', outlineScript, fileURLToPath(cityjsonD1), 'cityjson'],
      { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));
    const files = new Map<string, Buffer>();
    const layers = stored(result, files);
    const original = retained(sourceId, result.bytes, result.sha256, 'city.json');
    const { client, sources, item } = ledger(original);
    const readerJobId = '30000000-0000-4000-8000-000000000004';
    item.card = { format: 'cityjson', family: 'model3d' };
    item.plan_ref = { nativeReaderJobId: readerJobId };
    const kept = new Map<string, Buffer>();
    const dependencies: NativeDerivativeDependencies = {
      transaction: (async (work: (c: PoolClient) => unknown) => work(client)) as
        NativeDerivativeDependencies['transaction'],
      read: async (key, start, end) => files.get(key)!.subarray(start, end),
      convert: async request => {
        assert.equal(request.format, 'cityjson');
        return { conversion: 'native_gis_to_geojson@1', readerVersion: 'cityjson-ground-outline/1', sourceId,
          sourceSha256: result.sha256, layers };
      },
      register: async () => ({}),
      large: receipt(sources, kept),
    };
    const [child] = await convertNativeLayers(caseId, itemId, dependencies);
    const lineage = sources.get(child).inspection.nativeDerivative;
    assert.equal(nativeConverterLayout(sources.get(child))?.method, 'converter:cityjson-ground-outline@1');
    assert.deepEqual([sources.get(child).name, lineage.format, lineage.crs, lineage.crsSource, lineage.features,
      lineage.notWritten], ['building ground outlines.geojson', 'cityjson', 'EPSG:28992', 'stated', 1, 0]);
    assert.deepEqual([item.state, item.placement, item.plan_ref], ['read', 'undecided',
      { nativeReaderJobId: readerJobId }]);
    assert.equal(item.limit_reason, '1 layer of this CityJSON is converted to GeoJSON and taken in as its own file: '
      + 'building ground outlines. Features per converted layer: building ground outlines (1 written, 0 not '
      + 'written). Coordinate system: EPSG:28992, the horizontal part of the EPSG:7415 the file states.');

    // The large GeoJSON path takes the child unchanged: one 3D outline, accepted under EPSG:28992.
    const bytes = kept.get(child)!;
    const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length,
      'outlines.geojson');
    assert.deepEqual([card.family, card.format, card.crs.state], ['vector', 'geojson', 'stated']);
    let accepted = 0;
    const closure = await readStreamingFeatures(Readable.from([bytes]), 'feature-collection', async entry => {
      accepted += Number(sourceRecord(entry).disposition === 'accepted');
    });
    assert.deepEqual([closure.features, accepted], [1, 1]);
    assert.equal(streamedSourceReference(closure.metadata).sourceCrs, 'EPSG:28992');
  });

function layoutControl() {
  const hash = 'a'.repeat(64);
  const object = { objectKey: `native-derivatives/${hash}/0/sidecar-${hash}`, bytes: 1, sha256: hash };
  const lineage = NativeDerivativeLineageSchema.parse({ version: 'native-derivative/1',
    conversion: 'native_gis_to_geojson@1', readerVersion: 'citygml-ground-outline/1',
    originalSourceId: sourceId, originalSourceRevision: 1, originalSha256: hash, originalItemId: itemId,
    format: 'citygml', layer: 'building ground outlines', ordinal: 0, crs: 'EPSG:4326', crsSource: 'stated',
    features: 1, notWritten: 0, sidecar: object,
    converterLayout: { method: 'converter:citygml-ground-outline@1', sourceClasses: ['Building'],
      kind: 'building', identifierField: 'gml:id', nameField: null, derivativeSha256: hash, derivativeBytes: 1 } });
  const child = retained(itemId, 1, hash, 'outlines.geojson', { nativeDerivative: lineage });
  const profile = SourceProfileSchema.parse({ version: 'manual-geojson/1',
    source: { sourceId: child.id, familyId: child.id, sourceRevision: 1, sourceSha256: hash,
      schemaFingerprint: hash }, caseId, workspaceRevision: 0, workspaceFingerprint: hash,
    format: 'geojson', featureCount: 1, crs: { value: 'EPSG:4326', evidence: 'Synthetic control', unit: 'degree' },
    geometryTypes: ['Polygon'], paths: [
      { path: '/features/*/properties/gml:id', types: ['string'], values: 1, explicitNull: 0, absent: 0,
        literalIdEligible: true, literalTextEligible: true },
      { path: '/features/*/geometry', types: ['object'], values: 1, explicitNull: 0, absent: 0,
        literalIdEligible: false, literalTextEligible: false },
    ], limitations: [] });
  return { child, profile, lineage };
}

test('a pinned CityGML converter layout proposes the source identifier, not an officer answer', () => {
  const { child, profile } = layoutControl();
  const proposal = converterIntakeProposal(child, profile)!;
  assert.equal(proposal.origin, 'converter');
  assert.equal(proposal.method, 'converter:citygml-ground-outline@1');
  assert.deepEqual(compileMapping(proposal.plan, profile),
    { kind: 'building', geometryRole: 'unknown', idField: 'gml:id' });
  assert(!('approval' in proposal));
});

for (const change of ['person upload', 'converter version', 'derivative hash', 'derivative bytes',
  'unknown source class', 'missing identifier', 'changed source pin'] as const) {
  test(`a ${change} cannot borrow the converter layout`, () => {
    const { child, profile, lineage } = layoutControl();
    if (change === 'person upload') delete child.inspection.nativeDerivative;
    if (change === 'converter version') {
      lineage.readerVersion = 'citygml-ground-outline/2';
      lineage.converterLayout!.method = 'converter:citygml-ground-outline@2';
    }
    if (change === 'derivative hash') child.sha256 = 'b'.repeat(64);
    if (change === 'derivative bytes') child.bytes = 2;
    if (change === 'unknown source class') lineage.converterLayout!.sourceClasses = ['Road'];
    if (change === 'missing identifier') profile.paths.shift();
    if (change === 'changed source pin') profile.source.sourceId = sourceId;
    assert.equal(converterIntakeProposal(child, profile), null);
  });
}

function streamedControl() {
  const { child, profile, lineage } = layoutControl();
  const inventory = StreamedProfileGenerationSchema.parse({ version: 'streamed-profile/1', jobId: itemId,
    rawJobId: sourceId, source: profile.source, readerSha256: child.sha256, profilerSha256: child.sha256,
    generation: 1, generationHash: profile.source.schemaFingerprint, previousHash: child.sha256,
    coverage: 'sealed', rawChunkIndex: null, rawResultSha256: null, recordsSeen: 1, accepted: 1, quarantined: 0,
    unknownRemainder: false, paths: profile.paths.map(({ literalIdEligible: _id, literalTextEligible: _text,
      ...path }) => ({ ...path, unknown: 0 })), geometryTypes: ['Polygon'], quarantineLocators: [],
    reference: { sourceCrs: 'EPSG:4326', evidence: 'test_only control', unit: 'degree',
      globalPlacement: 'not_qualified' } });
  return { child, profile, lineage, inventory };
}

test('a sealed converted CityGML layout proceeds to mapping and parts without an officer answer', async () => {
  const { child, inventory } = streamedControl();
  let receipt: ReturnType<typeof StreamedMappingReceiptSchema.parse> | undefined;
  const client = { query: async (sql: string, values: any[]) => {
    if (sql.startsWith('SELECT id FROM sources')) return { rows: [{ id: sourceId }] };
    if (sql.startsWith('INSERT INTO usp_mapping_recipes')) receipt = values[3];
    else assert.match(sql, /^INSERT INTO usp_mapping_recipe_revisions/);
    return { rows: [] };
  } } as unknown as PoolClient;
  assert.equal(await recordConverterLayoutTx(client, { caseId, sourceId: child.id, caseRevision: 0,
    subject: localOperatorSubject() }, child, inventory), true);
  assert.equal(receipt!.plan.basis, 'converter_recorded');
  assert.equal(receipt!.approval!.subject, null);
  assert.equal(receipt!.approval!.provenance, 'converter_recorded');
  assert.equal(receipt!.planHash, fingerprint(receipt!.plan));
  assert.doesNotThrow(() => assertStreamedIssuerEvidence(receipt!.plan, child));
  await assertConverterLayoutTx(client, receipt!.plan, child);
  const reader = { job_id: sourceId, state: 'completed', issue_code: null, next_publish_index: 1,
    sealed_chunks: 1, records: 1, quarantined: 0, unknown_remainder: false };
  const store: IntakeLargeStore = { reader, profile: { job_id: itemId, state: 'sealed', issue_code: null,
    sealed_generation: 1 }, recipe: { id: receipt!.id, revision: 1, state: 'approved',
    plan_basis: 'converter_recorded', converter_pin: receipt!.plan.converterPin, converter_original_held: true },
  mapping: null, parts: 0, unreviewed: 0 };
  assert.equal(IntakeItemPlanSchema.parse(intakeLargePlan(store.recipe)).origin, null);
  const rows = { ...intakeLargeRows(store, child), receiptVerified: true };
  assert.equal(intakeLargePhase(rows), 'map');
  rows.mapping = { ...reader };
  assert.equal(intakeLargePhase(rows), 'draft');
  child.inspection!.nativeDerivative.readerVersion = 'citygml-ground-outline/2';
  assert.equal(intakeLargePhase(intakeLargeRows(store, child)), 'question');
  await assert.rejects(assertConverterLayoutTx(client, receipt!.plan, child), { code: 'CONVERTER_LAYOUT' });
});

for (const change of ['upload', 'version', 'bytes', 'hash', 'class', 'original'] as const) {
  test(`streamed converter admission asks for a layout after changed ${change}`, async () => {
    const { child, lineage, inventory } = streamedControl();
    if (change === 'upload') delete child.inspection!.nativeDerivative;
    if (change === 'version') lineage.readerVersion = 'citygml-ground-outline/2';
    if (change === 'bytes') child.bytes = 2;
    if (change === 'hash') child.sha256 = 'b'.repeat(64);
    if (change === 'class') lineage.converterLayout!.sourceClasses = ['Road'];
    const client = { query: async (sql: string) => {
      assert.match(sql, /^SELECT id FROM sources/);
      return { rows: [] };
    } } as unknown as PoolClient;
    assert.equal(await recordConverterLayoutTx(client, { caseId, sourceId: child.id, caseRevision: 0,
      subject: localOperatorSubject() }, child, inventory), false);
  });
}

test('converter authorization cannot enter the small-file layout memory, even with matching fields', async () => {
  const { child, profile } = layoutControl();
  const plan = converterIntakeProposal(child, profile)!.plan, at = new Date().toISOString();
  const body = { id: itemId, revision: 1, state: 'approved', plan, planHash: fingerprint(plan),
    authoredBy: localOperatorSubject(), authoredAt: at, execution: null,
    destination: { kind: 'new_area', namespace: 'test_only', name: 'test_only' },
    approval: { subject: null, at, planHash: fingerprint(plan), provenance: 'converter_recorded' } };
  assert.equal(await lookupIntakeMemory(profile, localOperatorSubject(), async () => [{ body }]), null);
  assert.equal(nativeConverterPin(child)!.originalSourceId, sourceId);
});

const citygmlOriginals = 'E:/BhuAayam-data/task-data/desktop-citygml-native/originals';

async function assertPlacedCitygml(child: any, bytes: Buffer, originalSha256: string) {
  const lineage = NativeDerivativeLineageSchema.parse(child.inspection.nativeDerivative);
  assert.deepEqual([child.name, lineage.format, lineage.readerVersion, lineage.crs, lineage.features],
    ['building ground outlines.geojson', 'citygml', 'citygml-ground-outline/1', 'EPSG:25832', 1]);
  assert.deepEqual([lineage.originalSourceId, lineage.originalSha256], [sourceId, originalSha256]);
  assert.equal(nativeConverterLayout(child)?.method, 'converter:citygml-ground-outline@1');
  assert.equal(nativeConverterLayout(child)?.identifierField, 'gml:id');
  assert.match(lineage.crsBasis!, /horizontal part/);
  const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, child.name);
  assert.deepEqual([card.format, card.crs.state], ['geojson', 'stated']);
  let accepted = 0;
  const closure = await readStreamingFeatures(Readable.from([bytes]), 'feature-collection', async entry => {
    accepted += Number(sourceRecord(entry).disposition === 'accepted');
  });
  assert.deepEqual([closure.features, accepted], [1, 1]);
  assert.equal(streamedSourceReference(closure.metadata).sourceCrs, 'EPSG:25832');
}

for (const [name, expected] of [
  ['Building_and_garage_LOD2-EPSG25832.gml', 1], ['Building_LOD1-LocalEngineeringCRS.gml', 0],
] as const) {
  test(`CityGML ${name}: converted outline or honest unplaced words through the derivative path`, {
    skip: !existsSync(python) || !existsSync(join(citygmlOriginals, name)),
  }, async () => {
    const result = JSON.parse(execFileSync(python, ['-B', '-c', outlineScript, join(citygmlOriginals, name), 'citygml'],
      { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));
    const files = new Map<string, Buffer>();
    const layers = stored(result, files);
    const original = retained(sourceId, result.bytes, result.sha256, name);
    const { client, sources, item } = ledger(original);
    item.card = { format: 'citygml', family: 'model3d' };
    const readerJobId = '30000000-0000-4000-8000-000000000004';
    item.plan_ref = { nativeReaderJobId: readerJobId };
    const kept = new Map<string, Buffer>();
    const registered: string[] = [];
    const dependencies: NativeDerivativeDependencies = {
      transaction: (async (work: (c: PoolClient) => unknown) => work(client)) as
        NativeDerivativeDependencies['transaction'],
      read: async (key, start, end) => files.get(key)!.subarray(start, end),
      convert: async request => {
        assert.equal(request.format, 'citygml');
        return { conversion: 'native_gis_to_geojson@1', readerVersion: 'citygml-ground-outline/1', sourceId,
          sourceSha256: result.sha256, layers };
      },
      register: async (_case, input) => {
        registered.push((input as { sourceId: string }).sourceId);
        return {};
      },
      large: receipt(sources, kept),
    };
    const children = await convertNativeLayers(caseId, itemId, dependencies);
    assert.equal(children.length, expected);
    assert.deepEqual(registered, children);
    assert.deepEqual(item.plan_ref, { nativeReaderJobId: readerJobId });
    if (!expected) {
      assert.deepEqual([item.state, item.placement, kept.size], ['read', 'not_understood', 0]);
      assert.match(item.limit_reason, /stay unplaced/);
      assert.match(item.limit_reason, /#local-CRS-1/);
      return;
    }
    await assertPlacedCitygml(sources.get(children[0]), kept.get(children[0])!, original.sha256);
    assert.deepEqual(await convertNativeLayers(caseId, itemId, dependencies), children);
    assert.equal(kept.size, 1);
  });
}

const berlinRoot = 'E:/BhuAayam-data/datasets/practice-kit-20261024/berlin-senstadt';
const berlinScript = `
import hashlib, json, sys, tempfile, zipfile
from pathlib import Path
sys.path.insert(0, 'services/geo')
from geo.native_gis import convert_native_file
from geo.native_citygml import CityGMLError, extract, encode_result
folder = Path(tempfile.mkdtemp())
path = Path(sys.argv[1])
if path.suffix == '.zip':
    with zipfile.ZipFile(path) as archive:
        raw = archive.read('LoD2_33_392_5820_1_BE.xml')
    path = folder / 'LoD2_33_392_5820_1_BE.xml'
    path.write_bytes(raw)
raw = path.read_bytes()
digest = hashlib.sha256(raw).hexdigest()
try:
    encode_result(extract(raw))
    raise AssertionError('Berlin inventory must exceed the unchanged 16 MiB bound')
except CityGMLError as error:
    assert error.code == 'OUTPUT_LIMIT'
layers = convert_native_file(path, 'citygml', folder, digest)
assert hashlib.sha256(path.read_bytes()).hexdigest() == digest
print(json.dumps({'bytes': len(raw), 'sha256': digest, 'nativeCode': 'CITYGML_OUTPUT_LIMIT',
  'layers': layers}))`;

for (const name of ['LoD2_33_392_5820_1_BE.gml', 'LoD2_392_5820.zip']) {
  test(`Berlin ${name}: stopped inventory still queues 546 cited AdV outlines and rests read`, {
    skip: !existsSync(python) || !existsSync(join(berlinRoot, name)),
  }, async () => {
    const result = JSON.parse(execFileSync(python, ['-B', '-c', berlinScript, join(berlinRoot, name)],
      { encoding: 'utf8', timeout: 120_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));
    assert.equal(result.nativeCode, 'CITYGML_OUTPUT_LIMIT');
    assert.equal(result.sha256, '515aa294b686fbdbebff8ea9946198fc06adda8d922173ec316a7288f64ab0b5');
    const files = new Map<string, Buffer>();
    const layers = stored(result, files);
    assert.deepEqual([layers[0].features, layers[0].notWritten], [546, 186]);
    assert.ok(layers[0].crsBasis.length > 200);
    const original = retained(sourceId, result.bytes, result.sha256, name);
    const { client, sources, item, jobs } = ledger(original);
    const raw = readFileSync(join(berlinRoot, 'LoD2_33_392_5820_1_BE.gml'));
    const card = await probeOriginal(async (start, end) => raw.subarray(start, end), raw.length, original.name);
    assert.equal(card.format, 'citygml');
    item.card = card;
    const jobId = '30000000-0000-4000-8000-000000000004';
    item.plan_ref = { nativeReaderJobId: jobId };
    await settleIntakeNativeReaderTx(client, caseId, jobId,
      { format: 'citygml', status: 'failed', code: result.nativeCode });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].operation, 'intake-native-derivative');
    assert.equal(jobs[0].payload.sourceSha256, original.sha256);
    assert.equal(item.state, 'reading');
    const kept = new Map<string, Buffer>();
    const registered: string[] = [];
    const dependencies: NativeDerivativeDependencies = {
      transaction: (async work => work(client)) as NativeDerivativeDependencies['transaction'],
      read: async (key, start, end) => files.get(key)!.subarray(start, end),
      convert: async request => {
        assert.deepEqual(request, { sourceId, objectKey: original.object_key, sha256: result.sha256,
          bytes: result.bytes, format: 'citygml' });
        return { conversion: 'native_gis_to_geojson@1', readerVersion: 'citygml-ground-outline/1',
          sourceId, sourceSha256: result.sha256, layers };
      },
      register: async (_case, input) => { registered.push((input as { sourceId: string }).sourceId); return {}; },
      large: receipt(sources, kept),
    };
    const [child] = await convertNativeLayers(caseId, itemId, dependencies);
    assert.ok(child, item.limit_reason);
    assert.deepEqual(registered, [child]);
    const lineage = NativeDerivativeLineageSchema.parse(sources.get(child).inspection.nativeDerivative);
    assert.equal(lineage.crsBasis, layers[0].crsBasis);
    assert.equal(lineage.originalSha256, result.sha256);
    assert.equal(lineage.crs, 'EPSG:25833');
    const bytes = kept.get(child)!;
    assert.equal(sha(bytes), '5fd255cbd2f164dd10cf52a01bc5eb071e68c9a4ca146fbfc735d14ff5388bfd');
    let accepted = 0;
    const closure = await readStreamingFeatures(Readable.from([bytes]), 'feature-collection', async entry => {
      accepted += Number(sourceRecord(entry).disposition === 'accepted');
    });
    assert.deepEqual([closure.features, accepted], [546, 546]);
    assert.equal(streamedSourceReference(closure.metadata).sourceCrs, 'EPSG:25833');
    assert.deepEqual([item.state, item.placement], ['read', 'undecided']);
    assert.equal(item.plan_ref.nativeReaderJobId, jobId);
    assert.match(item.limit_reason, /1 layer of this CityGML is converted/);
    assert.match(item.limit_reason, /546 written, 186 not written/);
    const reading = readingOf(item, card,
      { nativeStopped: { format: 'citygml', code: 'CITYGML_OUTPUT_LIMIT' } });
    assert.ok(reading.holds.some(entry => entry.words.includes('(16 MiB)')
      && entry.words.includes('building outlines are read directly from the unchanged original')));
    assert.match(reading.drawing.words, /converted to GeoJSON/);
    assert.doesNotMatch(reading.drawing.words, /failed|so it is not read/);
    assert.equal(sha(raw), original.sha256);
    assert.equal(sources.size, 2, 'only the original and its outline derivative are retained');
  });
}

test('a CityJSON whose outlines cannot be placed rests read, in the words saying why', () => {
  const conversion = NativeConversionSchema.parse({ conversion: 'native_gis_to_geojson@1',
    readerVersion: 'cityjson-ground-outline/1', sourceId, sourceSha256: 'a'.repeat(64),
    layers: [{ layer: 'building ground outlines', ordinal: 0, state: 'not_converted', reason: 'states EPSG:4979, '
      + 'which has no two-dimensional horizontal system the reader knows, so its outlines stay unplaced' }] });
  assert.deepEqual(nativeParentState('cityjson', conversion, []), { state: 'read', placement: 'not_understood',
    planRef: null, recordsSeen: 0, limitReason: 'Not converted: building ground outlines (states EPSG:4979, which '
      + 'has no two-dimensional horizontal system the reader knows, so its outlines stay unplaced).' });
});

test('a KML with no placemark geometry rests not understood, naming what it keeps but does not read', () => {
  const conversion = NativeConversionSchema.parse({ conversion: 'native_gis_to_geojson@1',
    readerVersion: 'native-kml-stream/1', sourceId, sourceSha256: 'a'.repeat(64), notRead: { NetworkLink: 2 },
    layers: [{ layer: 'whole file', ordinal: 0, state: 'not_converted', reason: 'holds no Placemark' }] });
  assert.deepEqual(nativeParentState('kmz', conversion, []), { state: 'read', placement: 'not_understood',
    planRef: null, recordsSeen: 0, limitReason: 'Not converted: whole file (holds no Placemark). Kept in the '
      + 'original but not fetched or read: NetworkLink (2).' });
});

function derivativeProtocol(afterFinalize = () => {}, layerNames = ['outlines']) {
  const original = retained(sourceId, 10, sha(Buffer.from('test_only parent')), 'outlines.gpkg');
  const state = ledger(original);
  const kept = new Map<string, Buffer>();
  let receipts = 0;
  const bytes = Buffer.from('{"type":"FeatureCollection","features":[]}');
  const object = { objectKey: `native-derivatives/${original.sha256}/0/geojson-${sha(bytes)}`,
    bytes: bytes.length, sha256: sha(bytes) };
  const layer = { layer: 'outlines', ordinal: 0, state: 'converted', crs: 'EPSG:4326', crsSource: 'stated',
    features: 0, notWritten: 0, geojson: object, sidecar: object };
  const lineage = NativeDerivativeLineageSchema.parse({ layer: layer.layer, ordinal: 0, crs: layer.crs,
    crsSource: layer.crsSource, features: 0, notWritten: 0, sidecar: object,
    version: 'native-derivative/1', conversion: 'native_gis_to_geojson@1', readerVersion: 'protocol/1',
    originalSourceId: sourceId, originalSourceRevision: 1, originalSha256: original.sha256,
    originalItemId: itemId, format: 'gpkg' });
  const dependencies = { transaction: async (work: (client: PoolClient) => Promise<unknown>) => work(state.client),
    read: async (_key: string, start: number, end: number) => bytes.subarray(start, end),
    convert: async () => ({ conversion: 'native_gis_to_geojson@1', readerVersion: 'protocol/1', sourceId,
      sourceSha256: original.sha256, layers: layerNames.map((name, ordinal) => ({ ...layer, layer: name, ordinal })) }),
    register: async () => ({}), large: receipt(state.sources, kept, afterFinalize, () => { receipts++; }),
  } as NativeDerivativeDependencies;
  return { ...state, original, kept, bytes, lineage, dependencies, get receipts() { return receipts; } };
}

test('a GeoParquet card queues the batch conversion and keeps a child with GeoParquet lineage', async () => {
  const state = derivativeProtocol();
  state.item.card = { format: 'geoparquet', family: 'vector' };
  state.original.name = 'outlines.parquet';
  assert.equal(nativeDerivativeFormat(state.item.card as IntakeCard), 'geoparquet');
  assert.equal(nativeDerivativeFormat({ format: 'parquet', family: 'table' } as IntakeCard), null);
  const job = await queueIntakeDraftTx(state.client, state.original, state.item.card as IntakeCard);
  assert.equal(state.jobs[0].id, job);
  assert.match(state.item.limit_reason, /layers of this GeoParquet are being converted/);
  const convert = state.dependencies.convert;
  state.dependencies.convert = async request => {
    assert.equal(request.format, 'geoparquet');
    return convert(request);
  };
  const [child] = await convertNativeLayers(caseId, itemId, state.dependencies);
  const lineage = NativeDerivativeLineageSchema.parse(state.sources.get(child).inspection.nativeDerivative);
  assert.equal(lineage.format, 'geoparquet');
  assert.equal(lineage.originalSha256, state.original.sha256);
  assert.match(state.item.limit_reason, /this GeoParquet/);
});

test('a stop immediately after finalize leaves a linked child; replay creates no second receipt', async () => {
  let stopped = false;
  const state = derivativeProtocol(() => {
    if (!stopped) {
      stopped = true;
      throw new Error('Injected stop after finalization committed');
    }
  });
  assert.deepEqual(await convertNativeLayers(caseId, itemId, state.dependencies), []);
  assert.equal(state.kept.size, 1);
  const child = [...state.kept.keys()][0];
  assert.deepEqual(state.sources.get(child).inspection.nativeDerivative, state.lineage);
  assert.deepEqual(await convertNativeLayers(caseId, itemId, state.dependencies), [child]);
  assert.equal(state.kept.size, 1);
  assert.equal(state.receipts, 1);
});

test('old linked children remain readable, but a different parent item or sidecar is not reused', async () => {
  const state = derivativeProtocol();
  const old = randomUUID();
  state.sources.set(old, retained(old, state.bytes.length, sha(state.bytes), 'outlines.geojson',
    { nativeDerivative: state.lineage }));
  assert.deepEqual(await convertNativeLayers(caseId, itemId, state.dependencies), [old]);
  assert.equal(state.kept.size, 0);
  for (const difference of [{ originalItemId: randomUUID() },
    { sidecar: { ...state.lineage.sidecar, sha256: 'e'.repeat(64) } }]) {
    state.sources.get(old).inspection.nativeDerivative = { ...state.lineage, ...difference };
    const children = await convertNativeLayers(caseId, itemId, state.dependencies);
    assert.equal(children.length, 1);
    assert.notEqual(children[0], old);
    assert.deepEqual(state.sources.get(old).inspection.nativeDerivative, { ...state.lineage, ...difference });
  }
  assert.equal(state.kept.size, 1);
  assert.equal(state.sources.size, 3);
});

function orphanReceipt(state: ReturnType<typeof derivativeProtocol>) {
  const id = randomUUID();
  const orphan = retained(id, state.bytes.length, sha(state.bytes), 'outlines.geojson');
  state.sources.set(id, orphan);
  const upload = { source_id: id, operator_subject: localOperatorSubject(), body: {
    batchSourceId: sourceId, input: { filename: orphan.name, bytes: orphan.bytes, sha256: orphan.sha256 },
    verified: { bytes: orphan.bytes, sha256: orphan.sha256 } } };
  state.uploads.push(upload);
  return { orphan, upload };
}

test('an old unlinked receipt is recovered only with exact retained bytes and parent/layer receipt facts', async () => {
  const state = derivativeProtocol();
  const { orphan } = orphanReceipt(state);
  assert.deepEqual(await convertNativeLayers(caseId, itemId, state.dependencies), [orphan.id]);
  assert.deepEqual(orphan.inspection.nativeDerivative, state.lineage);
  assert.equal(state.kept.size, 0);
  assert.deepEqual(await convertNativeLayers(caseId, itemId, state.dependencies), [orphan.id]);
  assert.equal(state.sources.size, 2);
});

test('mismatched or ambiguous old orphan receipts are left unchanged and reported, not deleted or copied', async () => {
  for (const ambiguous of [false, true]) {
    const state = derivativeProtocol();
    const { orphan, upload } = orphanReceipt(state);
    if (ambiguous) orphanReceipt(state);
    else upload.body.verified.sha256 = 'f'.repeat(64);
    const before = structuredClone([...state.sources]);
    assert.deepEqual(await convertNativeLayers(caseId, itemId, state.dependencies), []);
    assert.deepEqual([...state.sources], before);
    assert.equal(state.kept.size, 0);
    assert.equal(orphan.inspection.nativeDerivative, undefined);
    assert.match(state.item.limit_reason, /earlier retained original.*left unchanged/);
  }
});

test('an old orphan whose stored byte authority disagrees is left unchanged with an honest explanation', async () => {
  const state = derivativeProtocol();
  const { orphan } = orphanReceipt(state);
  orphan.inspection.largeOriginal.verifiedBytes++;
  const before = structuredClone(orphan);
  assert.deepEqual(await convertNativeLayers(caseId, itemId, state.dependencies), []);
  assert.deepEqual(orphan, before);
  assert.equal(state.kept.size, 0);
  assert.match(state.item.limit_reason, /earlier retained original.*left unchanged/);
});

test('a slot wait is bounded without asking the officer to enrol again; byte quotas do not wait', async t => {
  for (const limit of ['open_receipts', 'open_bytes', 'case_retained_bytes', 'storage_capacity']) {
    const state = derivativeProtocol();
    let now = Date.now(), waits = 0;
    t.mock.method(Date, 'now', () => now);
    state.dependencies.large.create = async () => {
      throw new AppError(429, 'UPLOAD_QUOTA', 'Original quota words.', { limit, freesAt: null });
    };
    state.dependencies.waitForSlot = async (_version, _freesAt, deadline) => { waits++; now = deadline; };
    assert.deepEqual(await convertNativeLayers(caseId, itemId, state.dependencies), []);
    assert.equal(waits, limit === 'open_receipts' ? 1 : 0);
    if (waits) {
      assert.match(state.item.limit_reason, /no upload slot became free within 30 minutes/);
      assert.doesNotMatch(state.item.limit_reason, /enrol the file again/);
    } else assert.match(state.item.limit_reason, /UPLOAD_QUOTA; enrol the file again to retry/);
    t.mock.restoreAll();
  }
});

test('succeeded conversion is not queued again; queued and running are reused, failed is retried', async () => {
  for (const status of ['queued', 'running', 'succeeded', 'failed']) {
    const state = derivativeProtocol();
    const id = randomUUID();
    state.jobs.push({ id, status });
    const result = await queueNativeDerivativeTx(state.client, state.original, state.item.card as IntakeCard);
    if (status === 'succeeded') assert.equal(result, null);
    else if (status === 'failed') assert.notEqual(result, id);
    else assert.equal(result, id);
    assert.equal(state.jobs.length, status === 'failed' ? 2 : 1);
  }
});

test('re-enrolling a partial conversion retries the failed keep without a second receipt for the kept layer',
  async () => {
    const state = derivativeProtocol(() => {}, ['outlines', 'retry layer']);
    const queue = () => queueIntakeDraftTx(state.client, state.original, state.item.card as IntakeCard);
    const create = state.dependencies.large.create;
    const attempts: string[] = [];
    let failKeep = true;
    state.dependencies.large.create = async (caseValue, input, parent) => {
      const { filename } = input as { filename: string };
      attempts.push(filename);
      if (failKeep && filename === 'retry layer.geojson') {
        throw new AppError(503, 'UPLOAD_QUOTA', 'Injected keep failure.');
      }
      return create(caseValue, input, parent);
    };
    const firstJob = await queue();
    const [kept] = await convertNativeLayers(caseId, itemId, state.dependencies);
    state.jobs[0].status = 'succeeded';
    assert.match(state.item.limit_reason, /retry layer \(UPLOAD_QUOTA; enrol the file again to retry\)/);
    assert.equal(state.kept.size, 1);
    failKeep = false;

    const retryJob = await queue();
    assert.ok(retryJob, 'Re-enrolling must queue a retry despite the succeeded partial job.');
    assert.notEqual(retryJob, firstJob);
    assert.equal(state.jobs.length, 2);
    assert.equal(await queue(), retryJob, 'A repeated enrolment reuses the queued retry.');
    state.jobs[1].status = 'running';
    assert.equal(await queue(), retryJob, 'A repeated enrolment reuses the running retry.');
    const children = await convertNativeLayers(caseId, itemId, state.dependencies);
    assert.equal(children[0], kept);
    assert.equal(children.length, 2);
    assert.equal(state.receipts, 2);
    assert.equal(state.kept.size, 2);
    assert.deepEqual(attempts, ['outlines.geojson', 'retry layer.geojson', 'retry layer.geojson']);
    assert.match(state.item.limit_reason, /2 layers.*taken in/);
    assert.doesNotMatch(state.item.limit_reason, /enrol the file again/);
    state.jobs[1].status = 'succeeded';
    assert.equal(await queue(), null, 'A complete retry must not be queued again.');
    assert.equal(state.jobs.length, 2);
  });

test('a registration failure retries the kept child without another receipt, even if the next attempt fails',
  async () => {
    const state = derivativeProtocol();
    const queue = () => queueIntakeDraftTx(state.client, state.original, state.item.card as IntakeCard);
    await queue();
    state.dependencies.register = async () => { throw new AppError(503, 'INTAKE_UNAVAILABLE', 'Injected failure.'); };
    const [child] = await convertNativeLayers(caseId, itemId, state.dependencies);
    state.jobs[0].status = 'succeeded';
    assert.match(state.item.limit_reason, /INTAKE_UNAVAILABLE; enrol the file again to retry/);
    assert.ok(await queue());
    state.jobs[1].status = 'failed';
    const retryJob = await queue();
    assert.ok(retryJob, 'An older succeeded partial job must not block retrying a later failed job.');
    assert.equal(state.jobs.length, 3);
    state.dependencies.register = async (_case, input) => {
      assert.equal((input as { sourceId: string }).sourceId, child);
      return {};
    };
    assert.deepEqual(await convertNativeLayers(caseId, itemId, state.dependencies), [child]);
    assert.equal(state.receipts, 1);
    assert.equal(state.kept.size, 1);
    state.jobs[2].status = 'succeeded';
    assert.equal(await queue(), null);
  });

test('a successful conversion is not re-enrolled, but an officer CRS answer still queues it again', async () => {
  const state = derivativeProtocol();
  const card = state.item.card as IntakeCard;
  const firstJob = await queueNativeDerivativeTx(state.client, state.original, card);
  const children = await convertNativeLayers(caseId, itemId, state.dependencies);
  state.jobs[0].status = 'succeeded';
  assert.equal(children.length, 1);
  assert.equal(await queueIntakeDraftTx(state.client, state.original, card), null);
  assert.equal(state.jobs.length, 1);
  state.item.plan_ref = { nativeLayers: { unstated: ['unstated'], answers: [] } };
  await stateLayerCrsTx(state.client, state.original, itemId, { layer: 'unstated', crs: 'EPSG:28356' });
  assert.equal(state.jobs.length, 2);
  assert.notEqual(state.jobs[1].id, firstJob);
  assert.equal(state.jobs[1].status, 'queued');
  assert.equal(await queueNativeDerivativeTx(state.client, state.original, card), state.jobs[1].id);
});

test('conversion fetch scales its timeout with source bytes, or the sum of loose shapefile parts', async t => {
  process.env.GEO_URL ??= 'http://processor.invalid';
  process.env.GEO_SERVICE_TOKEN ??= 'protocol';
  const timeouts: number[] = [];
  const signal = new AbortController().signal;
  t.mock.method(AbortSignal, 'timeout', (ms: number) => { timeouts.push(ms); return signal; });
  const bytes = 600 * 1024 ** 2;
  const pins = { sourceId, objectKey: `large-originals/${sourceId}/${'a'.repeat(64)}`,
    sha256: 'a'.repeat(64), bytes };
  const requestFetch: typeof fetch = async (url, init) => {
    assert.match(String(url), /\/internal\/area\/convert-native$/);
    assert.equal(init?.signal, signal);
    assert.equal(init?.method, 'POST');
    return Response.json({ layers: [] });
  };
  await requestConversion({ ...pins, format: 'gpkg' }, requestFetch);
  await requestConversion({ ...pins, bytes: 200 * 1024 ** 2, format: 'shapefile_set', layer: 'test_only',
    members: ['shp', 'shx', 'dbf'].map(extension => ({ ...pins, bytes: 200 * 1024 ** 2,
      extension: extension as 'shp' | 'shx' | 'dbf' })) }, requestFetch);
  assert.deepEqual(timeouts, [streamingReadMs(bytes), streamingReadMs(bytes)]);
  assert.equal(timeouts[0], 50 * 60 * 1000);
});

test('publishing a KML or KMZ card queues its conversion job; any other vector card is not converted', async () => {
  for (const format of ['kml', 'kmz']) {
    const original = retained(sourceId, 10, 'c'.repeat(64), `ward.${format}`);
    const { client, item, jobs } = ledger(original);
    item.card = { format, family: 'vector' };
    const jobId = await queueNativeDerivativeTx(client, original, item.card as IntakeCard);
    assert.deepEqual(jobs.map(job => [job.id, job.operation]), [[jobId, 'intake-native-derivative']]);
    assert.equal(item.limit_reason, `The layers of this ${format.toUpperCase()} are being converted to GeoJSON, `
      + 'each to be taken in as its own file. Layers enter the map path once the whole conversion ends.');
  }
  assert.equal(nativeDerivativeFormat({ format: 'geojson', family: 'vector' } as IntakeCard), null);
});
