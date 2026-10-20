import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { STREAMING_VECTOR_LIMITS as limits } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { localOperatorSubject } from '../principal';
import { probeOriginal } from './intake-probe';
import { intakeItem } from './intake-ledger';
import { convertNativeLayers, nativeParentState, NativeConversionSchema, stateLayerCrsTx,
  type NativeDerivativeDependencies } from './intake-native-derivative';
import { IntakeService } from './intake-service';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { streamedSourceReference } from './streamed-map-receipt';

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

function retained(id: string, bytes: number, hash: string, name: string, inspection: Record<string, unknown> = {}) {
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
  const item = { item_id: itemId, case_id: caseId, source_id: original.id, parent_item_id: null,
    card: { format: 'geopackage', family: 'vector' }, state: 'reading', placement: 'undecided', plan_ref: null as any,
    records_seen: 0, limit_reason: 'converting', family: 'vector', format: 'geopackage', size_class: 'L', wave: 1,
    pinned_by_officer: false };
  const client = { query: async (sql: string, values: any[] = []) => {
    const rows = ((): any[] | null => {
      if (sql.startsWith('SELECT * FROM usp_intake_items')) return [item];
      if (sql.startsWith('SELECT id,revision,archived FROM cases')) {
        return [{ id: caseId, revision: 4, archived: false }];
      }
      if (sql.startsWith('SELECT revision FROM cases')) return [{ revision: 4 }];
      if (sql.startsWith('SELECT * FROM sources')) return [sources.get(values[1])];
      if (sql.startsWith('SELECT id FROM sources')) return [...sources.values()].filter(row =>
        row.sha256 === values[1] && row.inspection.nativeDerivative?.layer === values[3]);
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
      if (sql.startsWith('SELECT id,status FROM jobs')) return jobs;
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
  return { client, sources, item, jobs };
}

/** The byte receipt /uploads drives, standing in for storage: it hashes each part and keeps the bytes it was sent. */
function receipt(sources: Map<string, any>, kept: Map<string, Buffer>) {
  let parts: Buffer[] = [];
  let file: { filename: string; sha256: string; bytes: number };
  return {
    create: async (_case: string, input: any) => {
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
    finalize: async (_case: string, _id: string, input: { sha256: string }) => {
      const bytes = Buffer.concat(parts);
      assert.equal(sha(bytes), input.sha256);
      const id = randomUUID();
      sources.set(id, retained(id, bytes.length, input.sha256, file.filename));
      kept.set(id, bytes);
      return { source: { sourceId: id } };
    },
    abort: async () => {},
  } as unknown as NativeDerivativeDependencies['large'];
}

test('a GeoPackage of 2,500 outlines, a second layer and one with no CRS: two children kept, enrolled, read in parts',
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
    const children = await convertNativeLayers(caseId, itemId, dependencies);
    assert.equal(children.length, 2);
    assert.deepEqual(children.map(id => sources.get(id).inspection.nativeDerivative.layer),
      ['buildings', 'footprints']);
    const child = sources.get(children[1]);
    assert.equal(child.name, 'footprints.geojson');
    assert.deepEqual({ ...child.inspection.nativeDerivative, sidecar: undefined }, { version: 'native-derivative/1',
      conversion: 'native_gis_to_geojson@1', readerVersion: 'native-gis-window/1', originalSourceId: sourceId,
      originalSourceRevision: 1, originalSha256: result.sha256, originalItemId: itemId, format: 'gpkg',
      layer: 'footprints', ordinal: 1, crs: 'EPSG:2958', crsSource: 'stated', features: 2500, notWritten: 0,
      sidecar: undefined });
    assert.deepEqual(registered.map(entry => entry.sourceId), children);
    assert.equal(item.placement, 'needs_answer');
    assert.deepEqual(item.plan_ref, { nativeLayers: { unstated: ['unstated'], answers: [] } });
    assert.equal(item.limit_reason, '2 layers of this GeoPackage are converted to GeoJSON and taken in as their '
      + 'own files: buildings, footprints. Not converted until its coordinate reference system is stated: '
      + 'unstated (states no coordinate reference system).');

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
    jobs.push({ id: 'first', status: 'completed' });
    await stateLayerCrsTx(client, original, itemId, { layer: 'unstated', crs: 'EPSG:28356' });
    assert.deepEqual(jobs.map(job => job.status), ['completed', 'queued']);
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
      + 'files: buildings, footprints, unstated (EPSG:28356, stated by the officer).');
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
      + 'geometry). Converted but not taken in: roads (UPLOAD_QUOTA; enrol the file again to retry).' });
  assert.equal(nativeParentState('gpkg', { ...conversion, layers: [conversion.layers[1]] }, []).placement,
    'not_understood');
});
