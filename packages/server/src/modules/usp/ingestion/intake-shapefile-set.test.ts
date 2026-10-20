import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { PoolClient } from 'pg';
import type { IntakeCard } from '@ulpin/contracts/usp';
import { localOperatorSubject } from '../principal';
import { probeOriginal } from './intake-probe';
import { convertNativeLayers, queueShapefileSetTx, stateLayerCrsTx,
  type NativeDerivativeDependencies } from './intake-native-derivative';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'shapefile-set-protocol';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
// The geo service's own Python and the real Tweed shapefile ZIP SH2 used; a box without them skips those tests.
const python = process.env.ULPIN_GEO_PYTHON ?? 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const TWEED_ZIP = 'E:/BhuAayam-data/datasets/map-formats/tweed-shire-council/TSC_Buildings_OD_8831041243266425049.zip';
const ready = existsSync(python) && existsSync(TWEED_ZIP);

/**
 * `unpack` writes the ZIP's members as loose parts (test_only copies; the original is not touched) and prints the
 * ZIP's own conversion. `convert` runs the geo service's convert-native on a request over those loose files.
 */
const script = `
import hashlib, io, json, shutil, sys, zipfile
from pathlib import Path
sys.path.insert(0, 'services/geo')
from geo.native_gis import convert_native, convert_native_file
mode, folder = sys.argv[1], Path(sys.argv[2])
if mode == 'unpack':
    zipped, out = Path(sys.argv[3]), folder / 'zipped'
    with zipfile.ZipFile(zipped) as archive:
        for entry in archive.infolist():
            (folder / entry.filename).write_bytes(archive.read(entry))
    out.mkdir()
    [layer] = convert_native_file(zipped, 'shapefile_zip', out, hashlib.sha256(zipped.read_bytes()).hexdigest())
    print(json.dumps(json.loads(Path(layer['geojson']['path']).read_text('utf-8'))['features']))
else:
    request, files, uploads = json.loads(sys.argv[3]), json.loads(sys.argv[4]), {}
    class Body(io.BytesIO):
        def iter_chunks(self, chunk_size):
            while block := self.read(chunk_size):
                yield block
    class Storage:
        def get_object(self, Bucket, Key):
            return {'Body': Body(Path(files[Key]).read_bytes())}
        def upload_file(self, path, bucket, key, ExtraArgs):
            uploads[key] = str(folder / f'upload-{len(uploads)}')
            shutil.copyfile(path, uploads[key])
    print(json.dumps({'result': convert_native(request, Storage()), 'uploads': uploads}))`;

const run = (...args: string[]) => execFileSync(python, ['-B', '-c', script, ...args], { encoding: 'utf8',
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });

const caseId = '40000000-0000-4000-8000-000000000001';
const extensions = ['shp', 'shx', 'dbf', 'prj', 'cpg'];
// An item and its original are named by the file's name, so the same file has the same IDs in every batch.
const idOf = (kind: 'item' | 'source', name: string) =>
  `40000000-0000-4000-8000-${kind === 'item' ? '1' : '2'}${sha(Buffer.from(name)).slice(0, 11)}`;

function retained(id: string, bytes: number, hash: string, name: string) {
  return { id, case_id: caseId, family_id: id, revision: 1, bytes, sha256: hash, profile: 'large-original-v1',
    object_key: `large-originals/${id}/${hash}`, name, status: 'needs_input', inspection: {
      largeOriginal: { uploadId: id, operatorSubject: localOperatorSubject(), objectEtag: 'etag',
        verifiedSha256: hash, verifiedBytes: bytes, conversion: 'unsupported',
        bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed',
        provenance: { origin: 'not_stated', acquiredAt: '2026-10-21T00:00:00.000Z', state: 'not_stated' } } } };
}

