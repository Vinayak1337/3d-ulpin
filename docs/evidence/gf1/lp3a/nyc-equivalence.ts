import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { ImportPackage } from '../../../../packages/contracts/src';
import { StreamingVectorPayloadSchema, type StreamingVectorInput, type StreamingVectorRecord,
  type StreamedMappingPlan } from '../../../../packages/contracts/src/usp';
import { query, transaction, migrate, closePool } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { closeStorageClient, putOriginal, sha256 } from '../../../../packages/server/src/infrastructure/storage';
import { ingestArea, ingestProvedAreaPart } from '../../../../packages/server/src/modules/areas/areas';
import { fingerprint } from '../../../../packages/server/src/modules/cases/domain';
import { claimUspJobAttempt, acceptUspJobAttempt } from '../../../../packages/server/src/modules/usp/jobs';
import { localOperatorSubject } from '../../../../packages/server/src/modules/usp/principal';
import { readStreamingFeatures, sourceRecord }
  from '../../../../packages/server/src/modules/usp/ingestion/streaming-vector-reader';
import { StreamingVectorService, assertStreamingInputTx }
  from '../../../../packages/server/src/modules/usp/ingestion/streaming-vector';
import { writeSealedMapReceiptTx } from '../../../../packages/server/src/modules/usp/ingestion/streamed-map-receipt';
import { StreamedProfileService } from '../../../../packages/server/src/modules/usp/ingestion/streamed-profile';
import { runStreamedProfileJob } from '../../../../packages/server/src/modules/usp/ingestion/streamed-profile-worker';
import { StreamedMappingService } from '../../../../packages/server/src/modules/usp/ingestion/streamed-mapping';
import type { ProvedAreaPartInput } from '../../../../packages/server/src/modules/usp/ingestion/proved-area-part';

const path = 'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson';
const bytes = readFileSync(path), digest = sha256(bytes);
const published = JSON.parse(readFileSync('scripts/demo-import/nyc-profile.json', 'utf8'));
const origin = published.layers.find((layer: any) => layer.sha256 === digest);
assert(origin);
const objects = new Map<string, Buffer>();
const requests = { puts: 0, whole: 0, ranges: 0, normalization: 0 };
const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const proof: Record<string, unknown> = { task: 'LP3a', sourceSha256: digest, sourceBytes: bytes.length,
  qualification: 'Direct internal import comparison on real PostgreSQL. Raw slots seeded from the PURE reader '
    + 'without PostGIS topology validation, as requested for NYC equivalence. '
    + 'The normalizer owns index 1322 quarantine. This is not the automatic HTTP walk or production admission.' };
const server = createServer((request, response) => { void serve(request, response); });

