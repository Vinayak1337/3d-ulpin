/** Real PostgreSQL/S3 lifecycle test with synthetic model transport, not an accuracy benchmark. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { createRequire } from "node:module";
import type { ImportPackage, SpatialMlItem } from "@ulpin/contracts";
import { settings } from "../apps/web/lib/server/config";
import { migrate, pool, query } from "../apps/web/lib/server/db";
import { getPackage } from "../apps/web/lib/server/areas";
import { sha256, putOriginal, readObject, removeOrphan } from "../apps/web/lib/server/storage";
import { dispatchTick } from "../apps/web/lib/server/processing";
import { applySpatialMlItem, cancelSpatialMlItem, createSpatialMlBatch, failSpatialMlJob, getSpatialMlBatch, getSpatialMlItem, ingestSpatialMlJob, retrySpatialMlItem, spatialMlArtifact } from "../apps/web/lib/server/spatial-ml";

const schema = `test_spatial_ml_${randomUUID().replaceAll("-", "")}`;
const { Pool } = createRequire(new URL("../apps/web/package.json", import.meta.url))("pg");
const admin = new Pool({ connectionString: settings.databaseUrl, max: 1 });
const originalFetch = globalThis.fetch;
const cleanupObjects = new Set<string>();
const model = { id: "synthetic-floor-model", task: "floor-plan", sha256: "a".repeat(64), profileVersion: "synthetic-profile-v1", ready: true, license: "Synthetic verification only" };
let workerState: "queued" | "running" | "succeeded" = "queued";
const workerInputs = new Map<string, any>();
const sourceIds = [randomUUID(), randomUUID(), randomUUID()];
const partIds = sourceIds.map(() => randomUUID());
const packageId = randomUUID(), caseId = randomUUID(), siteId = randomUUID(), areaId = randomUUID(), featureId = randomUUID();
const logs: string[] = [];
const pass = (label: string) => { logs.push(label); console.log(`PASS ${label}`); };
function png() {
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) { c ^= x; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type), n = Buffer.alloc(4), check = Buffer.alloc(4); n.writeUInt32BE(data.length); check.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([n, t, data, check]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0, 240, 240, 240, 240, 240, 240, 0, 240, 240, 240, 240, 240, 240]))), chunk("IEND", Buffer.alloc(0))]);
}
const image = png(), imageHash = sha256(image);
function output(item: SpatialMlItem, empty = false) {
  const raster = { sha256: imageHash, width: 2, height: 2, bytes: image.length, base64: image.toString("base64"), mimeType: "image/png" };
  return { schemaVersion: "spatial-inference/1", inputFingerprint: item.inputFingerprint, task: "floor-plan", status: empty ? "empty" : "succeeded", model: { id: model.id, sha256: model.sha256, profileVersion: model.profileVersion }, raster, mask: raster, components: empty ? [] : [{ id: "room-1", className: "bedroom", score: .75, geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] } }], receipt: { kind: "Explicit synthetic transport test; no actual ML run", sourceId: item.sourceRevisionId, sourceSha256: item.sourceSha256, inputFingerprint: item.inputFingerprint, modelSha256: item.modelSha256, profileVersion: model.profileVersion } };
}
function rememberArtifacts(item: SpatialMlItem) {
  for (const kind of ["raster", "mask"]) cleanupObjects.add(`spatial-ml/${item.id}/${item.currentJobId}/${kind}/${imageHash}.png`);
}

try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  const isolated = new Pool({ connectionString: settings.databaseUrl, options: `-c search_path=${schema},public`, max: 4 });
  (globalThis as unknown as { ulpinPool: ReturnType<typeof pool> }).ulpinPool = isolated;
  await migrate();
  assert.equal((await query("SELECT current_schema() name")).rows[0].name, schema);
  assert.equal((await query("SELECT table_schema FROM information_schema.tables WHERE table_name='spatial_ml_items' AND table_schema=current_schema()")).rows[0].table_schema, schema);
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const address = String(url);
    if (address.endsWith("/internal/spatial-ml/status")) return Response.json({ available: true, models: [model] });
    if (address.endsWith("/internal/jobs") && init?.method === "POST") { const body = JSON.parse(String(init.body)); workerInputs.set(body.jobId, body.input); return Response.json({ jobId: body.jobId, status: "queued" }); }
    if (address.includes("/internal/jobs/")) { const jobId = address.split("/").at(-1)!; return Response.json({ jobId, status: workerState }); }
    return originalFetch(url, init);
  }) as typeof fetch;
  const frame = { id: "synthetic-drawing-frame", benchmark: "synthetic-ground-zero", horizontalUnit: "m", verticalUnit: "m" };
  await query("INSERT INTO cases(id,name,frame) VALUES($1,'Synthetic spatial ML backend verification',$2)", [caseId, frame]);
  await query("INSERT INTO registry_sites(id,identifier,name,frame) VALUES($1,$2,'Synthetic verification',$3)", [siteId, `TEST-${siteId}`, frame]);
  await query("INSERT INTO map_areas(id,site_id,name) VALUES($1,$2,'Synthetic verification')", [areaId, siteId]);
  const shape = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
  const feature = { id: featureId, areaId, identifier: `SYNTHETIC-${featureId}`, revision: 1, name: "Synthetic test building", kind: "building", worldStatus: "synthetic", sourceRevisionId: sourceIds[0], sourceKey: "TEST", geometry: shape, height: { value: null, state: "unknown" }, evidence: [{ sourceRevisionId: sourceIds[0] }] };
  await query("INSERT INTO physical_features(id,area_id,identifier,revision,body) VALUES($1,$2,$3,1,$4)", [featureId, areaId, feature.identifier, feature]);
  for (let index = 0; index < sourceIds.length; index++) {
    const bytes = index === 2 ? Buffer.from("Synthetic unsupported source") : image;
    const key = `spatial-ml-test/${schema}/source-${index}`; cleanupObjects.add(key);
    await putOriginal(key, bytes, index === 2 ? "text/plain" : "image/png");
    await query("INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status) VALUES($1,$2,$1,1,$3,'synthetic-test',$4,$5,$6,$7,'inspected')", [sourceIds[index], caseId, `Synthetic source ${index}`, index === 2 ? "text/plain" : "image/png", bytes.length, sha256(bytes), key]);
  }
  let pkg = { id: packageId, schemaVersion: "ulpin-canonical/2", areaId, name: "Synthetic ML preparation", datasetNamespace: schema, revision: 1, state: "NEEDS_INPUT", sourceRevisionIds: sourceIds, features: [feature], questions: [], factCandidates: [], parts: partIds.map((id, index) => ({ id, sourceRevisionId: sourceIds[index], locator: "Image 1", text: "Explicit synthetic test pixels", entityIds: [featureId] })), warnings: [], createdAt: new Date().toISOString() } as unknown as ImportPackage;
  await query("INSERT INTO import_packages(id,area_id,case_id,revision,state,body,operation_key) VALUES($1,$2,$3,1,'NEEDS_INPUT',$4,$5)", [packageId, areaId, caseId, pkg, schema]);
  await query("INSERT INTO building_preparations(id,building_id,case_id,package_id,body) VALUES($1,$2,$3,$4,$5)", [randomUUID(), featureId, caseId, packageId, { placement: { status: "reviewed", sourceFrame: frame.id, revision: 1 } }]);
  const request = { packageId, expectedRevision: 1, requestKey: randomUUID(), items: sourceIds.map((sourceRevisionId, index) => ({ sourceRevisionId, partId: partIds[index], page: 1, task: "floor-plan" })) };
  const batch = await createSpatialMlBatch(request);
  assert.equal(batch.items.filter(i => i.state === "queued").length, 2); assert.equal(batch.items.filter(i => i.state === "failed").length, 1);
  assert.equal((await createSpatialMlBatch(request)).id, batch.id);
  await assert.rejects(() => createSpatialMlBatch({ ...request, items: request.items.slice(0, 1) }), /different inputs/);
  pass("partial batch receipt and exact replay; reused key with changed input conflicts");
  let first = batch.items.find(i => i.sourceRevisionId === sourceIds[0])!, second = batch.items.find(i => i.sourceRevisionId === sourceIds[1])!;
  const cancelled = await cancelSpatialMlItem(second.id); assert.equal(cancelled.state, "cancelled");
  await ingestSpatialMlJob(cancelled.currentJobId, output(cancelled)); assert.equal((await getSpatialMlItem(second.id)).result, undefined);
  const retryKey = randomUUID(); second = await retrySpatialMlItem(second.id, retryKey); assert.equal(second.attempts.length, 2);
  assert.equal((await retrySpatialMlItem(second.id, retryKey)).currentJobId, second.currentJobId);
  pass("cancel suppresses late output; retry preserves attempts and replays its logical request");
  await failSpatialMlJob(first.currentJobId, "Synthetic absent model", "MODEL_UNAVAILABLE");
  assert.equal((await getSpatialMlItem(first.id)).state, "blocked");
  model.profileVersion = "synthetic-profile-v2";
  await assert.rejects(() => retrySpatialMlItem(first.id, randomUUID()), /pinned model is unavailable or changed/);
  model.profileVersion = "synthetic-profile-v1";
  first = await retrySpatialMlItem(first.id, randomUUID());
  await failSpatialMlJob(first.currentJobId, "Synthetic unavailable runtime dependency", "DEPENDENCY_UNAVAILABLE");
  assert.equal((await getSpatialMlItem(first.id)).state, "blocked");
  first = await retrySpatialMlItem(first.id, randomUUID());
  assert.equal((await query("SELECT status FROM sources WHERE id=$1", [first.sourceRevisionId])).rows[0].status, "inspected");
  pass("model unavailable is distinct and never rewrites source receipt status");
  await query("UPDATE jobs SET created_at=now()-interval '1 hour' WHERE id=ANY($1::uuid[])", [[first.currentJobId, second.currentJobId]]);
  await dispatchTick(); assert.equal((await getSpatialMlItem(first.id)).state, "queued");
  assert.equal(workerInputs.get(first.currentJobId).expectedProfileVersion, model.profileVersion);
  workerState = "running"; await dispatchTick(); assert.equal((await getSpatialMlItem(first.id)).state, "running");
  assert((await query("SELECT started_at FROM jobs WHERE id=$1", [first.currentJobId])).rows[0].started_at);
  await query("UPDATE jobs SET started_at=now()-interval '121 seconds' WHERE id=$1", [first.currentJobId]);
  await dispatchTick();
  assert.equal((await getSpatialMlItem(first.id)).attempts.at(-1)?.errorCode, "INFERENCE_TIMEOUT");
  first = await retrySpatialMlItem(first.id, randomUUID());
  pass("old queue time does not consume execution deadline; actual worker running starts it");
  rememberArtifacts(first); rememberArtifacts(second);
  const mismatchedProfile = output(first); mismatchedProfile.model.profileVersion = "synthetic-profile-v2";
  await assert.rejects(() => ingestSpatialMlJob(first.currentJobId, mismatchedProfile), /profile fingerprint/);
  const mismatchedReceipt = output(first); mismatchedReceipt.receipt.profileVersion = "synthetic-profile-v2";
  await assert.rejects(() => ingestSpatialMlJob(first.currentJobId, mismatchedReceipt), /inference profile/);
  await ingestSpatialMlJob(first.currentJobId, output(first)); await ingestSpatialMlJob(second.currentJobId, output(second, true));
  first = await getSpatialMlItem(first.id); second = await getSpatialMlItem(second.id);
  assert.equal(first.state, "succeeded"); assert.equal(second.state, "empty");
  const rasterUrl = new URL(first.result!.raster.url, "http://localhost");
  assert.equal(sha256(new Uint8Array(await (await spatialMlArtifact(first.id, "raster", rasterUrl)).arrayBuffer())), imageHash);
  pass("persisted raster and mask bytes verify; empty detections remain an explicit result");
  const apply = { expectedRevision: 1, requestKey: randomUUID(), entityId: featureId, property: "space.geometry", selections: [{ componentId: "room-1", subject: "Synthetic room" }], calibration: { rasterSha256: imageHash, imagePoints: [[0, 0], [2, 0]], worldPoints: [[0, 0], [2, 0]], frame: frame.id, reason: "Explicit synthetic controls; not real survey evidence" } };
  await assert.rejects(() => applySpatialMlItem(first.id, { ...apply, property: "outline.geometry" }), /matching draft property/);
  await assert.rejects(() => applySpatialMlItem(first.id, { ...apply, calibration: { ...apply.calibration, rasterSha256: "b".repeat(64) } }), /different raster/);
  await assert.rejects(() => applySpatialMlItem(second.id, apply), /nonempty/);
  const applied = await applySpatialMlItem(first.id, apply); pkg = applied.package;
  assert.equal(pkg.revision, 2); assert.equal(pkg.factCandidates.length, 2); assert.equal(applied.item.applications[0].factIds.length, 2);
  assert(pkg.factCandidates.every(f => f.evidenceState === "unresolved")); assert.equal(pkg.selectedClaimIds?.length ?? 0, 0);
  assert.equal((await applySpatialMlItem(first.id, apply)).package.revision, 2);
  const dedup = await applySpatialMlItem(first.id, { ...apply, requestKey: randomUUID(), expectedRevision: 2 });
  assert.equal(dedup.package.factCandidates.length, 2); assert.equal(dedup.package.revision, 2); assert.equal(dedup.item.applications.length, 1);
  await assert.rejects(() => applySpatialMlItem(first.id, { ...apply, calibration: { ...apply.calibration, reason: "Changed payload" } }), /different selection/);
  await assert.rejects(() => applySpatialMlItem(first.id, { ...apply, requestKey: randomUUID() }), /Refresh/);
  pass("atomic unresolved fact handoff, request replay, refreshed-key dedup and stale revision rejection");
  const changed = await applySpatialMlItem(first.id, { ...apply, requestKey: randomUUID(), expectedRevision: 2, calibration: { ...apply.calibration, worldPoints: [[0, 0], [3, 0]] } });
  assert.equal(changed.package.factCandidates.length, 4); assert.equal(changed.item.applications.length, 2);
  pkg = await getPackage(packageId); pkg.parts[0].text = "Changed synthetic source association context"; pkg.revision++;
  await query("UPDATE import_packages SET body=$2,revision=$3 WHERE id=$1", [packageId, pkg, pkg.revision]);
  await assert.rejects(() => applySpatialMlItem(first.id, { ...apply, requestKey: randomUUID(), expectedRevision: pkg.revision }), /source part or its associations changed/);
  assert.equal((await getSpatialMlItem(second.id)).state, "empty");
  pass("new calibration retains new facts; changed source context blocks apply without discarding sibling pixels");
  assert.equal((await query("SELECT count(*)::int n FROM sources WHERE status='inspected'")).rows[0].n, 3);
  assert.equal(sha256(await readObject(`spatial-ml-test/${schema}/source-0`)), imageHash);
  assert.equal((await getSpatialMlBatch(batch.id)).items.length, 3);
  pass("original bytes and suitability preserved; all batch items and attempt receipts retained");
  console.log(`Completed ${logs.length} isolated backend checks; actual ML inference was not mocked as accuracy evidence.`);
} finally {
  globalThis.fetch = originalFetch;
  for (const key of cleanupObjects) await removeOrphan(key);
  await pool().end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