/** A batch's sources, root items and jobs in memory, answering the statements the set path issues. */
function batch() {
  const sources = new Map<string, any>();
  const items = new Map<string, any>();
  const jobs: any[] = [];
  const latest = (row: any) => ![...sources.values()].some(other =>
    other.family_id === row.family_id && other.revision > row.revision);
  const handlers: [string, (values: any[]) => any[]][] = [
    ['SELECT i.item_id,i.card', ([, names]) => [...items.values()]
      .map(item => ({ item, source: sources.get(item.source_id) }))
      .filter(({ item, source }) => item.card && names.includes(source.name.toLowerCase()) && latest(source))
      .sort((a, b) => a.source.name.localeCompare(b.source.name))
      .map(({ item, source }) => ({ item_id: item.item_id, card: item.card, plan_ref: item.plan_ref,
        source_id: source.id, name: source.name, revision: source.revision, sha256: source.sha256,
        object_key: source.object_key, bytes: source.bytes }))],
    ['SELECT * FROM usp_intake_items WHERE source_id', ([sourceId]) =>
      [...items.values()].filter(item => item.source_id === sourceId)],
    ['SELECT * FROM usp_intake_items WHERE case_id', ([, itemId]) => [items.get(itemId)]],
    ['SELECT * FROM usp_intake_items WHERE item_id', ([itemId]) => [items.get(itemId)]],
    ['SELECT state,placement,plan_ref', ([, itemId]) => [items.get(itemId)]],
    ['UPDATE usp_intake_items SET state=', ([, itemId, state, placement, planRef, , limitReason]) => {
      Object.assign(items.get(itemId), { state, placement, plan_ref: planRef, limit_reason: limitReason });
      return [];
    }],
    ['SELECT item_id AS', ([, itemId]) => [{ itemId, state: items.get(itemId).state, family: 'vector',
      format: 'shapefile', sizeClass: 'S', wave: 1, pinnedByOfficer: false }]],
    ['SELECT id,revision,archived FROM cases', () => [{ id: caseId, revision: 4, archived: false }]],
    ['SELECT revision FROM cases', () => [{ revision: 4 }]],
    ['UPDATE usp_outbox_streams', () => [{ sequence: '1' }]],
    ['INSERT INTO usp_outbox', () => []],
    ['SELECT pg_advisory', () => []],
    ['SELECT * FROM sources', ([, id]) => [sources.get(id)]],
    ['SELECT id FROM sources', ([, hash, original, layer]) => [...sources.values()].filter(row => row.sha256 === hash
      && row.inspection.nativeDerivative?.originalSha256 === original
      && row.inspection.nativeDerivative?.layer === layer)],
    ['UPDATE sources', ([id, lineage]) => {
      sources.get(id).inspection.nativeDerivative = lineage;
      return [];
    }],
    ['SELECT 1 FROM jobs', ([sourceId]) => jobs.filter(job => job.source_id === sourceId && job.status === 'running')],
    ['SELECT id,status', ([sourceId]) => jobs.filter(job => job.source_id === sourceId)],
    ['INSERT INTO jobs', ([id, , sourceId, caseRevision, digest, payload]) => {
      jobs.push({ id, case_id: caseId, source_id: sourceId, operation: 'intake-native-derivative',
        case_revision: caseRevision, input_fingerprint: digest, payload, status: 'queued' });
      return [];
    }],
    ['SELECT * FROM jobs', ([id]) => jobs.filter(job => job.id === id)],
    ['SELECT * FROM usp_job_metadata', () => []],
    ['INSERT INTO usp_job_metadata', () => []],
  ];
  const client = { query: async (sql: string, values: any[] = []) => {
    const handler = handlers.find(([prefix]) => sql.startsWith(prefix));
    if (!handler) throw new Error(`Unexpected SQL: ${sql}`);
    const rows = handler[1](values);
    return { rows, rowCount: rows.length };
  } } as unknown as PoolClient;

  /** Drops one file into the batch: its original retained, its item probed with `card`. */
  function drop(name: string, bytes: Uint8Array, card: Partial<IntakeCard>) {
    const source = retained(idOf('source', name), bytes.length, sha(bytes), name);
    sources.set(source.id, source);
    items.set(idOf('item', name), { item_id: idOf('item', name), case_id: caseId, source_id: source.id,
      parent_item_id: null, card, state: 'probed', placement: 'undecided', plan_ref: null, limit_reason: null });
    return queueShapefileSetTx(client, source, card as IntakeCard);
  }
  return { client, sources, items, jobs, drop };
}

