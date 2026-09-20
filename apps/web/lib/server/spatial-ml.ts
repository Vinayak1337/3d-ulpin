import { retainedFootprintCalibration } from "./spatial-ml-retained-calibration";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import type {
  ImportPackage, Point2, SpatialMlApplyResponse, SpatialMlBatch, SpatialMlCalibration,
  SpatialMlComponent, SpatialMlItem, SpatialMlResult, SpatialMlState, SpatialMlStatus,
} from "@ulpin/contracts";
import { query, transaction } from "./db";
import { settings } from "./config";
import { AppError, conflict, notFound } from "./errors";
import { fingerprint } from "./domain";
import { getPackage } from "./areas";
import { appendPreparationFacts, type PreparationFactInput } from "./officer-preparation";
import { putOriginal, readObject, sha256 } from "./storage";
import { transformPoint } from "../ui/geometry";

const MAX_ITEMS = 12;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_RASTER_PIXELS = 16_000_000;
const FLOOR_CLASSES = new Set(["outdoor", "wall", "kitchen", "living_room", "bedroom", "bath", "hallway", "railing", "storage", "garage", "other_room"]);
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const point = z.tuple([z.number().finite(), z.number().finite()]);
const region = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict().refine(r => r.x + r.width <= 1 && r.y + r.height <= 1, "Crop must fit the original page.");
const task = z.enum(["floor-plan", "building"]);
export const spatialMlBatchSchema = z.object({
  packageId: uuid, expectedRevision: z.number().int().nonnegative(), requestKey: uuid,
  items: z.array(z.object({ sourceRevisionId: uuid, partId: uuid, page: z.number().int().min(1).max(500), task, modelId: z.string().min(1).max(120).optional(), region: region.optional() }).strict()).min(1).max(MAX_ITEMS),
}).strict();
export const spatialMlCalibrationSchema = z.object({
  rasterSha256: hash, imagePoints: z.tuple([point, point]), worldPoints: z.tuple([point, point]),
  frame: z.string().trim().min(1).max(200), reason: z.string().trim().min(3).max(2000),
}).strict();
export const spatialMlApplySchema = z.object({
  expectedRevision: z.number().int().nonnegative(), requestKey: uuid, entityId: uuid,
  selections: z.array(z.object({ componentId: z.string().min(1).max(120), subject: z.string().trim().min(1).max(60) }).strict()).min(1).max(100),
  property: z.enum(["space.geometry", "outline.geometry"]), calibration: spatialMlCalibrationSchema,
}).strict();
type Artifact = { objectKey: string; sha256: string; width: number; height: number; bytes: number; mimeType: "image/png" };
export type InferencePayload = {
  schemaVersion: "spatial-inference/1"; inputFingerprint: string; task: "floor-plan" | "building";
  modelId: string; expectedModelSha256: string; expectedProfileVersion: string; page: number;
  region?: z.infer<typeof region>;
  source: { id: string; objectKey: string; sha256: string; bytes: number; mimeType: string };
};
type PrivateInput = {
  sourcePartHash: string; payload: InferencePayload; entityRevisions: Record<string, number>;
  retryRequests: Record<string, { jobId: string }>;
  applyDigests: Record<string, string>;
  outputs: Record<string, { result: SpatialMlResult; artifacts: { raster: Artifact; mask: Artifact } }>;
};
export type SpatialMlItemRecord = { item: SpatialMlItem; privateInput: PrivateInput };
type Db = Pick<PoolClient, "query">;
const db: Db = { query: query as PoolClient["query"] };

async function processor(path: string) {
  const response = await fetch(`${settings.geoUrl}${path}`, {
    headers: { Authorization: `Bearer ${settings.geoToken}` },
    signal: AbortSignal.timeout(10000), redirect: "error",
  });
  if (!response.ok) throw new AppError(503, "ML_PROCESSOR_UNAVAILABLE", "The local inference service is unavailable. Start the private processing service and retry.");
  return response.json();
}

export async function spatialMlStatus(): Promise<SpatialMlStatus> {
  const raw = z.object({ models: z.array(z.object({
    id: z.string().min(1).max(120), task, sha256: hash, profileVersion: z.string().min(1).max(160), ready: z.boolean(),
    name: z.string().optional(), reason: z.string().optional(), license: z.string().optional(), quality: z.unknown().optional(),
  }).passthrough()).max(12) }).passthrough().parse(await processor("/internal/spatial-ml/status"));
  return { maxBatchItems: MAX_ITEMS, models: raw.models.map(m => ({
    id: m.id, task: m.task, sha256: m.sha256, profileVersion: m.profileVersion, ready: m.ready, name: m.name ?? m.id,
    license: m.license ?? "See retained model manifest", reason: m.reason,
    evaluation: typeof m.quality === "string" ? m.quality : m.quality ? JSON.stringify(m.quality) : undefined,
  })) };
}

