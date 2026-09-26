import {
  coreRefKey, SPATIAL_SCHEMA, validateSpatialSnapshot,
  type CoreRef, type SpatialEntity, type SpatialFrame, type SpatialRepresentation, type SpatialSnapshot,
} from "@ulpin/contracts";
import type { AdaptedReferenceScene, ReferenceDiagnostic } from "./adapter";

export interface ReferenceDisplayOptions {
  /** Multiple unrelated frames require explicit selection; no implicit overlay/reprojection. */
  frameId?: string;
  /** Required only by the existing world tile compiler. Supplied placement never changes local canonical coordinates. */
  anchor?: NonNullable<SpatialFrame["anchor"]>;
}
export interface ReferenceDisplayBinding {
  entityId: string;
  canonicalEntity: CoreRef;
  representationId: string;
  canonicalRepresentation: { ref: { namespace: "representation"; id: string }; revision: number };
}

/** Disposable v1 renderer DTO projected from a validated v2 candidate, not another canonical store. */
export function projectReferenceScene(data: AdaptedReferenceScene, options: ReferenceDisplayOptions = {}) {
  const diagnostics: ReferenceDiagnostic[] = [];
  const frameId = options.frameId ?? (data.input.frames.frames.length === 1 ? data.input.frames.frames[0].ref.id : undefined);
  if (!frameId) throw new Error("Choose one named frame; unrelated frames cannot be overlaid implicitly");
  const frame = data.input.frames.frames.find(f => f.ref.id === frameId);
  if (!frame || frame.kind !== "engineering" || frame.horizontalUnit !== "m" || frame.verticalUnit !== "m" || frame.verticalDirection !== "up" || frame.axes.join() !== "east,north") throw new Error("Unsupported display frame profile");
  if (frame.vertical.kind !== "benchmark" && frame.vertical.kind !== "datum") throw new Error("Named vertical reference required");
  const verticalReference = coreRefKey(frame.vertical.reference.ref);
  const worldId = coreRefKey(data.input.context.world.ref), sourceId = `reference-json:${data.originalSha256}`;
  const entities: SpatialEntity[] = [], representations: SpatialRepresentation[] = [], bindings: ReferenceDisplayBinding[] = [];
  const byEntity = new Map(data.input.identity.entities.map(e => [coreRefKey(e.ref), e]));
  const rawGeometries = new Map(data.source.geometries.map(g => [g.id, g]));
  const rawObjects = new Map(data.source.objects.map(o => [o.id, o]));
  const supportedKinds = new Set(["building", "building_part", "level", "space", "parcel", "road", "rail", "utility", "public_land", "terrain", "vegetation"]);
  for (const rep of data.snapshot.geometry.representations) {
    const entity = byEntity.get(coreRefKey(rep.entity))!;
    const reject = (code: string, message: string) => diagnostics.push({ code, severity: "unsupported", objectId: entity.ref.id, geometryId: rep.ref.id, message });
    if (rep.frame?.ref.id !== frameId) { reject("OTHER_RENDER_FRAME", "Representation retained in another frame; a reviewed transform is required"); continue; }
    if (!supportedKinds.has(entity.kind)) { reject("UNSUPPORTED_RENDER_KIND", "Identity retained without a qualified renderer profile"); continue; }
    const profile = rep.geometry;
    if (profile.profile !== "planar" && profile.profile !== "prism") { reject("UNAVAILABLE_RENDER_GEOMETRY", "Native source retained without an invented mesh"); continue; }
    const geometry = profile.profile === "prism" ? profile.footprint : profile.geometry;
    if (geometry.type === "Point" && entity.kind !== "vegetation") { reject("UNSUPPORTED_RENDER_POINT", "The current point renderer only qualifies authored vegetation"); continue; }
    if (geometry.type === "LineString" && !["road", "rail", "utility"].includes(entity.kind)) { reject("UNSUPPORTED_RENDER_ALIGNMENT", "This entity has no qualified alignment display profile"); continue; }
    const raw = rawGeometries.get(rep.ref.id)!;
    const interval = profile.profile === "prism" ? profile.interval : null;
    const lower = interval?.lowerMetres ?? raw.baseElevationM ?? 0;
    const upper = interval?.upperMetres ?? lower;
    const unknownBase = interval === null && raw.baseElevationM === null;
    if (unknownBase) diagnostics.push({ code: "DISPLAY_ZERO_ONLY", severity: "notice", objectId: entity.ref.id, geometryId: rep.ref.id, message: "Unknown elevation uses the display zero plane only; no vertical measurement is implied" });
    const entityId = coreRefKey(entity.ref), representationId = coreRefKey(rep.ref);
    const count = rawObjects.get(entity.ref.id)?.attributes?.floorCount;
    const appearance = ["building", "building_part"].includes(entity.kind) && typeof count === "number" && Number.isInteger(count) && count >= 1 && count <= 100 && (upper - lower) / count >= 1
      ? { facade: "schematic" as const, storeys: count, roof: "flat" as const, envelopeOnly: true } : undefined;
    entities.push({ id: entityId, revision: entity.revision, worldId, kind: entity.kind as SpatialEntity["kind"], label: entity.label,
      identifiers: entity.identifiers.map(i => ({ scheme: i.scheme, issuer: i.issuer, value: i.value, status: i.status === "prototype" ? "prototype" : "supplied" })),
      areaIds: entity.memberships.map(m => coreRefKey(m.collection)), representationIds: [representationId] });
    representations.push({ id: representationId, revision: rep.revision, entityId, frameId, role: geometry.type === "LineString" || unknownBase ? "display_only" : rep.role, geometry,
      vertical: { lower, upper, reference: verticalReference }, evidence: [{ sourceId, sourceRevision: 1, locator: { kind: "feature", value: rep.ref.id } }], ...(appearance ? { appearance } : {}) });
    bindings.push({ entityId, canonicalEntity: entity.ref, representationId, canonicalRepresentation: { ref: { namespace: "representation", id: rep.ref.id }, revision: rep.revision } });
  }
  const visibleIds = new Set(entities.map(e => e.id));
  const allowedRelations = new Set(["part_of", "occupies_level", "associated_parcel", "serves", "crosses"]);
  const snapshot: SpatialSnapshot = {
    schemaVersion: SPATIAL_SCHEMA, id: `reference-view:${data.snapshot.manifest.inputDigest}`, revision: 1, worldId, worldState: "synthetic",
    frames: [{ id: frameId, kind: "engineering", horizontalUnit: "m", verticalUnit: "m", axes: "east-north-up", verticalReference,
      ...(frame.sourceCrs ? { sourceCrs: frame.sourceCrs } : {}), ...(options.anchor ? { anchor: options.anchor } : {}) }],
    sources: [{ id: sourceId, revision: 1, label: "Original normalized reference JSON", method: "synthetic", sha256: data.originalSha256 }],
    entities, representations,
    relations: data.input.identity.relations.filter(r => allowedRelations.has(r.kind) && visibleIds.has(coreRefKey(r.from)) && visibleIds.has(coreRefKey(r.to)))
      .map(r => ({ id: r.id, fromId: coreRefKey(r.from), toId: coreRefKey(r.to), kind: r.kind as SpatialSnapshot["relations"][number]["kind"] })), attachments: [],
  };
  validateSpatialSnapshot(snapshot);
  return { snapshot, bindings, diagnostics };
}