/** Each item's state, placement and words, by its original's name. */
const words = (ledger: ReturnType<typeof batch>) => Object.fromEntries([...ledger.items.values()].map(item =>
  [ledger.sources.get(item.source_id).name, [item.state, item.placement, item.limit_reason]]));

/** Every part of the real Tweed shapefile, unpacked from its ZIP, with the card the probe gives its bytes. */
async function tweedParts(folder: string) {
  const zipFeatures = JSON.parse(run('unpack', folder, TWEED_ZIP));
  const parts = new Map<string, { name: string; path: string; bytes: Buffer; card: IntakeCard }>();
  for (const extension of extensions) {
    const name = `Council_Buildings.${extension}`;
    const bytes = readFileSync(join(folder, name));
    const card = await probeOriginal(async (start, end) => bytes.subarray(start, end), bytes.length, name);
    parts.set(extension, { name, path: join(folder, name), bytes, card });
  }
  return { parts, zipFeatures };
}

/** The real geo conversion over the batch's loose parts; each stored derivative is put in `files` by its key. */
function dependencies(ledger: ReturnType<typeof batch>, folder: string, files: Map<string, Buffer>,
  requests: any[]): NativeDerivativeDependencies {
  const paths = Object.fromEntries([...ledger.sources.values()].map(source =>
    [source.object_key, join(folder, source.name)]));
  return {
    transaction: (async (work: (c: PoolClient) => unknown) => work(ledger.client)) as
      NativeDerivativeDependencies['transaction'],
    read: async (key, start, end) => files.get(key)!.subarray(start, end),
    convert: async request => {
      requests.push(request);
      const { result, uploads } = JSON.parse(run('convert', folder, JSON.stringify(request), JSON.stringify(paths)));
      for (const [key, path] of Object.entries(uploads)) files.set(key, readFileSync(path as string));
      return result;
    },
    register: async () => ({}),
    large: {
      create: async (_case: string, input: any) => ({ id: input.filename, revision: 1, currentCaseRevision: 4 }),
      claimPart: async (_case: string, id: string) => ({ id }),
      receivePart: async () => ({ id: 'upload', revision: 2, currentCaseRevision: 4 }),
      failPart: async () => {},
      finalize: async (_case: string, _id: string, input: { sha256: string; bytes: number }) => {
        const id = '40000000-0000-4000-8000-300000000000';
        ledger.sources.set(id, { ...retained(id, input.bytes, input.sha256, 'Council_Buildings.geojson'),
          family_id: id });
        return { source: { sourceId: id } };
      },
      abort: async () => {},
    } as unknown as NativeDerivativeDependencies['large'],
  };
}

