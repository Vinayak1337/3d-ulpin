import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { PoolClient } from 'pg';
import { GltfInputSchema, GltfSummarySchema, type GltfBufferBinding } from '@ulpin/contracts/usp';
import { sha256 } from '../../../infrastructure/storage';
import { ingestionBinding } from './events';
import { assertGltfBuffersTx, bindGltfBuffers, gltfBufferBindingsTx, gltfCompanionName, gltfExternalBuffers,
  type GltfCompanionCandidate } from './gltf-companions';
import { gltfCompanionManifest, gltfSummary } from './gltf-processor';
import type { IntakeSourceRow } from './intake-context';
import { intakeNativeReadWords } from './intake-native-readers';

// test_only: a triangle glTF and its .bin written here from literal values; no record, survey or geometry claim.
const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
const bin = Buffer.concat([Buffer.from(new Float32Array(positions.flat()).buffer), Buffer.from(new Uint16Array([0, 1, 2]).buffer)]);
const triangle = (uris: string[] = ['tri.bin']) => Buffer.from(JSON.stringify({
  asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  buffers: uris.map(uri => ({ uri, byteLength: bin.length })),
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
    { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }],
}));

const candidate = (name: string, patch: Partial<GltfCompanionCandidate> = {}): GltfCompanionCandidate => ({
  sourceId: randomUUID(), name, memberPath: null, sha256: sha256(bin), bytes: bin.length,
  objectKey: `large-originals/${randomUUID()}/${sha256(bin)}`, authorized: true, ...patch });

test('the uri rule matches the Python reader: plain sibling names only, percent-decoded', () => {
  assert.equal(gltfCompanionName('tri.bin'), 'tri.bin');
  assert.equal(gltfCompanionName('tri%20mesh.bin'), 'tri mesh.bin');
  for (const uri of ['../tri.bin', 'dir/tri.bin', 'dir\\tri.bin', '%2E%2E%2Ftri.bin', 'a%2Ftri.bin',
    'https://127.0.0.1/tri.bin', 'file:///C:/tri.bin', 'C:tri.bin', 'tri.bin?x=1', 'tri.bin#x', '..', 'tri%zz.bin',
    'tri%FF.bin', '']) {
    assert.equal(gltfCompanionName(uri), null, uri);
  }
});

test('binds by exact name in one case; case-sensitive; none is not recorded', () => {
  const uris = [{ bufferIndex: 0, uri: 'tri.bin' }, { bufferIndex: 1, uri: 'other.bin' }];
  const match = candidate('tri.bin');
  const [bound, ...rest] = bindGltfBuffers(uris, [match, candidate('TRI.bin'), candidate('tri.bin.txt')],
    { kind: 'source' }, 500);
  assert.deepEqual(bound, { bufferIndex: 0, uri: 'tri.bin', state: 'bound', name: 'tri.bin', sourceId: match.sourceId,
    memberPath: null, sha256: match.sha256, bytes: match.bytes, objectKey: match.objectKey });
  assert.deepEqual(rest, []);
  assert.deepEqual(bindGltfBuffers(uris, [candidate('Tri.bin')], { kind: 'source' }, 500), []);
});

test('two same-named retained originals refuse as ambiguous; unsafe, unauthorized and over-budget refuse', () => {
  const uris = [{ bufferIndex: 0, uri: 'tri.bin' }, { bufferIndex: 1, uri: '../tri.bin' }];
  assert.deepEqual(bindGltfBuffers(uris, [candidate('tri.bin'), candidate('tri.bin')], { kind: 'source' }, 500), [
    { bufferIndex: 0, uri: 'tri.bin', state: 'ambiguous', name: 'tri.bin', candidates: 2 },
    { bufferIndex: 1, uri: '../tri.bin', state: 'refused', reason: 'EXTERNAL_URI_NOT_PLAIN_NAME' }]);
  assert.equal(bindGltfBuffers(uris.slice(0, 1), [candidate('tri.bin', { authorized: false })], { kind: 'source' }, 500)[0]
    .state, 'refused');
  const big = bindGltfBuffers(uris.slice(0, 1), [candidate('tri.bin', { bytes: 16 * 1024 ** 2 })], { kind: 'source' }, 1);
  assert.deepEqual(big, [{ bufferIndex: 0, uri: 'tri.bin', state: 'refused', reason: 'BYTE_BUDGET' }]);
});

