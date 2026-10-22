import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync, readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import type {PoolClient} from 'pg';
import {GltfOriginalSchema, GltfResultSchema} from '../packages/contracts/src/usp/gltf-ingestion';
import {GLTF_CODE_FILES, gltfReadToolsCompatible} from '../packages/server/src/modules/usp/ingestion/gltf-config';
import {gltfReaderSha, assertGltfInputTx, gltfStatusTx} from '../packages/server/src/modules/usp/ingestion/gltf';
import {gltfSummary} from '../packages/server/src/modules/usp/ingestion/gltf-processor';
import {fusionGltfSourceProjection} from '../packages/server/src/modules/usp/ingestion/source-fusion-gltf';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {settings} from '../packages/server/src/infrastructure/config';

// Saved test_only originals and native artifacts; tool comparison and SQL are offline controls, not runtime admission.
const root = 'E:/BhuAayam-data/task-data/gltf-api-20261018-run01';
const originals = 'E:/BhuAayam-data/task-data/desktop-gltf-native/originals';
const oldReader = '92035c6c891d4e7c0e7a74a7c1980e9f0489d29f7046eadb639d9b6311ed9097';
const unknown = 'f'.repeat(64);
const savedProfileBytes = readFileSync(join(root, 'profile.json'));
const savedProfile = JSON.parse(savedProfileBytes.toString('utf8'));
const nonRepositorySha = fingerprint(savedProfile.files.filter((file: {root: string}) => file.root !== 'repository'));

function fixture(name: string) {
  const result = GltfResultSchema.parse(JSON.parse(readFileSync(join(root, name + '.journey.json'), 'utf8')).accepted);
  const bytes = readFileSync(join(root, name + '.native.json'));
  assert.equal(result.input.readerSha256, oldReader);
  assert.equal(sha256(savedProfileBytes), result.input.tools!.profileSha256);
  assert.equal(sha256(bytes), result.artifact.sha256);
  return {result, bytes, native: JSON.parse(bytes.toString('utf8'))};
}

function currentTools(stored: NonNullable<ReturnType<typeof fixture>['result']['input']['tools']>) {
  const repo = settings.repositoryRoot;
  return {...stored, readerSha256: gltfReaderSha(), profileSha256: unknown,
    supervisorSha256: sha256(Buffer.concat(['scripts/usp/gltf/server.py', 'scripts/usp/gltf/profile.py']
      .map(path => readFileSync(join(repo, path))))),
    codeSha256: fingerprint(GLTF_CODE_FILES.map(path => ({path, sha256: sha256(readFileSync(join(repo, path)))})))};
}

function projected(result: ReturnType<typeof fixture>['result'], native: unknown) {
  const input = result.input;
  return fusionGltfSourceProjection({kind: 'gltf', pin: {
    caseId: input.caseId, caseRevision: input.caseRevision, sourceId: input.sourceId,
    sourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256, jobId: input.jobId,
    resultSha256: sha256(Buffer.from(JSON.stringify(result))), resultBytes: Buffer.byteLength(JSON.stringify(result)),
    readerSha256: input.readerSha256, inputSha256: fingerprint(input), acceptedFence: 1,
  }, nodeIndices: [1]}, {result, native});
}

function compareReaderVersions(raw: Buffer) {
  const previous = spawnSync('git', ['show', 'd4f1b78d^:services/geo/geo/native_gltf.py'], {encoding: 'utf8'});
  assert.equal(previous.status, 0, previous.stderr);
  const script = [
    'import base64, json, sys',
    'sys.path.insert(0, "services/geo")',
    'from geo.native_gltf import inspect_gltf',
    'request = json.load(sys.stdin)',
    'previous = {}',
    'exec(compile(request["previous"], "pre-buffer-native_gltf.py", "exec"), previous)',
    'raw = base64.b64decode(request["raw"])',
    'print(json.dumps({"previous": previous["inspect_gltf"](raw), "current": inspect_gltf(raw)}))',
  ].join('\n');
  const run = spawnSync('python', ['-B', '-c', script], {encoding: 'utf8',
    input: JSON.stringify({previous: previous.stdout, raw: raw.toString('base64')})});
  assert.equal(run.status, 0, run.stderr);
  const comparison = JSON.parse(run.stdout);
  assert.deepEqual(comparison.current, comparison.previous);
  return comparison.current;
}

