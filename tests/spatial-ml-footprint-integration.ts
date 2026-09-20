/** Isolated DB/S3 rollback proof. Model output below is explicitly synthetic, not accuracy evidence. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { SpatialMlItem } from "@ulpin/contracts";
import { settings } from "../apps/web/lib/server/config";
import { migrate, pool, query } from "../apps/web/lib/server/db";
import { fingerprint } from "../apps/web/lib/server/domain";
import { getArea, getPackage, ingestArea } from "../apps/web/lib/server/areas";
import { createSpatialMlFootprintDraft } from "../apps/web/lib/server/spatial-ml-footprints";
import { getSpatialMlItem } from "../apps/web/lib/server/spatial-ml";
import { putOriginal, readObject, removeOrphan, sha256 } from "../apps/web/lib/server/storage";

const schema = `test_ml_footprints_${randomUUID().replaceAll("-", "")}`;
const { Pool } = createRequire(new URL("../apps/web/package.json", import.meta.url))("pg");
const admin = new Pool({ connectionString: settings.databaseUrl, max: 1 });
const objects = new Set<string>();
const tables = ["cases", "sources", "registry_records", "physical_features", "source_feature_links", "import_packages", "import_package_revisions", "spatial_ml_footprint_drafts"];
const counts = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, (await query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n])));
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  // One connection proves the participant does not acquire another connection while holding its locks.
  (globalThis as unknown as { ulpinPool: ReturnType<typeof pool> }).ulpinPool = new Pool({ connectionString: settings.databaseUrl, options: `-c search_path=${schema},public`, max: 1, connectionTimeoutMillis: 1500 });
  await migrate();
  assert.equal((await query("SELECT current_schema() name")).rows[0].name, schema);
  const native = { geometryType: "esriGeometryPolygon", spatialReference: { wkid: 32643 }, features: [{ attributes: { id: "synthetic-base", name: "Synthetic base" }, geometry: { rings: [[[500000, 3100000], [500010, 3100000], [500010, 3100010], [500000, 3100010], [500000, 3100000]]] } }] };
  const originalBytes = Buffer.from(JSON.stringify(native));
  const sourcePackage = await ingestArea({ bytes: originalBytes, filename: "synthetic-base.json", format: "arcgis", namespace: schema, name: "Synthetic atomic footprint test", mapping: { kind: "building", idField: "id", nameField: "name", geometryRole: "observed_roof_projection" }, worldStatus: "synthetic" });
  const baseSource = (await query("SELECT object_key,sha256 FROM sources WHERE id=$1", [sourcePackage.sourceRevisionIds[0]])).rows[0];
  objects.add(baseSource.object_key);
  assert.equal(sha256(await readObject(baseSource.object_key)), sha256(originalBytes));
  const area = await getArea(sourcePackage.areaId);
  const frame = (await query("SELECT frame FROM registry_sites WHERE id=$1", [area.siteId])).rows[0].frame;
  const caseId = (await query("SELECT case_id FROM import_packages WHERE id=$1", [sourcePackage.id])).rows[0].case_id;
  const sourceId = randomUUID(), partId = randomUUID(), batchId = randomUUID(), itemId = randomUUID(), jobId = randomUUID();
  const pixels = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=", "base64"), pixelHash = sha256(pixels), imageKey = `spatial-ml-test/${schema}/original.png`;
  objects.add(imageKey); await putOriginal(imageKey, pixels, "image/png");
  await query("INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status) VALUES($1,$2,$1,1,'Synthetic pixels','synthetic-test','image/png',$3,$4,$5,'inspected')", [sourceId, caseId, pixels.length, pixelHash, imageKey]);
  const part = { id: partId, sourceRevisionId: sourceId, locator: "Image 1", text: "Explicit synthetic integration pixels", entityIds: [sourcePackage.features[0].id] };
  sourcePackage.sourceRevisionIds.push(sourceId); sourcePackage.parts.push(part);
  await query("UPDATE import_packages SET body=$2 WHERE id=$1", [sourcePackage.id, sourcePackage]);
  const now = new Date().toISOString(), inputFingerprint = "f".repeat(64);
  const item: SpatialMlItem = { id: itemId, batchId, packageId: sourcePackage.id, sourceRevisionId: sourceId, sourceSha256: pixelHash, partId, page: 1, task: "building", modelId: "synthetic-building-model", modelSha256: "a".repeat(64), inputFingerprint, state: "succeeded", currentJobId: jobId, attempts: [{ jobId, state: "succeeded", createdAt: now, completedAt: now }], applications: [], createdAt: now, updatedAt: now, result: { model: { id: "synthetic-building-model", sha256: "a".repeat(64) }, raster: { width: 1, height: 1, sha256: pixelHash, url: "/synthetic-raster" }, mask: { width: 1, height: 1, sha256: pixelHash, url: "/synthetic-mask" }, components: [{ id: "building-1", className: "building", score: .8, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } }], receipt: { purpose: "Synthetic transaction proof; no model inference performed" } } };
  await query("INSERT INTO jobs(id,case_id,source_id,operation,status,input_fingerprint,payload) VALUES($1,$2,$3,'spatial-inference','completed',$4,'{}')", [jobId, caseId, sourceId, inputFingerprint]);
  await query("INSERT INTO spatial_ml_batches(id,package_id,request_key,request_digest) VALUES($1,$2,$3,$4)", [batchId, sourcePackage.id, randomUUID(), inputFingerprint]);
  await query("INSERT INTO spatial_ml_items(id,batch_id,package_id,source_id,current_job_id,body,private_input) VALUES($1,$2,$3,$4,$5,$6,$7)", [itemId, batchId, sourcePackage.id, sourceId, jobId, item, { sourcePartHash: fingerprint(part), payload: { source: { id: sourceId, objectKey: imageKey, sha256: pixelHash, bytes: pixels.length, mimeType: "image/png" } } }]);
  const request = { requestKey: randomUUID(), expectedRevision: sourcePackage.revision, expectedAreaRevision: area.revision, selections: [{ componentId: "building-1", subject: "Synthetic proposal" }], calibration: { rasterSha256: pixelHash, imagePoints: [[0, 0], [1, 0]], worldPoints: [[20, 20], [25, 20]], frame: frame.id, reason: "Explicit synthetic controls for rollback verification" } };
  const baseline = await counts();
  await query(`CREATE FUNCTION reject_ml_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE object_key text; BEGIN SELECT s.object_key INTO object_key FROM sources s JOIN import_packages p ON p.case_id=s.case_id WHERE p.id=NEW.package_id LIMIT 1; RAISE EXCEPTION 'synthetic failure after package creation' USING DETAIL=object_key; END $$`);
  await query("CREATE TRIGGER reject_ml_receipt BEFORE INSERT ON spatial_ml_footprint_drafts FOR EACH ROW EXECUTE FUNCTION reject_ml_receipt()");
  let rejected = false;
  try { await createSpatialMlFootprintDraft(itemId, request); }
  catch (error) { const failure = error as Error & { detail?: string }; assert.match(failure.message, /synthetic failure after package creation/); assert(failure.detail?.startsWith("areas/")); objects.add(failure.detail); rejected = true; }
  assert(rejected); assert.deepEqual(await counts(), baseline);
  assert.equal((await getSpatialMlItem(itemId)).footprintDrafts?.length ?? 0, 0);
  assert.equal(sha256(await readObject(imageKey)), pixelHash);
  console.log("PASS injected receipt failure rolls back every derived package, identity, source and revision row; original pixels remain unchanged");
  await query("DROP TRIGGER reject_ml_receipt ON spatial_ml_footprint_drafts");
  const created = await createSpatialMlFootprintDraft(itemId, request);
  assert.notEqual(created.package.id, sourcePackage.id);
  assert.equal((await getSpatialMlItem(itemId)).footprintDrafts?.[0].packageId, created.package.id);
  assert.equal((await createSpatialMlFootprintDraft(itemId, request)).package.id, created.package.id);
  assert.equal((await query("SELECT count(*)::int n FROM spatial_ml_footprint_drafts")).rows[0].n, 1);
  assert(created.package.sourceRevisionIds.includes(sourceId));
  assert.equal(created.package.parts[0].sourceRevisionId, sourceId);
  assert.equal(created.package.features[0].semantics?.evidenceState, "unresolved");
  assert.equal(created.package.features[0].height.value, null);
  const derivedSource = (await query("SELECT object_key,sha256 FROM sources WHERE id=$1", [created.package.features[0].sourceRevisionId])).rows[0];
  objects.add(derivedSource.object_key);
  assert.equal(sha256(await readObject(derivedSource.object_key)), derivedSource.sha256);
  assert.equal((await getPackage(sourcePackage.id)).revision, sourcePackage.revision);
  assert.equal((await query("SELECT count(*)::int n FROM physical_features WHERE revision>0")).rows[0].n, 0);
  console.log("PASS retry creates one linked draft and receipt atomically; actual derived original bytes survive commit and replay");
} finally {
  for (const key of objects) await removeOrphan(key);
  await pool().end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