/** Private source keys and worker payloads are never returned by the public API. */
export async function getSpatialMlItemRecord(id: string, client: Db = db, lock = false): Promise<SpatialMlItemRecord> {
  const row = (await client.query(`SELECT body,private_input FROM spatial_ml_items WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [uuid.parse(id)])).rows[0];
  if (!row) notFound("Spatial extraction item not found.");
  return { item: row.body as SpatialMlItem, privateInput: row.private_input as PrivateInput };
}
async function withRetainedFootprintCalibrations(items: SpatialMlItem[]): Promise<SpatialMlItem[]> {
  const candidates = items.filter(item => item.task === "building" && item.state === "succeeded" && item.result);
  if (!candidates.length) return items;
  // Read historical receipts as well as newly created ones. No item or receipt is mutated.
  const rows = (await query(`SELECT d.item_id,d.body AS receipt,p.body AS package,s.sha256,
      i.private_input->>'sourcePartHash' AS part_hash,a.reference,r.frame
    FROM spatial_ml_footprint_drafts d
    JOIN spatial_ml_items i ON i.id=d.item_id
    JOIN import_packages p ON p.id=i.package_id
    JOIN import_packages derived ON derived.id=d.package_id
    JOIN sources s ON s.id=(i.body->>'sourceRevisionId')::uuid
    JOIN map_areas a ON a.id=p.area_id JOIN registry_sites r ON r.id=a.site_id
    WHERE d.item_id=ANY($1::uuid[]) ORDER BY derived.created_at DESC,d.package_id DESC`, [candidates.map(item => item.id)])).rows;
  return items.map(item => {
    const {retainedFootprintCalibration: _previous, ...currentItem} = item;
    for (const row of rows.filter(row => row.item_id === item.id)) {
      const calibration = retainedFootprintCalibration(item, row.receipt, row.package, {frame:row.frame, reference:row.reference, sourceSha256:row.sha256, sourcePartHash:row.part_hash});
      if (calibration) return {...currentItem, retainedFootprintCalibration:calibration};
    }
    return currentItem;
  });
}
export async function getSpatialMlItem(id: string): Promise<SpatialMlItem> { return (await withRetainedFootprintCalibrations([(await getSpatialMlItemRecord(id)).item]))[0]; }
async function saveItem(client: Db, record: SpatialMlItemRecord) {
  record.item.updatedAt = new Date().toISOString();
  await client.query("UPDATE spatial_ml_items SET body=$2,private_input=$3,current_job_id=$4,updated_at=now() WHERE id=$1", [record.item.id, record.item, record.privateInput, record.item.currentJobId]);
}
export async function getSpatialMlBatch(id: string): Promise<SpatialMlBatch> {
  const row = (await query("SELECT id,package_id,request_key,created_at FROM spatial_ml_batches WHERE id=$1", [uuid.parse(id)])).rows[0];
  if (!row) notFound("Spatial extraction batch not found.");
  const items = (await query("SELECT body FROM spatial_ml_items WHERE batch_id=$1 ORDER BY created_at,id", [id])).rows.map(r => r.body as SpatialMlItem);
  return { id: row.id, packageId: row.package_id, requestKey: row.request_key, createdAt: new Date(row.created_at).toISOString(), items: await withRetainedFootprintCalibrations(items) };
}
export async function listSpatialMlBatches(packageId: string): Promise<SpatialMlBatch[]> {
  await getPackage(uuid.parse(packageId));
  const rows = (await query("SELECT id FROM spatial_ml_batches WHERE package_id=$1 ORDER BY created_at DESC LIMIT 30", [packageId])).rows;
  return Promise.all(rows.map(row => getSpatialMlBatch(row.id)));
}

export async function createSpatialMlBatch(value: unknown): Promise<SpatialMlBatch> {
  const input = spatialMlBatchSchema.parse(value), requestDigest = fingerprint(input);
  const existing = (await query("SELECT id,request_digest FROM spatial_ml_batches WHERE package_id=$1 AND request_key=$2", [input.packageId, input.requestKey])).rows[0];
  if (existing) {
    if (existing.request_digest !== requestDigest) throw new AppError(409, "ML_REQUEST_KEY", "This batch key was already used for different inputs.");
    return getSpatialMlBatch(existing.id);
  }
  if (new Set(input.items.map(i => fingerprint(i))).size !== input.items.length) throw new AppError(422, "ML_DUPLICATE_ITEM", "Select each source, page and crop once per batch.");
  const status = await spatialMlStatus();
  const batchId = await transaction(async client => {
    const row = (await client.query("SELECT case_id,body FROM import_packages WHERE id=$1 FOR UPDATE", [input.packageId])).rows[0];
    if (!row) notFound("Preparation not found.");
    const replay = (await client.query("SELECT id,request_digest FROM spatial_ml_batches WHERE package_id=$1 AND request_key=$2", [input.packageId, input.requestKey])).rows[0];
    if (replay) {
      if (replay.request_digest !== requestDigest) throw new AppError(409, "ML_REQUEST_KEY", "This batch key was already used for different inputs.");
      return replay.id as string;
    }
    const pkg = row.body as ImportPackage;
    if (pkg.revision !== input.expectedRevision || pkg.state === "COMMITTED") conflict("Preparation changed. Refresh or open a correction before extracting.");
    const id = randomUUID();
    await client.query("INSERT INTO spatial_ml_batches(id,package_id,request_key,request_digest) VALUES($1,$2,$3,$4)", [id, pkg.id, input.requestKey, requestDigest]);
    for (const selected of input.items) {
      const part = pkg.parts.find(p => p.id === selected.partId && p.sourceRevisionId === selected.sourceRevisionId);
      if (!part || !pkg.sourceRevisionIds.includes(selected.sourceRevisionId)) throw new AppError(422, "ML_SOURCE_ASSOCIATION", "Every selected source part must belong to this preparation.");
      const partPage = /\bpage\s+(\d+)\b/i.exec(part.locator);
      if (partPage && Number(partPage[1]) !== selected.page) throw new AppError(422, "ML_SOURCE_PAGE", "The selected page must match the retained source part's page locator.");
      const source = (await client.query("SELECT id,object_key,sha256,bytes,mime_type FROM sources WHERE id=$1 FOR SHARE", [selected.sourceRevisionId])).rows[0];
      if (!source) notFound("A selected original is unavailable.");
      const model = status.models.find(m => m.task === selected.task && (!selected.modelId || m.id === selected.modelId));
      if (!model) throw new AppError(422, "ML_MODEL_UNKNOWN", "Select an allowlisted local model for this task.");
      const spec = {
        schemaVersion: "spatial-inference/1" as const, task: selected.task, modelId: model.id, expectedModelSha256: model.sha256, expectedProfileVersion: model.profileVersion,
        source: { id: source.id as string, objectKey: source.object_key as string, sha256: source.sha256 as string, bytes: Number(source.bytes), mimeType: source.mime_type as string },
        page: selected.page, ...(selected.region ? { region: selected.region } : {}),
      };
      const payload: InferencePayload = { ...spec, inputFingerprint: fingerprint(spec) };
      const supported = ["image/png", "image/jpeg", "application/pdf"].includes(source.mime_type) && (source.mime_type === "application/pdf" || selected.page === 1);
      const state: SpatialMlState = !supported ? "failed" : !model.ready ? "blocked" : "queued";
      const errorCode = !supported ? "UNSUPPORTED_SOURCE" : !model.ready ? "MODEL_UNAVAILABLE" : undefined;
      const error = !supported ? "Choose a PNG/JPEG original or a PDF page; an image has only page 1." : !model.ready ? model.reason ?? "The pinned local model is unavailable." : undefined;
      const itemId = randomUUID(), jobId = randomUUID(), now = new Date().toISOString();
      await client.query("INSERT INTO jobs(id,case_id,source_id,operation,status,input_fingerprint,payload,error,completed_at) VALUES($1,$2,$3,'spatial-inference',$4,$5,$6,$7,$8)", [jobId, row.case_id, source.id, state === "queued" ? "queued" : "failed", payload.inputFingerprint, payload, error ?? null, state === "queued" ? null : now]);
      const item: SpatialMlItem = { id: itemId, batchId: id, packageId: pkg.id, sourceRevisionId: source.id, sourceSha256: source.sha256, partId: part.id, page: selected.page, task: selected.task, modelId: model.id, modelSha256: model.sha256, inputFingerprint: payload.inputFingerprint, state, currentJobId: jobId, attempts: [{ jobId, state, createdAt: now, ...(error ? { completedAt: now, error, errorCode } : {}) }], applications: [], createdAt: now, updatedAt: now };
      const privateInput: PrivateInput = { payload, sourcePartHash: fingerprint(part), entityRevisions: Object.fromEntries(pkg.features.filter(f => part.entityIds.includes(f.id)).map(f => [f.id, f.revision])), retryRequests: {}, applyDigests: {}, outputs: {} };
      await client.query("INSERT INTO spatial_ml_items(id,batch_id,package_id,source_id,current_job_id,body,private_input) VALUES($1,$2,$3,$4,$5,$6,$7)", [itemId, id, pkg.id, source.id, jobId, item, privateInput]);
    }
    return id;
  });
  return getSpatialMlBatch(batchId);
}

export async function assertSpatialMlSourceCurrent(record: SpatialMlItemRecord, pkg: ImportPackage, client: Db = db) {
  const { item, privateInput } = record;
  if (pkg.id !== item.packageId || !pkg.sourceRevisionIds.includes(item.sourceRevisionId)) conflict("The extraction source is no longer part of this preparation.");
  const part = pkg.parts.find(p => p.id === item.partId && p.sourceRevisionId === item.sourceRevisionId);
  if (!part || fingerprint(part) !== privateInput.sourcePartHash) conflict("The source part or its associations changed. Start a new extraction from the current evidence.");
  const source = (await client.query("SELECT sha256,bytes,mime_type FROM sources WHERE id=$1", [item.sourceRevisionId])).rows[0];
  if (!source || source.sha256 !== item.sourceSha256 || Number(source.bytes) !== privateInput.payload.source.bytes || source.mime_type !== privateInput.payload.source.mimeType) conflict("The retained source no longer matches this extraction receipt.");
  const original = await readObject(privateInput.payload.source.objectKey);
  if (original.length !== privateInput.payload.source.bytes || sha256(original) !== item.sourceSha256) throw new AppError(422, "ML_SOURCE_INTEGRITY", "The retained original bytes no longer match the extraction receipt.");
  return part;
}

export async function retrySpatialMlItem(id: string, requestKey: string): Promise<SpatialMlItem> {
  uuid.parse(requestKey);
  const first = await getSpatialMlItemRecord(id);
  if (first.privateInput.retryRequests[requestKey]) return first.item;
  const status = await spatialMlStatus();
  return transaction(async client => {
    const record = await getSpatialMlItemRecord(id, client, true), { item, privateInput } = record;
    if (privateInput.retryRequests[requestKey]) return item;
    if (!["failed", "blocked", "cancelled"].includes(item.state)) throw new AppError(409, "ML_RETRY_STATE", "Only a failed, blocked or cancelled item needs a retry.");
    const row = (await client.query("SELECT case_id,body FROM import_packages WHERE id=$1", [item.packageId])).rows[0];
    if (!row || row.body.state === "COMMITTED") conflict("Open a correction before retrying extraction.");
    await assertSpatialMlSourceCurrent(record, row.body, client);
    const model = status.models.find(m => m.id === item.modelId && m.sha256 === item.modelSha256 && m.profileVersion === privateInput.payload.expectedProfileVersion);
    if (!model?.ready) throw new AppError(422, "MODEL_UNAVAILABLE", model?.reason ?? "The pinned model is unavailable or changed. Select the current model in a new batch.");
    const jobId = randomUUID(), now = new Date().toISOString();
    await client.query("INSERT INTO jobs(id,case_id,source_id,operation,input_fingerprint,payload) VALUES($1,$2,$3,'spatial-inference',$4,$5)", [jobId, row.case_id, item.sourceRevisionId, item.inputFingerprint, privateInput.payload]);
    item.currentJobId = jobId; item.state = "queued"; delete item.result;
    item.attempts.push({ jobId, state: "queued", createdAt: now }); privateInput.retryRequests[requestKey] = { jobId };
    await saveItem(client, record); return item;
  });
}

export async function cancelSpatialMlItem(id: string): Promise<SpatialMlItem> {
  return transaction(async client => {
    const record = await getSpatialMlItemRecord(id, client, true), { item } = record;
    if (!["queued", "running"].includes(item.state)) return item;
    item.state = "cancelled";
    const attempt = item.attempts.find(a => a.jobId === item.currentJobId)!;
    Object.assign(attempt, { state: "cancelled", completedAt: new Date().toISOString(), error: "Cancelled locally. Any late worker output will not be applied.", errorCode: "CANCELLED" });
    await client.query("UPDATE jobs SET status='cancelled',completed_at=now() WHERE id=$1 AND status IN ('queued','running')", [item.currentJobId]);
    await saveItem(client, record); return item;
  });
}

export async function markSpatialMlRunning(jobId: string) {
  return transaction(async client => {
    const row = (await client.query("SELECT id FROM spatial_ml_items WHERE current_job_id=$1", [jobId])).rows[0];
    if (!row) return;
    const record = await getSpatialMlItemRecord(row.id, client, true);
    if (record.item.currentJobId !== jobId || !["queued", "running"].includes(record.item.state)) return;
    record.item.state = "running";
    record.item.attempts.find(a => a.jobId === jobId)!.state = "running";
    await client.query("UPDATE jobs SET status='running',started_at=COALESCE(started_at,now()) WHERE id=$1 AND status IN ('queued','running')", [jobId]);
    await saveItem(client, record);
  });
}
export async function failSpatialMlJob(jobId: string, message: string, code = "INFERENCE_FAILED") {
  return transaction(async client => {
    const row = (await client.query("SELECT id FROM spatial_ml_items WHERE current_job_id=$1", [jobId])).rows[0];
    if (!row) return;
    const record = await getSpatialMlItemRecord(row.id, client, true), { item } = record;
    if (item.currentJobId !== jobId || !["queued", "running"].includes(item.state)) return;
    const state: SpatialMlState = ["MODEL_UNAVAILABLE", "MODEL_MISMATCH", "DEPENDENCY_UNAVAILABLE"].includes(code) ? "blocked" : "failed";
    item.state = state;
    Object.assign(item.attempts.find(a => a.jobId === jobId)!, { state, completedAt: new Date().toISOString(), error: message.slice(0, 600), errorCode: code.slice(0, 80) });
    await client.query("UPDATE jobs SET status='failed',completed_at=now(),error=$2 WHERE id=$1 AND status IN ('queued','running')", [jobId, message.slice(0, 600)]);
    await saveItem(client, record);
  });
}

const ringSchema = z.array(point).min(4).max(500);
const polygonSchema = z.object({ type: z.literal("Polygon"), coordinates: z.array(ringSchema).min(1).max(50) }).strict();
const multiPolygonSchema = z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(ringSchema).min(1).max(50)).min(1).max(50) }).strict();
const artifactSchema = z.object({ sha256: hash, width: z.number().int().positive().max(16000), height: z.number().int().positive().max(16000), bytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES), base64: z.string().min(1).max(Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4), mimeType: z.literal("image/png"), transform: z.record(z.string(), z.unknown()).optional() }).passthrough();
const resultSchema = z.object({
  schemaVersion: z.literal("spatial-inference/1"), inputFingerprint: hash, task,
  status: z.enum(["succeeded", "empty"]),
  model: z.object({ id: z.string(), sha256: hash, profileVersion: z.string().min(1).max(160), license: z.string().optional() }).passthrough(),
  raster: artifactSchema, mask: artifactSchema,
  components: z.array(z.object({ id: z.string().min(1).max(120), className: z.string().min(1).max(100), score: z.number().finite().min(0).max(1), geometry: z.union([polygonSchema, multiPolygonSchema]) }).passthrough()).max(100),
  receipt: z.record(z.string(), z.unknown()),
}).strict();
function rings(component: SpatialMlComponent): Point2[][] {
  return (component.geometry.type === "Polygon" ? component.geometry.coordinates : component.geometry.coordinates.flat()) as Point2[][];
}
export function validateSpatialMlPixels(components: SpatialMlComponent[], width: number, height: number) {
  if (new Set(components.map(c => c.id)).size !== components.length) throw new AppError(422, "ML_OUTPUT_INVALID", "Extraction component IDs are not unique.");
  for (const component of components) {
    const all = rings(component);
    if (all.reduce((n, r) => n + r.length, 0) > 500) throw new AppError(422, "ML_OUTPUT_LIMIT", "A model outline exceeds the bounded review size.");
    for (const ring of all) {
      if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1] || ring.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > width || y > height)) throw new AppError(422, "ML_PIXEL_GRID", "Model polygon coordinates do not belong to the retained raster grid.");
    }
  }
}
function artifactBytes(artifact: z.infer<typeof artifactSchema>) {
  const bytes = Buffer.from(artifact.base64, "base64");
  if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256 || artifact.width * artifact.height > MAX_RASTER_PIXELS || bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(16) !== artifact.width || bytes.readUInt32BE(20) !== artifact.height) throw new AppError(422, "ML_ARTIFACT_INTEGRITY", "The inference raster or mask failed its byte/hash/grid check.");
  return bytes;
}
export async function retainArtifact(itemId: string, jobId: string, kind: "raster" | "mask", artifact: z.infer<typeof artifactSchema>): Promise<Artifact> {
  const bytes = artifactBytes(artifact), objectKey = `spatial-ml/${itemId}/${jobId}/${kind}/${artifact.sha256}.png`;
  try { await putOriginal(objectKey, bytes, "image/png"); }
  catch (error) {
    // Replayed ingestion may encounter its immutable bytes. It must not overwrite.
    const stored = await readObject(objectKey).catch(() => null);
    if (!stored || stored.length !== bytes.length || sha256(stored) !== artifact.sha256) throw error;
  }
  return { objectKey, sha256: artifact.sha256, width: artifact.width, height: artifact.height, bytes: artifact.bytes, mimeType: "image/png" };
}
const artifactUrl = (id: string, jobId: string, kind: string, digest: string) => `/api/v1/spatial-ml/items/${id}/artifacts/${kind}?jobId=${jobId}&sha256=${digest}`;

export async function validateRetainedInference(value:unknown,expected:InferencePayload){
  const output = resultSchema.parse(value);
  if (output.inputFingerprint !== expected.inputFingerprint || output.model.id !== expected.modelId || output.model.sha256 !== expected.expectedModelSha256 || output.model.profileVersion !== expected.expectedProfileVersion || output.task !== expected.task) throw new AppError(422, "ML_RESULT_MISMATCH", "The worker result does not match the requested source/model/profile fingerprint.");
  if (output.receipt.sourceId !== expected.source.id || output.receipt.sourceSha256 !== expected.source.sha256 || output.receipt.modelSha256 !== expected.expectedModelSha256 || output.receipt.profileVersion !== expected.expectedProfileVersion || output.receipt.inputFingerprint !== expected.inputFingerprint) throw new AppError(422, "ML_RECEIPT_MISMATCH", "The worker receipt does not identify the exact source, model and inference profile requested.");
  if (output.mask.width !== output.raster.width || output.mask.height !== output.raster.height || (output.status === "empty") !== (output.components.length === 0)) throw new AppError(422, "ML_RESULT_MISMATCH", "Mask dimensions or empty-result state do not match the receipt.");
  validateSpatialMlPixels(output.components as SpatialMlComponent[], output.raster.width, output.raster.height);
  if (output.components.some(component => output.task === "building" ? component.className !== "building" : !FLOOR_CLASSES.has(component.className))) throw new AppError(422, "ML_OUTPUT_CLASS", "The model returned a class outside its pinned task vocabulary.");
  if (output.components.length) {
    const topology = (await query("SELECT bool_and(ST_IsValid(g) AND ST_Area(g)>0) valid FROM (SELECT ST_GeomFromGeoJSON(value->'geometry') g FROM jsonb_array_elements($1::jsonb)) components", [JSON.stringify(output.components)])).rows[0]?.valid;
    if (!topology) throw new AppError(422, "ML_OUTPUT_TOPOLOGY", "A model component has invalid polygon topology. Its raw attempt is retained; no proposal was applied.");
  }
  if (JSON.stringify(output.receipt).length > 100000) throw new AppError(422, "ML_RECEIPT_LIMIT", "The inference receipt exceeds its bounded size.");
  artifactBytes(output.raster); artifactBytes(output.mask);
  return output;
}

export async function ingestSpatialMlJob(jobId: string, value: unknown) {
  const found = (await query("SELECT id FROM spatial_ml_items WHERE current_job_id=$1", [jobId])).rows[0];
  if (!found) return;
  const initial = await getSpatialMlItemRecord(found.id);
  if (!["queued", "running"].includes(initial.item.state)) return;
  const {item}=initial;
  const output=await validateRetainedInference(value,initial.privateInput.payload);
  const raster = await retainArtifact(item.id, jobId, "raster", output.raster), mask = await retainArtifact(item.id, jobId, "mask", output.mask);
  const result: SpatialMlResult = {
    model: { id: output.model.id, sha256: output.model.sha256 },
    raster: { sha256: raster.sha256, width: raster.width, height: raster.height, url: artifactUrl(item.id, jobId, "raster", raster.sha256) },
    mask: { sha256: mask.sha256, width: mask.width, height: mask.height, url: artifactUrl(item.id, jobId, "mask", mask.sha256) },
    components: output.components.map(c => ({ id: c.id, className: c.className, score: c.score, geometry: c.geometry })),
    receipt: { ...output.receipt, model: output.model, rasterTransform: output.raster.transform, sourceSha256: item.sourceSha256, inputFingerprint: item.inputFingerprint, authority: "Unresolved model pixel proposals; metric placement and record review are separate." },
  };
  await transaction(async client => {
    const record = await getSpatialMlItemRecord(item.id, client, true);
    if (record.item.currentJobId !== jobId || !["queued", "running"].includes(record.item.state)) return;
    record.item.state = output.status; record.item.result = result;
    Object.assign(record.item.attempts.find(a => a.jobId === jobId)!, { state: output.status, completedAt: new Date().toISOString() });
    record.privateInput.outputs[jobId] = { result, artifacts: { raster, mask } };
    await client.query("UPDATE jobs SET status='succeeded',completed_at=now(),error=NULL WHERE id=$1 AND status IN ('queued','running')", [jobId]);
    await saveItem(client, record);
  });
}

/** Recompute from retained pixel rings. Browser-submitted metric outlines are never accepted. */
export function deriveSpatialMlGeometry(item: SpatialMlItem, input: SpatialMlCalibration): SpatialMlComponent[] {
  const calibration = spatialMlCalibrationSchema.parse(input), result = item.result;
  if (!result || item.state !== "succeeded") throw new AppError(422, "ML_RESULT_NOT_READY", "Select a completed nonempty extraction.");
  if (calibration.rasterSha256 !== result.raster.sha256) conflict("Calibration belongs to a different raster revision.");
  for (const [x, y] of calibration.imagePoints) if (x < 0 || y < 0 || x > result.raster.width || y > result.raster.height) throw new AppError(422, "ML_CALIBRATION_GRID", "Control points must lie on the retained inference raster.");
  const sourceDistance = Math.hypot(calibration.imagePoints[1][0] - calibration.imagePoints[0][0], calibration.imagePoints[1][1] - calibration.imagePoints[0][1]);
  const targetDistance = Math.hypot(calibration.worldPoints[1][0] - calibration.worldPoints[0][0], calibration.worldPoints[1][1] - calibration.worldPoints[0][1]);
  if (sourceDistance < 1 || targetDistance < .000001 || targetDistance / sourceDistance > 1000 || targetDistance / sourceDistance < .000001) throw new AppError(422, "ML_CALIBRATION_SCALE", "Use distinct, documented controls with a supported metre scale.");
  validateSpatialMlPixels(result.components, result.raster.width, result.raster.height);
  const ring = (points: number[][]) => points.map(p => transformPoint(p as Point2, calibration.imagePoints, calibration.worldPoints));
  return result.components.map(c => ({ ...c, geometry: c.geometry.type === "Polygon" ? { type: "Polygon", coordinates: c.geometry.coordinates.map(ring) } : { type: "MultiPolygon", coordinates: c.geometry.coordinates.map(p => p.map(ring)) } }));
}

export async function applySpatialMlItem(id: string, value: unknown): Promise<SpatialMlApplyResponse> {
  const input = spatialMlApplySchema.parse(value), requestDigest = fingerprint(input);
  if (new Set(input.selections.map(s => s.componentId)).size !== input.selections.length || new Set(input.selections.map(s => s.subject)).size !== input.selections.length) throw new AppError(422, "ML_SELECTION", "Select each component once and use a distinct space alias for each proposal.");
  const initial = await getSpatialMlItemRecord(id);
  return transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))");
    const row = (await client.query("SELECT body FROM import_packages WHERE id=$1 FOR UPDATE", [initial.item.packageId])).rows[0];
    if (!row) notFound("Preparation not found.");
    const pkg = row.body as ImportPackage, record = await getSpatialMlItemRecord(id, client, true), { item, privateInput } = record;
    if (privateInput.applyDigests[input.requestKey]) {
      if (privateInput.applyDigests[input.requestKey] !== requestDigest) throw new AppError(409, "ML_APPLY_KEY", "This application key was already used for a different selection or calibration.");
      return { package: pkg, item };
    }
    if (pkg.revision !== input.expectedRevision || pkg.state === "COMMITTED") conflict("Preparation changed. Refresh before adding selected proposals.");
    if ((item.task === "floor-plan" && input.property !== "space.geometry") || (item.task === "building" && input.property !== "outline.geometry")) throw new AppError(422, "ML_TASK_PROPERTY", "Floor-plan models propose interior spaces; building models propose exterior outlines. Select the matching draft property.");
    const part = await assertSpatialMlSourceCurrent(record, pkg, client);
    const entity = pkg.features.find(f => f.id === input.entityId);
    if (!entity || !part.entityIds.includes(entity.id) || privateInput.entityRevisions[entity.id] !== entity.revision) conflict("The target property or source association changed. Select current, explicitly associated evidence.");
    const currentFeature = (await client.query("SELECT revision FROM physical_features WHERE id=$1 FOR SHARE", [entity.id])).rows[0];
    if (currentFeature && currentFeature.revision !== entity.revision) conflict("The recorded property changed. Rebase its preparation before applying this extraction.");
    const preparation = (await client.query("SELECT body FROM building_preparations WHERE package_id=$1 FOR SHARE", [pkg.id])).rows[0]?.body;
    if (input.property === "space.geometry" && (preparation?.placement.status !== "reviewed" || preparation.placement.sourceFrame !== input.calibration.frame)) throw new AppError(422, "ML_PLACEMENT_REQUIRED", "Review the drawing's named metre frame and placement before adding space geometry. Pixel scale alone is insufficient.");
    const derived = deriveSpatialMlGeometry(item, input.calibration);
    const selected = input.selections.map(selection => {
      const component = derived.find(c => c.id === selection.componentId);
      if (!component) throw new AppError(422, "ML_SELECTION", "A selected component is unavailable in this exact result.");
      if (input.property === "space.geometry" && /^(wall|walls|background|outside|outdoor|railing)$/i.test(component.className)) throw new AppError(422, "ML_COMPONENT_ROLE", "Wall, outdoor and railing masks are review context, not interior space outlines. Select a room proposal.");
      return { selection, component };
    });
    const inputFingerprint = fingerprint({ inference: item.inputFingerprint, raster: item.result!.raster.sha256, selections: [...input.selections].sort((a, b) => a.componentId.localeCompare(b.componentId)), calibration: input.calibration, property: input.property, sourcePartHash: privateInput.sourcePartHash, entityId: entity.id, entityRevision: entity.revision, placementRevision: preparation?.placement.revision ?? null });
    if (item.applications.some(application => application.inputFingerprint === inputFingerprint)) {
      // Refresh/retry with a new request key cannot duplicate the same draft facts.
      privateInput.applyDigests[input.requestKey] = requestDigest;
      await saveItem(client, record); return { package: pkg, item };
    }
    const evidence = [{ sourceRevisionId: item.sourceRevisionId, partId: item.partId, page: item.page, ...(privateInput.payload.region ? { region: { ...privateInput.payload.region, unit: "normalized" as const } } : {}) }];
    const facts: PreparationFactInput[] = selected.flatMap(({ selection, component }) => [
      { entityId: entity.id, subject: selection.subject, property: "placement.controls", value: { ...input.calibration, itemId: item.id, jobId: item.currentJobId, modelId: item.modelId, modelSha256: item.modelSha256 }, unit: "m", referenceFrameId: input.calibration.frame, evidence, method: "human_entry" as const, evidenceState: "unresolved" as const, worldStatus: entity.worldStatus },
      { entityId: entity.id, subject: selection.subject, property: input.property, value: component.geometry, unit: "m", referenceFrameId: input.calibration.frame, evidence, method: "ai_extraction" as const, evidenceState: "unresolved" as const, worldStatus: entity.worldStatus },
    ]);
    const updated = await appendPreparationFacts(pkg.id, pkg.revision, facts, client);
    const factIds = updated.factCandidates.slice(pkg.factCandidates.length).map(f => f.id);
    item.applications.push({ requestKey: input.requestKey, inputFingerprint, calibration: input.calibration, entityId: entity.id, selections: input.selections, property: input.property, factIds, packageRevision: updated.revision, appliedAt: new Date().toISOString() });
    privateInput.applyDigests[input.requestKey] = requestDigest;
    await saveItem(client, record); return { package: updated, item };
  });
}

export async function spatialMlArtifact(id: string, kind: string, url: URL) {
  if (kind !== "raster" && kind !== "mask") notFound("Unknown extraction artifact.");
  const record = await getSpatialMlItemRecord(id), jobId = uuid.parse(url.searchParams.get("jobId"));
  const artifact = record.privateInput.outputs[jobId]?.artifacts[kind];
  if (!artifact || hash.parse(url.searchParams.get("sha256")) !== artifact.sha256) notFound("Retained extraction artifact not found.");
  const bytes = await readObject(artifact.objectKey);
  if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256) throw new AppError(422, "ML_ARTIFACT_INTEGRITY", "The retained extraction artifact failed integrity verification.");
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": artifact.mimeType, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-SHA256": artifact.sha256, "X-Content-Type-Options": "nosniff" } });
}

export async function spatialMlRoutes(request: Request, p: string[]): Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  const method = request.method, url = new URL(request.url);
  if (p.length === 1 && p[0] === "status" && method === "GET") return json(await spatialMlStatus());
  if (p[0] === "batches") {
    if (p.length === 1 && method === "GET") return json(await listSpatialMlBatches(uuid.parse(url.searchParams.get("packageId"))));
    if (p.length === 1 && method === "POST") return json(await createSpatialMlBatch(await request.json()), 201);
    if (p.length === 2 && method === "GET") return json(await getSpatialMlBatch(p[1]));
  }
  if (p[0] === "items") {
    const id = uuid.parse(p[1]);
    if (p.length === 2 && method === "GET") return json(await getSpatialMlItem(id));
    if (p.length === 4 && p[2] === "artifacts" && method === "GET") return spatialMlArtifact(id, p[3], url);
    if (p.length === 3 && method === "POST") {
      if (p[2] === "retry") return json(await retrySpatialMlItem(id, z.object({ requestKey: uuid }).strict().parse(await request.json()).requestKey));
      if (p[2] === "cancel") return json(await cancelSpatialMlItem(id));
      if (p[2] === "apply") return json(await applySpatialMlItem(id, await request.json()));
      if (p[2] === "footprint-drafts") return json(await (await import("./spatial-ml-footprints")).createSpatialMlFootprintDraft(id, await request.json()));
    }
  }
  notFound("Unknown spatial extraction route.");
}