test('reviewed pre-buffer reader keeps embedded and unresolved external citations exactly as stored', () => {
  for (const name of ['Box.glb', 'Box.gltf']) {
    const {result, bytes, native} = fixture(name);
    const before = JSON.stringify(result);
    const stored = result.input.tools!;
    assert.equal(gltfReadToolsCompatible(stored, currentTools(stored), nonRepositorySha), true);
    assert.deepEqual(gltfSummary(bytes, result.input), result.summary);
    const fragment = projected(result, native);
    if (name === 'Box.gltf') {
      assert.equal(fragment.buffers[0].record.status, 'needs_input');
      assert.equal(fragment.summary.projectedPositions, 0);
      assert(fragment.primitives[0].omittedArrays.every(array => array.state === 'absent'));
    } else {
      assert.deepEqual(fragment.primitives[0].omittedArrays.map(array => array.count), [24, 36]);
    }
    assert.equal(JSON.stringify(result), before);
  }
});

test('embedded data-uri bytes keep the old positions and citation summary', () => {
  const raw = readFileSync(join(originals, 'Box.glb'));
  const jsonSize = raw.readUInt32LE(12);
  const document = JSON.parse(raw.subarray(20, 20 + jsonSize).toString('utf8'));
  const binary = raw.subarray(28 + jsonSize, 28 + jsonSize + document.buffers[0].byteLength);
  document.buffers[0].uri = 'data:application/octet-stream;base64,' + binary.toString('base64');
  const embedded = Buffer.from(JSON.stringify(document));
  const native = compareReaderVersions(embedded);
  const {result} = fixture('Box.glb');
  const input = {...result.input, sourceSha256: sha256(embedded), sourceBytes: embedded.length};
  const summary = gltfSummary(Buffer.from(JSON.stringify(native)), input);
  assert.equal(native.buffers[0].kind, 'embedded_base64');
  assert.equal(summary.projectedPositions, result.summary.projectedPositions);
  assert.deepEqual(native.primitives[0].projection.POSITION.values,
    fixture('Box.glb').native.primitives[0].projection.POSITION.values);
  assert(!Object.hasOwn(summary, 'companions'));
});

test('BoxTextured samples retain every native citation field', {
  skip: !process.env.GLTF_COMPAT_BOX_TEXTURED_ROOT && 'BoxTextured originals are not retained locally; offline only',
}, () => {
  for (const name of ['BoxTextured.glb', 'BoxTextured.gltf']) {
    const raw = readFileSync(join(process.env.GLTF_COMPAT_BOX_TEXTURED_ROOT!, name));
    const native = compareReaderVersions(raw);
    const {result} = fixture('Box.glb');
    const input = {...result.input, sourceSha256: sha256(raw), sourceBytes: raw.length};
    assert.equal(gltfSummary(Buffer.from(JSON.stringify(native)), input).sourceSha256, sha256(raw));
  }
});

test('unknown readers, unreviewed profiles and changed current tools are not read aliases', () => {
  const {result} = fixture('Box.glb');
  const stored = result.input.tools!;
  const current = currentTools(stored);
  assert.equal(gltfReadToolsCompatible({...stored, readerSha256: unknown}, current, nonRepositorySha), false);
  assert.equal(gltfReadToolsCompatible({...stored, profileSha256: unknown}, current, nonRepositorySha), false);
  assert.equal(gltfReadToolsCompatible(stored, current), false, 'missing verified current inventory');
  assert.equal(gltfReadToolsCompatible(stored, current, unknown), false, 'changed runtime or environment');
  for (const key of ['readerSha256', 'supervisorSha256', 'pythonSha256', 'dependencyLockSha256', 'codeSha256']) {
    assert.equal(gltfReadToolsCompatible(stored, {...current, [key]: 'a'.repeat(64)}, nonRepositorySha), false, key);
  }
});

test('old reader never admits joined, refused, unsafe or unclassified external buffers', () => {
  const {result, native} = fixture('Box.gltf');
  const mutations = [
    {status: 'available', kind: 'external_uri'},
    {status: 'available', kind: 'bound_companion'},
    {status: 'refused', kind: 'external_uri'},
    {status: 'needs_input', kind: 'unclassified'},
    {status: 'needs_input', kind: 'glb_bin'},
    {status: 'needs_input', kind: 'external_uri', uri: '../Box0.bin'},
  ];
  for (const mutation of mutations) {
    const changed = structuredClone(native);
    Object.assign(changed.buffers[0], mutation);
    assert.throws(() => gltfSummary(Buffer.from(JSON.stringify(changed)), result.input),
      (error: any) => error.code === 'GLTF_TOOL_CHANGED');
  }
  const input = {...result.input, buffers: [{bufferIndex: 0, uri: 'Box0.bin', state: 'ambiguous' as const,
    name: 'Box0.bin', candidates: 2}]};
  assert.throws(() => gltfSummary(Buffer.from(JSON.stringify(native)), input),
    (error: any) => error.code === 'GLTF_TOOL_CHANGED');
});

