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
import { localOperatorSubject } from '../principal';
import { probeOriginal } from './intake-probe';
import { convertNativeLayers, nativeParentState, NativeConversionSchema,
  type NativeDerivativeDependencies } from './intake-native-derivative';
import { readStreamingFeatures, sourceRecord } from './streaming-vector-reader';
import { streamedSourceReference } from './streamed-map-receipt';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'native-derivative-protocol';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
// The geo service's own Python and the data drive's real test originals; a box without them skips these tests.
const python = process.env.ULPIN_GEO_PYTHON ?? 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const ready = existsSync(python) && existsSync('E:/BhuAayam-data/datasets/map-formats/niagara-falls');

/** The real native conversion of a GeoPackage of real test_only outlines: Niagara, Tweed, and Tweed with no CRS. */
function converted() {
  const folder = mkdtempSync(join(tmpdir(), 'native-derivative-'));
  const script = `
import hashlib, json, sqlite3, sys
from pathlib import Path
sys.path.insert(0, 'services/geo'); sys.path.insert(0, 'services/geo/tests')
from geo.native_gis import convert_native_file
from test_native_conversion import TWEED_GPKG, niagara_gpkg
folder = Path(sys.argv[1])
path = niagara_gpkg(folder, 2500)
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
out = folder / 'out'; out.mkdir()
raw = path.read_bytes()
print(json.dumps({'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
  'layers': convert_native_file(path, 'gpkg', out, hashlib.sha256(raw).hexdigest())}))`;
  return JSON.parse(execFileSync(python, ['-B', '-c', script, folder], { encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));
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
  const item = { item_id: itemId, case_id: caseId, source_id: original.id, parent_item_id: null,
    card: { format: 'geopackage', family: 'vector' }, state: 'reading', placement: 'undecided', plan_ref: null,
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
        Object.assign(item, { state: values[2], placement: values[3], limit_reason: values[6] });
        return [];
      }
      if (sql.startsWith('SELECT item_id AS')) return [{ itemId, state: item.state, family: 'vector',
        format: 'geopackage', sizeClass: 'L', wave: 1, pinnedByOfficer: false }];
      if (sql.startsWith('UPDATE usp_outbox_streams')) return [{ sequence: '1' }];
      if (sql.startsWith('INSERT INTO usp_outbox')) return [];
      if (sql.startsWith('SELECT pg_advisory')) return [];
      return null;
    })();
    if (!rows) throw new Error(`Unexpected SQL: ${sql}`);
    return { rows, rowCount: rows.length };
  } } as unknown as PoolClient;
  return { client, sources, item };
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
    const result = converted();
    const files = new Map<string, Buffer>();
    const layers = result.layers.map((layer: any) => {
      if (layer.state !== 'converted') return layer;
      for (const name of ['geojson', 'sidecar']) {
        const objectKey = `native-derivatives/${result.sha256}/${layer.ordinal}/${name}-${layer[name].sha256}`;
        files.set(objectKey, readFileSync(layer[name].path));
        layer[name] = { objectKey, bytes: layer[name].bytes, sha256: layer[name].sha256 };
      }
      return layer;
    });
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
      layer: 'footprints', ordinal: 1, crs: 'EPSG:2958', features: 2500, notWritten: 0, sidecar: undefined });
    assert.deepEqual(registered.map(entry => entry.sourceId), children);
    assert.equal(item.placement, 'needs_answer');
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
  const stored = { objectKey: `native-derivatives/${'a'.repeat(64)}/0/geojson-${'b'.repeat(64)}`, bytes: 10,
    sha256: 'b'.repeat(64) };
  const conversion = NativeConversionSchema.parse({ conversion: 'native_gis_to_geojson@1', readerVersion: 'r',
    sourceId, sourceSha256: 'a'.repeat(64), layers: [
      { layer: 'roads', ordinal: 0, state: 'converted', crs: 'EPSG:32643', features: 3, notWritten: 0,
        geojson: stored, sidecar: stored },
      { layer: 'blocks', ordinal: 1, state: 'not_converted',
        reason: 'stores measure (M) values on every geometry' }] });
  assert.deepEqual(nativeParentState('shapefile_zip', conversion,
    [{ layer: 'roads', sourceId: null, code: 'UPLOAD_QUOTA' }]), { state: 'read', placement: 'undecided',
    planRef: null, recordsSeen: 0, limitReason: 'Not converted: blocks (stores measure (M) values on every '
      + 'geometry). Converted but not taken in: roads (UPLOAD_QUOTA; enrol the file again to retry).' });
  assert.equal(nativeParentState('gpkg', { ...conversion, layers: [conversion.layers[1]] }, []).placement,
    'not_understood');
});