test('loose Tweed parts dropped .dbf, .shp, .shx: one job, read as one shapefile with the features of its ZIP',
  { skip: !ready }, async () => {
    const folder = mkdtempSync(join(tmpdir(), 'shapefile-set-'));
    const { parts, zipFeatures } = await tweedParts(folder);
    const ledger = batch();
    const dropped: Record<string, boolean> = {};
    for (const extension of ['prj', 'cpg', 'dbf', 'shp', 'shx']) {
      const part = parts.get(extension)!;
      dropped[extension] = await ledger.drop(part.name, part.bytes, part.card);
      if (extension === 'shp') assert.deepEqual(words(ledger)['Council_Buildings.dbf'],
        ['probed', 'undecided', 'Shapefile part: waiting for .shx of Council_Buildings.']);
    }
    // The real bytes are typed by their probe; a .prj and .cpg, and a .dbf with no .shp or .shx yet, keep their path.
    assert.deepEqual([...parts.values()].map(part => part.card.format),
      ['shapefile', 'shapefile-index', 'dbf', 'unknown', 'unknown']);
    assert.deepEqual(dropped, { prj: false, cpg: false, dbf: false, shp: true, shx: true });
    assert.equal(ledger.jobs.length, 1);
    const [job] = ledger.jobs;
    const shp = 'Council_Buildings.shp';
    assert.deepEqual([job.source_id, job.payload.itemId], [idOf('source', shp), idOf('item', shp)]);
    assert.deepEqual(job.payload.members.map((member: any) => [member.extension, member.sha256]),
      extensions.map(extension => [extension, sha(parts.get(extension)!.bytes)]));
    const read = ['read', 'undecided', 'Read with Council_Buildings.shp as one shapefile.'];
    assert.deepEqual(words(ledger), { [shp]: ['reading', 'undecided', 'The layers of this shapefile are being '
      + 'converted to GeoJSON, each to be taken in as its own file.'], 'Council_Buildings.shx': read,
    'Council_Buildings.dbf': read, 'Council_Buildings.prj': read, 'Council_Buildings.cpg': read });

    // Parts published in another order queue the same job.
    const other = batch();
    for (const extension of ['shx', 'cpg', 'shp', 'prj', 'dbf']) {
      const part = parts.get(extension)!;
      await other.drop(part.name, part.bytes, part.card);
    }
    assert.deepEqual(other.jobs.map(entry => entry.id), [job.id]);
    // Published again, a part finds the job waiting and queues none.
    await ledger.drop('Council_Buildings.dbf', parts.get('dbf')!.bytes, parts.get('dbf')!.card);
    assert.equal(ledger.jobs.length, 1);

    const files = new Map<string, Buffer>();
    const requests: any[] = [];
    const deps = dependencies(ledger, folder, files, requests);
    // A job whose set changed since it was queued converts and writes nothing.
    assert.deepEqual(await convertNativeLayers(caseId, job.payload.itemId, deps, job.payload.members.slice(0, 3)), []);
    assert.equal(requests.length, 0);

    const [child] = await convertNativeLayers(caseId, job.payload.itemId, deps, job.payload.members);
    assert.deepEqual([requests[0].format, requests[0].layer, requests[0].members.length],
      ['shapefile_set', 'Council_Buildings', 5]);
    const geojson = JSON.parse(files.get([...files.keys()].find(key => key.includes('/geojson-'))!)!.toString('utf8'));
    assert.deepEqual(geojson.features, zipFeatures);
    assert.equal(geojson.features.length, 88);
    const lineage = ledger.sources.get(child).inspection.nativeDerivative;
    assert.deepEqual([lineage.format, lineage.layer, lineage.crs, lineage.crsSource, lineage.originalSourceId],
      ['shapefile_set', 'Council_Buildings', 'EPSG:28356', 'stated', idOf('source', shp)]);
    assert.deepEqual(lineage.members, job.payload.members);
    assert.deepEqual(words(ledger)[shp], ['read', 'undecided', '1 layer of this shapefile is converted to '
      + 'GeoJSON and taken in as its own file: Council_Buildings. Read as one shapefile from its parts: '
      + 'Council_Buildings.shp, Council_Buildings.shx, Council_Buildings.dbf, Council_Buildings.prj, '
      + 'Council_Buildings.cpg.']);
  });