function sourceControl(result: ReturnType<typeof fixture>['result']) {
  const input = result.input;
  const original = GltfOriginalSchema.parse({version: input.version, subject: input.subject,
    accessSha256: input.accessSha256, sha256: input.sourceSha256, bytes: input.sourceBytes,
    receivedAt: result.createdAt, lineageState: 'caller_declared', lineage: {
      issuer: null, originalUrl: null, acquiredAt: null, permissionReference: null, geography: null, limitations: [],
    }});
  const source = {id: input.sourceId, case_id: input.caseId, family_id: input.sourceFamilyId,
    revision: input.sourceRevision, profile: 'gltf-native-v1', sha256: input.sourceSha256,
    bytes: input.sourceBytes, object_key: input.objectKey, inspection: {gltfOriginal: original}};
  const current = {id: input.caseId, revision: input.caseRevision, archived: false,
    frame: null, context: null, site_id: null};
  const digest = fingerprint(input), bytes = Buffer.from(JSON.stringify(result));
  const job = {id: input.jobId, operation: 'gltf-native', case_id: input.caseId, source_id: input.sourceId,
    case_revision: input.caseRevision, payload: input, input_fingerprint: digest, input_sha256: digest,
    status: 'succeeded', logical_state: 'succeeded', accepted_fence: 1, attempt_fence: 1,
    attempt_state: 'accepted', attempt_input_sha256: digest, completion_sha256: sha256(bytes),
    result_ref: {assetId: `gltf:${input.jobId}:${bytes.length}`, sha256: sha256(bytes), version: 1}};
  const client = {query: async (sql: string) => {
    if (sql.includes('SELECT id,revision,archived,frame,context,site_id')) return {rows: [current]};
    if (sql.includes('SELECT * FROM sources')) return {rows: [source]};
    if (sql.includes('SELECT max(revision)')) return {rows: [{revision: input.sourceRevision}]};
    if (sql.includes('SELECT j.*,m.result_ref')) return {rows: [job]};
    assert.fail('A stored reading must not look for or join later companions: ' + sql);
  }} as unknown as PoolClient;
  return {client, job};
}

test('the read alias does not authorize queued jobs, unknown readers or strict worker input checks', async () => {
  const {result} = fixture('Box.gltf');
  const prior = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = result.input.subject;
  try {
    const {client, job} = sourceControl(result), input = result.input;
    const before = fingerprint(input);
    assert.equal((await gltfStatusTx(client, input.caseId, input.sourceId, input.jobId)).stale, false);
    await assert.rejects(() => assertGltfInputTx(client, input), (error: any) => error.status === 409);
    job.status = 'queued';
    assert.equal((await gltfStatusTx(client, input.caseId, input.sourceId, input.jobId)).stale, true);
    job.status = 'succeeded';
    assert.equal(fingerprint(input), before);
    const changed = structuredClone(result);
    changed.input.readerSha256 = unknown;
    changed.input.tools!.readerSha256 = unknown;
    const unknownControl = sourceControl(changed);
    const row = await gltfStatusTx(unknownControl.client, input.caseId, input.sourceId, input.jobId);
    assert.equal(row.stale, true);
  } finally {
    if (prior === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = prior;
  }
});

test('GB1 reproduces every saved journey artifact, summary and citation projection without a companion', () => {
  const journeys = readdirSync(root).filter(name => name.endsWith('.journey.json'));
  assert.deepEqual(journeys.sort(), ['Box.glb.journey.json', 'Box.gltf.journey.json']);
  for (const journey of journeys) {
    const name = journey.slice(0, -'.journey.json'.length);
    const {result, native} = fixture(name);
    const currentNative = compareReaderVersions(readFileSync(join(originals, name)));
    assert.deepEqual(currentNative, native, name + ': all native citation fields');
    assert.deepEqual(gltfSummary(Buffer.from(JSON.stringify(currentNative)), result.input), result.summary);
    assert.deepEqual(projected(result, currentNative), projected(result, native));
  }
});
