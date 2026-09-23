/** Independent D0 checks against the disposable production HTTP, SQL and S3 services. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { assertUspIsolation } from './local-isolation.mjs';

assertUspIsolation(process.env);
const receiptPath = process.env.ULPIN_D0_RECEIPT_FILE;
assert(receiptPath && resolve(receiptPath).startsWith(resolve('.runtime/engineering') + '/'));
const importReceipt = JSON.parse(await readFile(receiptPath, 'utf8'));
assert.equal(importReceipt.schemaVersion, 'usp-d0-import-receipt/1');
const require = createRequire(resolve('apps/web/package.json'));
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000 });
const base = process.env.ULPIN_TEST_URL + '/api/v1/usp';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const report: Record<string, unknown> = { schemaVersion: 'usp-d0-live/1', status: 'running',
  packProfile: importReceipt.packProfile, areaId: importReceipt.areaId, siteId: importReceipt.siteId };

async function api(route: string, body?: unknown, expected = 200) {
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, expected, `${route}: ${result.error?.code ?? response.status}`);
  return result.data;
}

try {
  const textSources = importReceipt.sources.filter((source: any) => /^mixed-page-r[12]\.txt$/.test(source.name));
  const csvSources = importReceipt.sources.filter((source: any) => /^mixed-rows-r[12]\.csv$/.test(source.name));
  for (const family of [textSources, csvSources]) {
    assert.deepEqual(family.map((source: any) => Number(source.revision)).sort(), [1, 2]);
    assert.equal(new Set(family.map((source: any) => source.familyId)).size, 1);
    assert.notEqual(family[0].sha256, family[1].sha256);
  }
  const originalRows = (await pool.query(
    'SELECT id,family_id,revision,sha256 FROM sources WHERE id=ANY($1::uuid[])',
    [importReceipt.sources.map((source: any) => source.sourceRevisionId)],
  )).rows;
  assert.equal(originalRows.length, importReceipt.sources.length);
  for (const row of originalRows) {
    const source = importReceipt.sources.find((item: any) => item.sourceRevisionId === row.id);
    assert.equal(row.family_id, source.familyId);
    assert.equal(Number(row.revision), source.revision);
    assert.equal(row.sha256, source.sha256);
  }

  const manifest = await api('/snapshots', { scopeId: importReceipt.siteId,
    world: { namespace: 'world', id: `registry-site/${importReceipt.siteId}` },
    stage: 'recorded', selection: { kind: 'site' } });
  const scope = manifest.scope;
  const pin = (alias: string) => {
    const id = importReceipt.records[alias];
    assert(id, `Missing recorded ${alias}`);
    const member = manifest.members.find((item: any) => item.pin.ref.namespace === 'registry_record' && item.pin.ref.id === id);
    assert(member, `Recorded ${alias} absent from exact manifest`);
    return member.pin;
  };
  const targetPin = pin('U-A101'), buildingPin = pin('B-A'), otherBuildingPin = pin('B-B');
  const resolved = await api('/targets/resolve', { scope, pin: targetPin });
  assert.equal(resolved.state, 'available');
  const target = resolved.data;
  const exact = new Map(importReceipt.sourceParts['U-A101'].map((part: any) =>
    [`${part.sourceRevisionId}:${part.locator}`, part]));
  assert.equal(exact.size, 4);
  const pointers = target.evidence.filter((pointer: any) => exact.has(
    `${pointer.sourceRevision.ref.id}:${pointer.locator.locator}`));
  assert.equal(pointers.length, 4, 'A101 must carry four reviewed exact parts');
  assert(!pointers.some((pointer: any) => ['line 4', 'CSV row 3'].includes(pointer.locator.locator)));
  const floorRelation = target.relations.find((relation: any) => relation.kind === 'floor');
  assert(floorRelation, 'A101 must retain a supplied floor');
  const selected = await api('/targets/vertical', { scope, building: buildingPin,
    floor: floorRelation.target, space: targetPin });
  assert.equal(selected.state, 'available');
  const invalid = await api('/targets/vertical', { scope, building: otherBuildingPin,
    floor: floorRelation.target, space: targetPin });
  assert.deepEqual(invalid, { state: 'unavailable', reasonCode: 'invalid_vertical_membership' });

  const selectedText: string[] = [], originalHashes: string[] = [];
  for (const pointer of pointers) {
    const preview = await api('/evidence/part', { scope, pointer, action: 'extract' });
    assert.equal(preview.state, 'available');
    assert.equal(preview.data.sourceSha256,
      importReceipt.sourceHashesByRevisionId[pointer.sourceRevision.ref.id]);
    selectedText.push(preview.data.text);
    const original = await fetch(base + '/evidence/original', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, pointer, action: 'original' }) });
    assert.equal(original.status, 200);
    const originalHash = hash(new Uint8Array(await original.arrayBuffer()));
    assert.equal(originalHash, preview.data.sourceSha256);
    originalHashes.push(originalHash);
  }
  assert(selectedText.some(text => text.includes('ONLY_A101')));
  assert(selectedText.some(text => text.includes('SHARED_STAIR_CONTEXT')));
  assert(selectedText.every(text => !text.includes('NEVER_A102')));

  const packetRequest = { scope, target: targetPin, evidence: pointers, format: 'csv',
    guard: { mode: 'create', requestKey: randomUUID() } };
  const packet = await api('/packets', packetRequest);
  assert.equal(packet.status, 'complete');
  assert.equal(packet.included.length, 4);
  assert.equal(packet.unavailable.length, 0);
  assert.deepEqual(await api('/packets', packetRequest), packet);
  await api('/packets', { ...packetRequest, format: 'text' }, 409);
  const reopened = await api(`/packets/${packet.packetId}/receipt`);
  assert.deepEqual(reopened, packet);
  const artifact = await fetch(base + `/packets/${packet.packetId}`);
  assert.equal(artifact.status, 200);
  const artifactBytes = new Uint8Array(await artifact.arrayBuffer());
  const artifactText = Buffer.from(artifactBytes).toString('utf8');
  assert.equal(hash(artifactBytes), packet.artifact.sha256);
  assert.equal(artifact.headers.get('X-Artifact-SHA256'), packet.artifact.sha256);
  assert.match(artifactText, /ONLY_A101/);
  assert.match(artifactText, /SHARED_STAIR_CONTEXT/);
  assert.doesNotMatch(artifactText, /NEVER_A102/);
  const packetRow = (await pool.query('SELECT artifact_hash FROM usp_packets WHERE id=$1', [packet.packetId])).rows[0];
  assert.equal(packetRow.artifact_hash, packet.artifact.sha256);
  Object.assign(report, { status: 'passed', manifestId: manifest.id, manifestDigest: manifest.digest,
    targetId: targetPin.ref.id, targetRevision: targetPin.revision, sourceOriginalSha256: [...new Set(originalHashes)],
    selectedLocators: pointers.map((pointer: any) => pointer.locator.locator),
    packetId: packet.packetId, packetSha256: packet.artifact.sha256, packetStatus: packet.status,
    artifactBytes: artifactBytes.length, crossBuilding: invalid.reasonCode });
} finally {
  await pool.end();
  await mkdir(resolve('.runtime/engineering'), { recursive: true });
  await writeFile(resolve('.runtime/engineering/usp-d0-live.json'), JSON.stringify(report, null, 2) + '\n');
}
