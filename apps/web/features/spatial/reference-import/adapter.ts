import { z } from "zod";
import {
  assertCoreJson, buildCoreSnapshot, CoreEntityKindSchema, CoreIdSchema, CorePlanarGeometrySchema,
  CorePositiveRevisionSchema, CORE_RELATION_POLICY, coreRefKey, validateCoreSnapshotInput,
  type CoreEntityKind, type CoreRelation, type CoreRepresentation, type CoreSnapshotInput,
} from "@ulpin/contracts";

export const REFERENCE_INPUT_VERSION = "1.0.0" as const;
const nullableNumber = z.number().nullable();
const id = CoreIdSchema;
const SourceScene = z.object({
  schemaVersion: z.literal(REFERENCE_INPUT_VERSION),
  metadata: z.object({ id, title: z.string().min(1).max(512), classification: z.literal("synthetic") }).passthrough(),
  frames: z.array(z.object({
    id, name: z.string().min(1).max(512), kind: z.literal("local_cartesian"),
    horizontalUnit: z.literal("metre"), verticalUnit: z.literal("metre"),
    axisOrder: z.tuple([z.literal("east"), z.literal("north"), z.literal("up")]),
    verticalDatum: z.string().min(1).max(1024), nativeCrs: z.string().optional(),
  }).passthrough()).min(1).max(32),
  objects: z.array(z.object({
    id, type: z.string().min(1), label: z.string().min(1).max(512), systemId: z.string().optional(),
    revision: CorePositiveRevisionSchema.optional(), geometryId: id.nullable(),
    sourceRecordIds: z.array(id), attributes: z.record(z.string(), z.unknown()).optional(),
  }).passthrough()).max(2000),
  geometries: z.array(z.object({
    id, objectId: id, version: CorePositiveRevisionSchema, frameId: id, type: z.string(),
    coordinates: z.unknown().optional(), baseElevationM: nullableNumber, heightM: nullableNumber,
    verticalDatum: z.string().min(1).max(1024), sourceRecordIds: z.array(id),
  }).passthrough()).max(4000),
  relations: z.array(z.object({ id, fromId: id, toId: id, kind: z.string() }).passthrough()).max(8000),
  sources: z.array(z.object({
    id, label: z.string().min(1).max(512), revision: z.union([z.string().min(1), CorePositiveRevisionSchema]),
    mimeType: z.string(), classification: z.literal("synthetic"),
    originalSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
    byteSize: z.number().int().nonnegative().nullable().optional(),
  }).passthrough()).max(1000),
  sourceRecords: z.array(z.object({
    id, sourceId: id, sourceRevision: z.union([z.string().min(1), CorePositiveRevisionSchema]),
    locator: z.string().min(1).max(4096),
  }).passthrough()).max(8000),
}).passthrough();

type ReferenceScene = z.infer<typeof SourceScene>;
export interface ReferenceDiagnostic {
  code: string;
  severity: "notice" | "unsupported";
  objectId?: string;
  geometryId?: string;
  message: string;
}
export interface ReferenceBinding {
  sourceId: string;
  sourceRevision: string | number;
  canonicalSource: { ref: { namespace: "source_revision"; id: string }; revision: number };
}
const reference = <N extends string>(namespace: N, id: string) => ({ namespace, id });
const pin = <N extends string>(namespace: N, id: string, revision = 1) => ({ ref: reference(namespace, id), revision });
async function sha256(text: string) {
  const bytes = new TextEncoder().encode(text);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
}
function index<T extends { id: string }>(items: T[], label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    if (result.has(item.id)) throw new Error(`Duplicate ${label}: ${item.id}`);
    result.set(item.id, item);
  }
  return result;
}
function physicalKind(kind: string): CoreEntityKind {
  return CoreEntityKindSchema.parse(kind === "floor" ? "level" : kind === "open_area" ? "public_land" : kind);
}
const roleFor = (kind: CoreEntityKind): CoreRepresentation["role"] => {
  switch (kind) {
    case "parcel": return "recorded_parcel";
    case "road": return "road_surface";
    case "level": return "floor_boundary";
    case "space": return "unit_boundary";
    case "public_land": return "public_land";
    case "utility": case "rail": return "alignment";
    case "terrain": return "terrain_surface";
    default: return "ground_footprint";
  }
};