test('a glTF from a ZIP binds only the member at the same relative path inside that ZIP', () => {
  const zip = randomUUID(), uris = [{ bufferIndex: 0, uri: 'tri.bin' }];
  const member = candidate('tri.bin', { sourceId: zip, memberPath: 'models/tri.bin' });
  const others = [candidate('tri.bin', { sourceId: zip, memberPath: 'tri.bin' }),
    candidate('tri.bin', { sourceId: randomUUID(), memberPath: 'models/tri.bin' }), candidate('tri.bin')];
  const [bound] = bindGltfBuffers(uris, [member, ...others], { kind: 'zip_member', zipSourceId: zip,
    memberPath: 'models/scene.gltf' }, 500);
  assert.deepEqual([bound.state, (bound as any).sourceId, (bound as any).memberPath], ['bound', zip, 'models/tri.bin']);
  assert.deepEqual(bindGltfBuffers(uris, others.slice(1), { kind: 'zip_member', zipSourceId: zip,
    memberPath: 'models/scene.gltf' }, 500), []);
});

test('buffer uris are read from a .gltf and from a GLB JSON chunk; data: uris are not companions', () => {
  assert.deepEqual(gltfExternalBuffers(triangle(['tri.bin', 'data:application/octet-stream;base64,AAAA'])),
    [{ bufferIndex: 0, uri: 'tri.bin' }]);
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ byteLength: 4 }, { uri: 'b.bin', byteLength: 4 }] }));
  const padded = Buffer.concat([json, Buffer.alloc(-json.length & 3, 0x20)]);
  const header = Buffer.alloc(20);
  header.write('glTF', 0, 'latin1'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4E4F534A, 16);
  assert.deepEqual(gltfExternalBuffers(Buffer.concat([header, padded])), [{ bufferIndex: 1, uri: 'b.bin' }]);
  assert.equal(gltfExternalBuffers(Buffer.from('not json')), null);
});