function ownedBox() {
  const nonce = process.env.ULPIN_LP3A_NONCE!, container = process.env.ULPIN_LP3A_CONTAINER!;
  assert.match(nonce, /^[a-f0-9]{16}$/);
  assert.equal(container, `ulpin-lp3a-tmp-${nonce}`);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'lp3a_control');
  assert.equal(url.pathname, `/lp3a_${nonce}`);
  assert.equal(url.password, '');
  for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'LP3a']])
    assert.equal(execFileSync('docker', ['inspect', '--format',
      `{{ index .Config.Labels "${key}" }}`, container], { encoding: 'utf8' }).trim(), value);
}
function normalize(data: unknown) {
  const code = 'import sys,json;sys.path.insert(0,"services/geo");'
    + 'from geo.area import normalize_area;print(json.dumps(normalize_area(json.load(sys.stdin))))';
  const result = spawnSync(python, ['-B', '-c', code], { input: JSON.stringify(data), encoding: 'utf8',
    timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.trim());
  return JSON.parse(result.stdout);
}
async function serve(request: IncomingMessage, response: ServerResponse) {
  try {
    const chunks: Buffer[] = [];
    for await (const value of request) chunks.push(Buffer.from(value));
    const body = Buffer.concat(chunks), key = request.url!.split('?')[0];
    if (key === '/internal/area/normalize') {
      requests.normalization++;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(normalize(JSON.parse(body.toString()))));
    } else if (request.method === 'PUT') {
      assert(!objects.has(key), 'Original control store is immutable.');
      requests.puts++;
      objects.set(key, body);
      response.writeHead(200, { ETag: `"${sha256(body)}"` });
      response.end();
    } else if (request.method === 'GET' && objects.has(key)) {
      const object = objects.get(key)!;
      requests.whole++;
      response.writeHead(200, { 'Content-Length': object.length, ETag: `"${sha256(object)}"` });
      response.end(object);
    } else if (request.method === 'HEAD' && objects.has(key)) {
      response.writeHead(200, { 'Content-Length': objects.get(key)!.length });
      response.end();
    } else { response.writeHead(404); response.end(); }
  } catch (error: any) {
    response.writeHead(422, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ detail: error.message }));
  }
}
async function standIns() {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}`;
  process.env.S3_ENDPOINT = endpoint;
  process.env.S3_ACCESS_KEY = randomBytes(12).toString('hex');
  process.env.S3_SECRET_KEY = randomBytes(24).toString('hex');
  process.env.S3_BUCKET = 'lp3a-equivalence-originals';
  process.env.GEO_URL = endpoint;
  process.env.GEO_SERVICE_TOKEN = randomBytes(24).toString('hex');
  const fetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.hostname, '127.0.0.1');
    return fetch(input, init);
  };
}
async function originalFixture() {
  const sourceId = randomUUID(), caseId = randomUUID(), objectKey = `lp3a-originals/${sourceId}/${digest}`;
  await putOriginal(objectKey, bytes, 'application/octet-stream');
  await transaction(async client => {
    await client.query('INSERT INTO cases(id,name,frame) VALUES($1,$2,$3)',
      [caseId, 'NYC pure-reader equivalence control', { id: 'UNASSIGNED', horizontalUnit: 'm', verticalUnit: 'm' }]);
    await client.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,
      object_key,status,inspection) VALUES($1,$2,$1,1,$3,'large-original-v1','application/octet-stream',
      $4,$5,$6,'needs_input',$7)`, [sourceId, caseId, origin.name, bytes.length, digest, objectKey, {
      status: 'needs_input', largeOriginal: { operatorSubject: localOperatorSubject(), verifiedBytes: bytes.length,
        verifiedSha256: digest, provenance: { issuer: published.issuer, originalUrl: origin.url } },
    }]);
  });
  const current = (await query('SELECT revision FROM cases WHERE id=$1', [caseId])).rows[0].revision;
  const reader = await new StreamingVectorService().enqueue(caseId, sourceId, { requestKey: randomUUID(),
    expectedCaseRevision: current, expectedSourceRevision: 1, sourceSha256: digest, framing: 'feature-collection' });
  const input = (await query('SELECT payload FROM jobs WHERE id=$1', [reader.jobId])).rows[0].payload;
  return { sourceId, caseId, current, reader, input: input as StreamingVectorInput };
}
async function publishPureFixture(input: StreamingVectorInput) {
  const attempt = await claimUspJobAttempt(input.jobId, 'lp3a-pure-reader-equivalence',
    client => assertStreamingInputTx(client, input).then(() => {}));
  const records: StreamingVectorRecord[] = [], features: ProvedAreaPartInput['features'] = [];
  const closure = await readStreamingFeatures(Readable.from([bytes]), 'feature-collection', async item => {
    records.push(sourceRecord(item));
    features.push({ rawChunkIndex: Math.floor(item.index / 100), featureIndex: item.index, rawBytes: item.raw });
  });
  const parts = Math.ceil(records.length / 100);
  for (let index = 0; index < parts; index++) {
    const chunk = records.slice(index * 100, (index + 1) * 100);
    assert(chunk.every(record => record.disposition === 'accepted'));
    const payload = StreamingVectorPayloadSchema.parse({ version: input.version, jobId: input.jobId,
      sourceId: input.sourceId, sourceRevision: 1, sourceSha256: digest, chunkIndex: index, records: chunk });
    const body = Buffer.from(JSON.stringify(payload)), hash = sha256(body);
    const key = `streaming-vectors/${input.jobId}/${index}/${hash}.json`;
    await putOriginal(key, body, 'application/json');
    await query(`INSERT INTO usp_streaming_vector_slots(job_id,source_revision,chunk_index,status,published,
      first_feature_index,last_feature_index,records,accepted,quarantined,bytes,object_key,object_sha256,
      result_sha256,attempt,fence) VALUES($1,1,$2,'ready',true,$3,$4,$5,$5,0,$6,$7,$8,$8,$9,$10)`,
    [input.jobId, index, chunk[0].featureIndex, chunk.at(-1)!.featureIndex, chunk.length, body.length,
      key, hash, attempt.number, attempt.fence]);
  }
  await query(`UPDATE usp_streaming_vector_imports SET state='running',sealed_chunks=$2,next_publish_index=$2,
    unknown_remainder=false,records=$3,accepted=$3 WHERE job_id=$1`, [input.jobId, parts, records.length]);
  const manifest = fingerprint({ version: input.version, jobId: input.jobId, sourceSha256: digest,
    slots: parts, features: records.length });
  await acceptUspJobAttempt(attempt, { assetId: `streaming-vector:${input.jobId}`, version: 1, sha256: manifest },
    async () => { assert.equal(closure.sha256, digest); assert.equal(closure.bytes, bytes.length); },
    client => assertStreamingInputTx(client, input).then(() => {}), async client => {
      await client.query("UPDATE usp_streaming_vector_imports SET state='completed' WHERE job_id=$1", [input.jobId]);
      await writeSealedMapReceiptTx(client, input, closure);
    });
  return features;
}
async function layout(fixture: Awaited<ReturnType<typeof originalFixture>>) {
  const profiles = new StreamedProfileService();
  const queued = await profiles.enqueue(fixture.caseId, fixture.sourceId, { requestKey: randomUUID(),
    expectedCaseRevision: fixture.current, expectedSourceRevision: 1, sourceSha256: digest,
    rawJobId: fixture.reader.jobId });
  await runStreamedProfileJob(queued.jobId);
  const status = await profiles.status(fixture.caseId, fixture.sourceId, queued.jobId);
  assert.equal(status.status, 'sealed');
  const profile = status.latest!;
  const operations: StreamedMappingPlan['operations'] = [
    { target: 'building.sourceKey', sourcePath: '/features/*/properties/doitt_id',
      conversionId: 'literal_identifier@1' },
    { target: 'building.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_polygon@1' },
  ];
  const plan: StreamedMappingPlan = { version: 'streamed-mapping/1', mode: 'streamed_mapping',
    scope: 'accepted_source_features', source: profile.source, caseId: fixture.caseId, caseRevision: fixture.current,
    rawJobId: fixture.reader.jobId, profileJobId: queued.jobId, profileGeneration: profile.generation,
    profileHash: profile.generationHash, operations, semanticEvidence: operations.map(op => ({
      target: op.target, sourcePath: op.sourcePath, issuer: published.issuer, evidenceUrl: origin.url,
      meaning: op.target === 'building.sourceKey' ? 'building_source_identity' : 'building_footprint',
    })) };
  const layouts = new StreamedMappingService();
  const authored = await layouts.author(fixture.caseId, fixture.sourceId, queued.jobId,
    { requestKey: randomUUID(), expectedRecipeRevision: 0, plan });
  return layouts.approve(fixture.caseId, fixture.sourceId, queued.jobId, authored.id,
    { requestKey: randomUUID(), expectedRecipeRevision: authored.revision });
}
function comparedFeature(feature: ImportPackage['features'][number]) {
  const height = { ...feature.height, evidence: feature.height.evidence.map(entry => ({
    ...entry, sourceRevisionId: 'comparison-original-source',
  })) };
  return { key: feature.sourceKey, name: feature.name, geometry: feature.geometry,
    sourceGeometry: feature.sourceGeometry, properties: feature.properties, index: feature.sourceFeatureIndex,
    sourceReference: feature.sourceReference, height, semantics: feature.semantics,
    worldStatus: feature.worldStatus, representation: feature.representation };
}
async function walk() {
  const baseline = await ingestArea({ bytes, filename: origin.name, format: 'geojson',
    namespace: `lp3a-bounded-${randomUUID()}`, name: 'NYC bounded equivalence control',
    mapping: { kind: 'building', idField: 'doitt_id', geometryRole: 'unknown' } });
  const fixture = await originalFixture();
  const features = await publishPureFixture(fixture.input), approved = await layout(fixture);
  const input: ProvedAreaPartInput = { sourceId: fixture.sourceId, sourceRevision: 1, sourceSha256: digest,
    readerVersion: 'geojson-stream/2', layoutHash: approved.planHash, cutIndex: 0, features,
    destination: { namespace: `lp3a-proved-${randomUUID()}`, name: 'NYC proved equivalence control' } };
  const pkg = await transaction(client => ingestProvedAreaPart(input, client));
  assert.equal(pkg.features.length, 1661);
  assert.deepEqual(pkg.features.map(comparedFeature), baseline.features.map(comparedFeature));
  const quarantine = (value: ImportPackage) => {
    const { sourceId, sourceRevision, ...body } = value.quarantine!;
    return body;
  };
  assert.deepEqual(quarantine(pkg), quarantine(baseline));
  assert.equal(pkg.quarantine!.rejections[0].featureIndex, 1322);
  let writes = 0;
  const replay = await transaction(client => {
    const run = client.query.bind(client);
    client.query = ((text: string, values: unknown[]) => {
      if (/^(INSERT|UPDATE|DELETE)/i.test(text.trim())) writes++;
      return run(text, values);
    }) as typeof client.query;
    return ingestProvedAreaPart(input, client).finally(() => { client.query = run as typeof client.query; });
  });
  assert.equal(replay.id, pkg.id);
  assert.equal(writes, 0);
  const sources = Number((await query('SELECT count(*)::int n FROM sources WHERE case_id=$1',
    [fixture.caseId])).rows[0].n);
  assert.equal(sources, 1);
  assert.equal((await query('SELECT case_id FROM import_packages WHERE id=$1', [pkg.id])).rows[0].case_id, fixture.caseId);
  const changed = { ...input, cutIndex: 1, features: [{ ...features[0], rawBytes: Buffer.from('changed') }] };
  await assert.rejects(transaction(client => ingestProvedAreaPart(changed, client)), /raw feature bytes differ/);
  Object.assign(proof, { compared: pkg.features.length, quarantinedIndex: 1322, rawParts: 17,
    comparedFields: Object.keys(comparedFeature(pkg.features[0])), comparedQuarantine: true,
    replay: { samePackage: true, SQLWrites: writes }, originalSourceRows: sources,
    packageInIntakeCase: true, badRawHashRefused: true, requests,
    issuerMeaning: 'Harness chooses doitt_id as key and source geometry as building exterior; '
      + 'no height or name field.',
    objectStore: 'CAR-pattern in-memory loopback S3 protocol store, not MinIO or production throughput.' });
}
async function main() {
  ownedBox();
  try {
    await query(sql('bootstrap.postgis'));
    await migrate();
    await standIns();
    await walk();
    assert.equal(sha256(readFileSync(path)), digest);
    proof.originalUnchanged = true;
  } catch (error: any) {
    Object.assign(proof, { failure: error.message?.slice(0, 3000), code: error.code,
      stack: error.stack?.split('\n').slice(0, 5) });
    process.exitCode = 1;
  } finally {
    closeStorageClient();
    server.closeIdleConnections();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await closePool();
    console.log(JSON.stringify(proof));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
