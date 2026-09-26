import { SPATIAL_SCHEMA, validateGeometry, validateSpatialSnapshot, type AreaContext, type GeometryRole, type SpatialEntity, type SpatialFrame, type SpatialRepresentation, type SpatialSnapshot, type SpatialSource, type WorldState, } from "@ulpin/contracts";
export interface AdapterDiagnostic {
    entityId: string;
    code: string;
    message: string;
}
const roles: Partial<Record<GeometryRole, SpatialRepresentation["role"]>> = {
    observed_ground_occupation: "ground_footprint", observed_roof_projection: "roof_projection",
    approved_building_outline: "design_outline", recorded_parcel: "recorded_parcel",
    public_road_land: "recorded_road_land", road_surface: "road_surface", public_land: "public_land",
    physical_utility: "alignment", documented_restriction: "restriction",
};
/** Read-only compatibility lens. Existing IDs, writer, source bytes and stored coordinates are unchanged.
 * Geographic 2D and source-local metric representations stay distinct; no ellipsoid height is guessed.
 */
export function adaptAreaContext(context: AreaContext, worldState: WorldState): {
    snapshot: SpatialSnapshot;
    diagnostics: AdapterDiagnostic[];
} {
    const worldId = `legacy:${context.area.id}:${worldState}`;
    const entities: SpatialEntity[] = [], representations: SpatialRepresentation[] = [];
    const frames: SpatialFrame[] = [], sources = new Map<string, SpatialSource>();
    const diagnostics: AdapterDiagnostic[] = [];
    for (const feature of context.features.filter(f => f.worldStatus === worldState)) {
        const sourceId = feature.sourceRevisionId;
        // sourceRevisionId is already the legacy immutable source-revision UUID.
        // The numerical family revision is not in AreaContext: null, not an invented 1.
        if (!sources.has(sourceId))
            sources.set(sourceId, { id: sourceId, revision: null, label: `Source revision ${sourceId}`, method: "source" });
        const entity: SpatialEntity = { id: feature.id, revision: feature.revision, worldId, kind: feature.kind,
            label: feature.name, identifiers: [{ scheme: "legacy-prototype", issuer: "3d-ulpin", value: feature.identifier, status: "prototype" }],
            areaIds: [...new Set([feature.areaId, context.area.id])], representationIds: [] };
        const ids: string[] = [];
        const role = roles[feature.semantics?.geometryRole || feature.geometryRole || "unknown"] || "unspecified";
        const evidence = [{ sourceId, sourceRevision: null, locator: { kind: "feature" as const, value: feature.sourceKey } }];
        for (const geographic of [false, true]) {
            const geometry = geographic ? feature.geographicGeometry : feature.geometry;
            try {
                validateGeometry(geometry);
            }
            catch (error) {
                diagnostics.push({ entityId: feature.id, code: "unsupported_geometry", message: error instanceof Error ? error.message : "Unsupported profile" });
                continue;
            }
            // Frames are feature-scoped because legacy building-relative zeroes need not align between features.
            const fid = geographic ? "legacy:CRS84" : `legacy:${context.area.id}:${feature.id}:metric`;
            const reference = feature.verticalExtent?.reference || feature.height.reference || context.area.reference?.verticalReference || null;
            if (!frames.some(f => f.id === fid))
                frames.push(geographic ? {
                    id: fid, kind: "geographic", axes: "longitude-latitude-height", horizontalUnit: "degree", verticalUnit: "m", verticalReference: null, sourceCrs: "OGC:CRS84",
                } : { id: fid, kind: "engineering", axes: "east-north-up", horizontalUnit: "m", verticalUnit: "m", verticalReference: reference, sourceCrs: context.area.reference?.analysisCrs });
            const rid = `${feature.id}:${geographic ? "geographic" : "local"}:${role}`;
            // A source height alone is not enough to assert a global lower/upper elevation.
            const vertical = !geographic && feature.verticalExtent && reference ? {
                lower: feature.verticalExtent.lower, upper: feature.verticalExtent.upper, reference,
            } : null;
            representations.push({ id: rid, revision: feature.revision, entityId: feature.id, frameId: fid, role, geometry, vertical, evidence });
            ids.push(rid);
        }
        entities.push({ ...entity, representationIds: ids });
        if (!feature.verticalExtent)
            diagnostics.push({ entityId: feature.id, code: "vertical_placement_unresolved", message: "Height, when supplied, remains in the legacy source; no absolute lower elevation was invented." });
        if (role === "unspecified")
            diagnostics.push({ entityId: feature.id, code: "geometry_meaning_unresolved", message: "No ground/roof/road-boundary meaning was inferred from the feature kind." });
    }
    const snapshot: SpatialSnapshot = { schemaVersion: SPATIAL_SCHEMA, id: `${worldId}:snapshot`, revision: context.area.revision, worldId, worldState, frames, sources: [...sources.values()], entities, representations, relations: [], attachments: [] };
    validateSpatialSnapshot(snapshot);
    return { snapshot, diagnostics };
}