/** A case with the glTF, its .bin and an unrelated file; SQL is a protocol double, nothing is persisted. */
function caseDouble(names: string[]) {
  const caseId = randomUUID(), binding = ingestionBinding(caseId);
  const row = (name: string, raw: Buffer): IntakeSourceRow => {
    const id = randomUUID(), hash = sha256(raw);
    return { id, case_id: caseId, family_id: id, revision: 1, name, profile: 'large-original-v1', bytes: raw.length,
      sha256: hash, object_key: `large-originals/${id}/${hash}`, status: 'needs_input',
      inspection: { largeOriginal: { uploadId: randomUUID(), operatorSubject: binding.subject, objectEtag: 'etag',
        verifiedSha256: hash, verifiedBytes: raw.length,
        provenance: { state: 'not_stated', origin: 'not_stated', acquiredAt: '2026-10-22T00:00:00.000Z' },
        conversion: 'unsupported', bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed' } } };
  };
  const gltf = row('scene.gltf', triangle()), rows = [gltf, ...names.map(name => row(name, bin))];
  const calls: string[] = [];
  const client = { query: async (sql: string, args: any[]) => {
    calls.push(sql);
    let found = rows.filter(r => r.case_id === args[0] && r.id !== args[1]);
    if (sql.includes('s.name=ANY')) found = found.filter(r => args[2].includes(r.name));
    if (sql.includes('s.id=ANY')) found = rows.filter(r => args[1].includes(r.id));
    return { rows: structuredClone(found), rowCount: found.length };
  } } as unknown as PoolClient;
  return { gltf, rows, client, calls, binding };
}

test('the job input records the binding by exact name; a case with no other file reads nothing', async () => {
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'gb1-protocol-operator';
  const { gltf, rows, client, binding } = caseDouble(['tri.bin', 'notes.pdf']);
  let reads = 0;
  const buffers = await gltfBufferBindingsTx(client, gltf, binding, async () => { reads++; return triangle(); });
  assert.equal(reads, 1);
  assert.deepEqual(buffers, [{ bufferIndex: 0, uri: 'tri.bin', state: 'bound', name: 'tri.bin', sourceId: rows[1].id,
    memberPath: null, sha256: sha256(bin), bytes: bin.length, objectKey: rows[1].object_key }]);
  const lone = caseDouble([]);
  assert.equal(await gltfBufferBindingsTx(lone.client, lone.gltf, lone.binding, async () => { throw new Error('read'); }),
    undefined);
  assert.equal(await gltfBufferBindingsTx(client, gltf, binding, async () => null), undefined);
  const twin = caseDouble(['tri.bin', 'tri.bin']);
  assert.equal((await gltfBufferBindingsTx(twin.client, twin.gltf, twin.binding, async () => triangle()))![0].state,
    'ambiguous');
  const input = { caseId: gltf.case_id, buffers } as any;
  await assertGltfBuffersTx(client, input, binding);
  rows[1].sha256 = '0'.repeat(64);
  await assert.rejects(assertGltfBuffersTx(client, input, binding), { status: 409, message: /buffer 0 \(tri\.bin\) changed/ });
});

function nativeReading(raw: Buffer, companions: object[]) {
  const script = 'import base64, json, sys\nfrom geo.native_gltf import inspect_gltf, write_inspection\n'
    + 'request = json.loads(sys.stdin.read())\n'
    + 'companions = [dict(c, data=base64.b64decode(c["data"])) if "data" in c else c for c in request["companions"]]\n'
    + 'write_inspection(inspect_gltf(base64.b64decode(request["gltf"]), companions=companions), sys.stdout.buffer)';
  return execFileSync(process.env.ULPIN_NR1_PYTHON ?? 'python', ['-B', '-c', script], {
    cwd: new URL('../../../../../../services/geo', import.meta.url), timeout: 20_000,
    input: JSON.stringify({ gltf: raw.toString('base64'), companions }),
  });
}

test('the reading joins the bound .bin and its item line names joined, missing and refused files', () => {
  const raw = triangle(['tri.bin', 'gone.bin', '../up.bin']);
  const sourceId = randomUUID(), objectKey = `large-originals/${sourceId}/${sha256(bin)}`;
  const buffers: GltfBufferBinding[] = [
    { bufferIndex: 0, uri: 'tri.bin', state: 'bound', name: 'tri.bin', sourceId, memberPath: null, sha256: sha256(bin),
      bytes: bin.length, objectKey },
    { bufferIndex: 2, uri: '../up.bin', state: 'refused', reason: 'EXTERNAL_URI_NOT_PLAIN_NAME' }];
  const input = { sourceSha256: sha256(raw), sourceBytes: raw.length, sceneIndex: null, buffers } as any;
  const { files, manifest } = gltfCompanionManifest(input, new Map([[0, bin]]), 'C:/scratch');
  const entries = JSON.parse(manifest.toString('utf8'));
  assert.deepEqual(entries.map((entry: any) => Object.keys(entry).sort().join(',')),
    ['bufferIndex,bytes,path,sha256,sourceId,state,uri', 'bufferIndex,reason,state,uri']);
  assert.equal(files[0].bytes, bin);
  assert.throws(() => gltfCompanionManifest(input, new Map([[0, bin.subarray(1)]]), 'C:/scratch'),
    { code: 'GLTF_COMPANION_INTEGRITY' });
  const reading = nativeReading(raw, [{ ...entries[0], path: undefined, data: bin.toString('base64') }, entries[1]]);
  const summary = GltfSummarySchema.parse(gltfSummary(reading, input));
  assert.equal(summary.projectedPositions, 3);
  assert.deepEqual([summary.joinedCompanionCount, summary.missingCompanionCount, summary.refusedCompanionCount], [1, 1, 1]);
  assert.deepEqual(summary.companions![0], { kind: 'buffer', index: 0, name: 'tri.bin', state: 'joined', reason: null,
    sourceId, sha256: sha256(bin), bytes: bin.length });
  const words = intakeNativeReadWords(summary);
  assert.ok(words.includes('Positions read: 3; companion files joined: 1 ("tri.bin"); still missing: 1 ("gone.bin"); '
    + 'refused: 1 ("../up.bin": not a plain file name beside the glTF);'), words);
  assert.match(words, /they are candidates/);
  assert.match(words, /A glTF states no coordinate reference system, so the model stays unplaced\./);
  assert.match(words, /kept as evidence and is not on the map yet/);
  assert.ok(words.length <= 2000);
  // A joined buffer the input never bound is a changed artifact, not a reading.
  assert.throws(() => gltfSummary(reading, { ...input, buffers: undefined }), { code: 'GLTF_ARTIFACT_INTEGRITY' });
  assert.ok(GltfInputSchema.shape.buffers.safeParse(buffers).success);
});
