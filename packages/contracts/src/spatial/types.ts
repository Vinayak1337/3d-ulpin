/** Renderer-neutral contract. Originals and registry records remain authoritative. */
export const SPATIAL_SCHEMA = "ulpin-spatial/1" as const;
export type SpatialKind = "building" | "building_part" | "level" | "space" | "parcel" | "road" | "rail" | "utility" | "public_land" | "terrain" | "vegetation";
export type WorldState = "observed" | "planned" | "hypothetical" | "synthetic";
export type XY = readonly [
    number,
    number
];
export type XYZ = readonly [
    number,
    number,
    number
];
export type PolygonRings = readonly (readonly XY[])[];
export type SpatialGeometry = {
    type: "Point";
    coordinates: XY;
} | {
    type: "LineString";
    coordinates: readonly XY[];
} | {
    type: "Polygon";
    coordinates: PolygonRings;
} | {
    type: "MultiPolygon";
    coordinates: readonly PolygonRings[];
};
export type SpatialGeometryRole = "unspecified" | "design_outline" | "recorded_road_land" | "restriction" | "ground_footprint" | "roof_projection" | "exterior" | "floor_boundary" | "unit_boundary" | "recorded_parcel" | "road_surface" | "alignment" | "public_land" | "terrain_surface" | "display_only";
export interface SpatialFrame {
    id: string;
    kind: "engineering" | "geographic";
    horizontalUnit: "m" | "degree";
    verticalUnit: "m";
    axes: "east-north-up" | "longitude-latitude-height";
    verticalReference: string | null;
    /** Only supplied/reviewed anchors qualify; a local benchmark is not an ellipsoid altitude. */
    anchor?: {
        longitude: number;
        latitude: number;
        ellipsoidHeight: number;
        provenance: string;
    };
    sourceCrs?: string;
}
export interface SpatialSource {
    id: string;
    /** Null when an immutable source revision ID is known but its family ordinal is not. */
    revision: number | null;
    label: string;
    method: "source" | "manual" | "derived" | "synthetic";
    /** Absent means bytes/hash were not supplied, never a fabricated checksum. */
    sha256?: string;
}
export interface SpatialEvidence {
    sourceId: string;
    sourceRevision: number | null;
    locator: {
        kind: "feature" | "page" | "row" | "json_pointer" | "manual";
        value: string;
    };
}
export interface SpatialIdentifier {
    scheme: string;
    issuer: string;
    value: string;
    status: "supplied" | "validated" | "prototype";
}
export interface SpatialEntity {
    id: string;
    revision: number;
    worldId: string;
    kind: SpatialKind;
    label: string;
    identifiers: readonly SpatialIdentifier[];
    /** Many memberships are allowed; area/tile membership never allocates identity. */
    areaIds: readonly string[];
    representationIds: readonly string[];
}
export interface SpatialRepresentation {
    id: string;
    revision: number;
    entityId: string;
    frameId: string;
    role: SpatialGeometryRole;
    geometry: SpatialGeometry;
    vertical: {
        lower: number;
        upper: number;
        reference: string;
    } | null;
    evidence: readonly SpatialEvidence[];
    /** This is an authored visual fixture profile, not inferred survey detail. */
    appearance?: {
        facade: "plain" | "schematic";
        storeys?: number;
        roof?: "flat" | "terrace";
    };
}
export interface SpatialRelation {
    id: string;
    fromId: string;
    toId: string;
    kind: "part_of" | "occupies_level" | "associated_parcel" | "serves" | "crosses";
}
export interface SpatialAttachmentLink {
    id: string;
    entityId: string;
    sourceId: string;
    sourceRevision: number | null;
    purpose: "context" | "geometry" | "record";
}
export interface SpatialSnapshot {
    schemaVersion: typeof SPATIAL_SCHEMA;
    id: string;
    revision: number;
    worldId: string;
    worldState: WorldState;
    frames: readonly SpatialFrame[];
    sources: readonly SpatialSource[];
    entities: readonly SpatialEntity[];
    representations: readonly SpatialRepresentation[];
    relations: readonly SpatialRelation[];
    attachments: readonly SpatialAttachmentLink[];
}
export interface SpatialQuantity {
    definition: "horizontal_area" | "prism_volume";
    value: number | null;
    unit: "m2" | "m3";
    representationId: string;
    representationRevision: number;
    reason?: string;
}