test('a set with no .prj asks the officer for its layer\'s system, and the answer converts it as stated',
  { skip: !ready }, async () => {
    const folder = mkdtempSync(join(tmpdir(), 'shapefile-set-'));
    const { parts } = await tweedParts(folder);
    const ledger = batch();
    for (const extension of ['shp', 'shx', 'dbf']) {
      const part = parts.get(extension)!;
      await ledger.drop(part.name, part.bytes, part.card);
    }
    const files = new Map<string, Buffer>();
    const requests: any[] = [];
    const deps = dependencies(ledger, folder, files, requests);
    const shp = ledger.sources.get(idOf('source', 'Council_Buildings.shp'));
    const parent = ledger.items.get(idOf('item', 'Council_Buildings.shp'));
    assert.deepEqual(await convertNativeLayers(caseId, parent.item_id, deps, ledger.jobs[0].payload.members), []);
    assert.equal(parent.placement, 'needs_answer');
    assert.deepEqual(parent.plan_ref, { nativeLayers: { unstated: ['Council_Buildings'], answers: [] } });
    assert.match(parent.limit_reason, /^Not converted until its coordinate reference system is stated: Council_Build/);

    ledger.jobs[0].status = 'completed';
    await stateLayerCrsTx(ledger.client, shp, parent.item_id, { layer: 'Council_Buildings', crs: 'EPSG:28356' });
    assert.deepEqual(ledger.jobs.map(job => job.status), ['completed', 'queued']);
    assert.deepEqual(ledger.jobs[1].payload.members, ledger.jobs[0].payload.members);
    const [child] = await convertNativeLayers(caseId, parent.item_id, deps, ledger.jobs[1].payload.members);
    assert.deepEqual(requests[1].layerCrs, { Council_Buildings: 'EPSG:28356' });
    const lineage = ledger.sources.get(child).inspection.nativeDerivative;
    assert.deepEqual([lineage.crs, lineage.crsSource, lineage.features], ['EPSG:28356', 'officer_stated', 88]);
  });

// test_only parts generated here: only their names and the format the probe would give their bytes matter.
const bytes = (text: string) => Buffer.from(text);
const shapefileCard = { format: 'shapefile', family: 'vector' } as const;
const shxCard = { format: 'shapefile-index', family: 'vector' } as const;
const dbfCard = { format: 'dbf', family: 'table' } as const;

test('a stem holding two .dbf rests every part in words naming both, and nothing is converted', async () => {
  const ledger = batch();
  await ledger.drop('wards/blocks.shp', bytes('shp'), shapefileCard);
  await ledger.drop('wards/blocks.dbf', bytes('dbf'), dbfCard);
  // The same stem in another case is a second .dbf: an original of its own, not a revision of the first.
  assert.equal(await ledger.drop('wards/Blocks.DBF', bytes('DBF'), dbfCard), true);
  assert.equal(await ledger.drop('wards/blocks.shx', bytes('shx'), shxCard), true);
  const refused = ['probed', 'not_understood', 'Shapefile part: blocks has more than one .dbf (blocks.dbf, '
    + 'Blocks.DBF), so its parts are not read together as one shapefile.'];
  assert.deepEqual(Object.values(words(ledger)), [refused, refused, refused, refused]);
  assert.equal(ledger.jobs.length, 0);
});

test('a set short of its .shx waits in words; a lone .dbf and a misnamed file keep their own path', async () => {
  const ledger = batch();
  assert.equal(await ledger.drop('parcels.dbf', bytes('dbf'), dbfCard), false);
  assert.equal(ledger.items.get(idOf('item', 'parcels.dbf')).limit_reason, null);
  assert.equal(await ledger.drop('roads.shp', bytes('shp'), shapefileCard), true);
  assert.equal(await ledger.drop('roads.dbf', bytes('dbf'), dbfCard), true);
  const waiting = ['probed', 'undecided', 'Shapefile part: waiting for .shx of roads.'];
  assert.deepEqual([words(ledger)['roads.shp'], words(ledger)['roads.dbf']], [waiting, waiting]);
  assert.equal(ledger.jobs.length, 0);
  // A file named .shx whose bytes are not a shapefile index is not taken as one.
  assert.equal(await batch().drop('roads.shx', bytes('text'), { format: 'unknown', family: 'unknown' }), false);
});