/** Pure receipt/compatibility boundary. Does not register blobs, issue IDs, publish or write database records. */
export async function adaptReferenceScene(originalText: string) {
  if (new TextEncoder().encode(originalText).length > 16 * 1024 * 1024) throw new Error("Reference JSON exceeds the 16 MB adapter profile");
  const json: unknown = JSON.parse(originalText);
  assertCoreJson(json);
  const source = SourceScene.parse(json);
  const originalSha256 = await sha256(originalText);
  const objects = index(source.objects, "object"), geometries = index(source.geometries, "geometry");
  const frames = index(source.frames, "frame"), sources = index(source.sources, "source");
  const records = index(source.sourceRecords, "source record");
  index(source.relations, "relation");
  const diagnostics: ReferenceDiagnostic[] = [];
  const receiptId = `reference-json:${originalSha256}`;
  const world = pin("world", source.metadata.id), dataset = pin("dataset", source.metadata.id);
  const bindings: ReferenceBinding[] = await Promise.all(source.sources.map(async s => ({
    sourceId: s.id, sourceRevision: s.revision,
    // String revision tokens are not family ordinals. They form immutable receipt identities.
    canonicalSource: pin("source_revision", `reference-source:${await sha256(JSON.stringify([s.id, s.revision, s.originalSha256 ?? null]))}`),
  })));
  const bindingById = new Map(bindings.map(b => [b.sourceId, b]));
  const asset = (assetId: string, mediaType: string, sha: string | null, bytes: number | null) => ({
    ...pin("asset", assetId), kind: "original" as const, mediaType, sha256: sha, bytes,
    storage: { state: "unavailable" as const, reason: "Receipt metadata only; original bytes are not registered by this adapter" },
    integrity: "metadata_only" as const, access: "operator" as const,
    retention: { policy: "preserve_original" as const, legalHold: null }, parentAssets: [],
  });
  const sourceParts: CoreSnapshotInput["sources"]["parts"][number][] = source.sourceRecords.map((record, n) => {
    const supplied = sources.get(record.sourceId);
    if (!supplied || supplied.revision !== record.sourceRevision) throw new Error(`Missing or stale source revision on ${record.id}`);
    // The exact JSON record is known. The source's free-form locator remains verbatim, not guessed as a CSV row/page.
    return { ...pin("source_part", record.id), source: pin("source_revision", receiptId), asset: pin("asset", receiptId),
      locators: [{ kind: "json_pointer", pointer: `/sourceRecords/${n}` }, { kind: "verbatim", locator: record.locator }], access: "operator" };
  });
  const entities = source.objects.map(object => ({
    ref: reference("physical", object.id), revision: object.revision ?? 1, kind: physicalKind(object.type), label: object.label,
    identifiers: object.systemId ? [{ scheme: "reference_system_id", issuer: "Synthetic reference package", value: object.systemId, status: "prototype" as const, historical: false }] : [],
    memberships: [{ collection: reference("dataset", source.metadata.id), role: "authoring" as const }], lifecycle: { state: "active" as const },
  }));
  const kinds = new Map(entities.map(e => [e.ref.id, e.kind]));
  const relations: CoreRelation[] = [];
  for (const r of source.relations) {
    if (!objects.has(r.fromId) || !objects.has(r.toId)) throw new Error(`Missing relation endpoint: ${r.id}`);
    let from = r.fromId, to = r.toId, kind: string = r.kind;
    if (r.kind === "contains") {
      from = r.toId; to = r.fromId;
      kind = kinds.get(to) === "parcel" ? "associated_parcel" : "part_of";
    }
    const policy = CORE_RELATION_POLICY[kind as keyof typeof CORE_RELATION_POLICY];
    if (!policy || !policy.pairs.some(([a, b]) => a === kinds.get(from) && b === kinds.get(to))) {
      diagnostics.push({ code: "UNSUPPORTED_RELATION", severity: "unsupported", message: `Relation ${r.id} (${r.kind}) is retained in the original receipt; no qualified core endpoint mapping exists` });
      continue;
    }
    relations.push({ id: r.id, revision: 1, kind: kind as CoreRelation["kind"], from: reference("physical", from), to: reference("physical", to), note: `Source relationship ${r.id}; ${r.kind}` });
  }
  const representations: CoreRepresentation[] = [];
  const observations: CoreSnapshotInput["observations"][number][] = [];
  const resolutions: CoreSnapshotInput["resolutions"][number][] = [];
  const compositions: CoreSnapshotInput["compositions"][number][] = [];
  const active = new Set<string>();
  for (const object of source.objects) {
    for (const recordId of object.sourceRecordIds) if (!records.has(recordId)) throw new Error(`Missing source record ${recordId} on ${object.id}`);
    if (object.geometryId !== null) {
      const geometry = geometries.get(object.geometryId);
      if (!geometry || geometry.objectId !== object.id) throw new Error(`Missing or foreign active geometry on ${object.id}`);
      active.add(geometry.id);
    } else diagnostics.push({ code: "MISSING_GEOMETRY", severity: "unsupported", objectId: object.id, message: "Identity retained without invented geometry" });
  }
  for (const [n, geometry] of source.geometries.entries()) {
    if (!objects.has(geometry.objectId)) throw new Error(`Missing geometry owner: ${geometry.id}`);
    const frame = frames.get(geometry.frameId);
    if (!frame) throw new Error(`Missing geometry frame: ${geometry.id}`);
    if (frame.verticalDatum !== geometry.verticalDatum) throw new Error(`Vertical benchmark mismatch: ${geometry.id}`);
    for (const recordId of geometry.sourceRecordIds) if (!records.has(recordId)) throw new Error(`Missing geometry source record: ${recordId}`);
    const partId = `reference-geometry:${await sha256(geometry.id)}`;
    sourceParts.push({ ...pin("source_part", partId, geometry.version), source: pin("source_revision", receiptId), asset: pin("asset", receiptId),
      locators: [{ kind: "json_pointer", pointer: `/geometries/${n}` }], access: "operator" });
    const parts = [pin("source_part", partId, geometry.version), ...geometry.sourceRecordIds.map(i => pin("source_part", i))];
    const kind = kinds.get(geometry.objectId)!;
    let role = roleFor(kind);
    let profile: CoreRepresentation["geometry"];
    const shape = CorePlanarGeometrySchema.safeParse({ type: geometry.type, coordinates: geometry.coordinates });
    if (!shape.success) {
      const code = geometry.type === "LineString" ? "UNSUPPORTED_3D_ALIGNMENT" : "UNSUPPORTED_GEOMETRY_PROFILE";
      diagnostics.push({ code, severity: "unsupported", objectId: geometry.objectId, geometryId: geometry.id, message: "Native coordinates retained in original receipt; this core profile accepts XY planar geometry and vertical prisms only" });
      profile = { profile: "unavailable", reason: code };
    } else if (shape.data.type === "Polygon" || shape.data.type === "MultiPolygon") {
      const base = geometry.baseElevationM, height = geometry.heightM;
      if (height !== null && height < 0) throw new Error(`Negative height: ${geometry.id}`);
      const hasVertical = base !== null && height !== null;
      if (hasVertical && !Number.isFinite(base + height)) throw new Error(`Vertical interval overflow: ${geometry.id}`);
      if (["building", "building_part"].includes(kind) && hasVertical) role = "exterior";
      profile = { profile: "prism", footprint: shape.data, interval: hasVertical ? { lowerMetres: base, upperMetres: base + height, reference: pin("benchmark", frame.id) } : null };
      if (!hasVertical) diagnostics.push({ code: "UNKNOWN_VERTICAL_INTERVAL", severity: "notice", objectId: geometry.objectId, geometryId: geometry.id, message: "Footprint retained; no measured volume or height has been inferred" });
    } else profile = { profile: "planar", geometry: shape.data };
    const rep: CoreRepresentation = { ...pin("representation", geometry.id, geometry.version), entity: reference("physical", geometry.objectId), frame: pin("frame", frame.id), role, geometry: profile, sourceParts: parts };
    representations.push(rep);
    const generatedId = `reference-selection:${await sha256(geometry.id)}`;
    const observation = { ...pin("observation", generatedId, geometry.version), entity: rep.entity, world, role, method: "synthetic" as const, access: "operator" as const,
      sourceParts: parts, validity: { fromMs: null, toMs: null }, payload: { kind: "geometry" as const, representation: pin("representation", geometry.id, geometry.version) } };
    observations.push(observation);
    if (active.has(geometry.id)) {
      const selected = pin("observation", generatedId, geometry.version);
      resolutions.push({ ...pin("resolution", generatedId, geometry.version), entity: rep.entity, world, role, candidates: [selected], selected, reason: "Explicit geometryId selected by source package; not officer approval" });
      compositions.push({ ...pin("composition", generatedId, geometry.version), entity: rep.entity, world, kind: "passthrough", geometry: pin("resolution", generatedId, geometry.version) });
    }
  }
  const input = validateCoreSnapshotInput({
    schemaVersion: "ulpin-spatial/2", context: { world, asOfMs: null, scope: { id: `reference:${source.metadata.id}`, revision: 1, ceiling: "operator" } },
    worlds: [{ ...world, label: source.metadata.title, state: "synthetic" }], identity: { entities, relations },
    frames: { frames: source.frames.map(f => ({ ...pin("frame", f.id), label: f.name, sourceCrs: f.nativeCrs ?? null,
      kind: "engineering", horizontalUnit: "m", axes: ["east", "north"], verticalUnit: "m", verticalDirection: "up",
      vertical: { kind: "benchmark", reference: pin("benchmark", f.id), label: f.verticalDatum } })), operations: [] },
    sources: {
      datasets: [{ ...dataset, label: source.metadata.title, classification: "synthetic", attribution: "Authored synthetic reference package", license: null, access: "operator" }],
      assets: [asset(receiptId, "application/json", originalSha256, new TextEncoder().encode(originalText).length),
        ...source.sources.map(s => asset(bindingById.get(s.id)!.canonicalSource.ref.id, s.mimeType, s.originalSha256 ?? null, s.byteSize ?? null))],
      sources: [{ ...pin("source_revision", receiptId), family: null, familyOrdinal: null, label: "Original normalized reference JSON", profile: "reference-scene/1.0.0", method: "synthetic", dataset, assets: [pin("asset", receiptId)], workflows: [], access: "operator" },
        ...source.sources.map(s => ({ ...bindingById.get(s.id)!.canonicalSource, family: reference("source_family", s.id), familyOrdinal: null, label: s.label, profile: "reference-source", method: "synthetic", dataset,
          assets: [pin("asset", bindingById.get(s.id)!.canonicalSource.ref.id)], workflows: [], access: "operator" }))],
      parts: sourceParts, links: [],
    },
    geometry: { representations, reportedQuantities: [] }, observations, resolutions, compositions,
  });
  const snapshot = await buildCoreSnapshot(input);
  diagnostics.push({ code: "RECEIPT_ONLY_FIELDS", severity: "notice", message: "Raw observations, rights, issues, identifier assertions, lineage and presentation remain in the exact receipt; this adapter does not promote them to verified facts" });
  return { input, snapshot, originalText, originalSha256, diagnostics, bindings, source };
}
export type AdaptedReferenceScene = Awaited<ReturnType<typeof adaptReferenceScene>>;
