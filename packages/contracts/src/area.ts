import { z } from 'zod';
import { STREAMING_VECTOR_LIMITS } from './usp/streaming-vector';

export const SourceRangeReferenceSchema = z.strictObject({
  format: z.literal('geojson'), featureIndex: z.number().int().safe().nonnegative(),
  byteStart: z.number().int().safe().nonnegative(), byteEnd: z.number().int().safe().positive(),
  rawSha256: z.string().regex(/^[a-f0-9]{64}$/), readerVersion: z.literal(STREAMING_VECTOR_LIMITS.version),
}).refine(range => range.byteEnd > range.byteStart).readonly();
export type SourceRangeReference = z.infer<typeof SourceRangeReferenceSchema>;

const nativeRecordFields = {
  position: z.number().int().safe(), encoding: z.string().min(1).max(64),
  idField: z.string().min(1).max(256), readerVersion: z.literal('native-gis-v2'),
};
export const NativeRecordReferenceSchema = z.discriminatedUnion('format', [
  z.strictObject({ ...nativeRecordFields, format: z.literal('shapefile_zip'),
    member: z.string().min(1).max(1024), position: nativeRecordFields.position.nonnegative(),
    positionKind: z.literal('sequence') }).readonly(),
  z.strictObject({ ...nativeRecordFields, format: z.literal('gpkg'), table: z.string().min(1).max(256),
    positionKind: z.enum(['rowid', 'integer_primary_key']), positionField: z.string().min(1).max(256) }).readonly(),
]);
export type NativeRecordReference = z.infer<typeof NativeRecordReferenceSchema>;

/** Canonical v2 physical observations. Local geometry is NOT RFC 7946 GeoJSON. */
export type EvidenceState =
  | "unresolved"
  | "estimated"
  | "source_supported"
  | "reviewed";
export type WorldStatus = "observed" | "planned" | "hypothetical" | "synthetic";
export type FeatureKind =
  | "building"
  | "parcel"
  | "road"
  | "public_land"
  | "utility";
export type AreaGeometry =
  | {
      type: "GeometryCollection";
      geometries: AreaGeometry[];
      coordinates?: never;
    }
  | { type: "Point"; coordinates: number[] }
  | { type: "MultiPoint"; coordinates: number[][] }
  | { type: "LineString"; coordinates: number[][] }
  | { type: "MultiLineString"; coordinates: number[][][] }
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };
export interface AreaReference {
  /** Import-time position in an unchanged native original; absent on older observations. */
  nativeRecord?: NativeRecordReference;
  /** Exact Feature bytes in the retained GeoJSON, as framed by the stream reader at import. */
  sourceRange?: SourceRangeReference;
  sourceCrs: string;
  analysisCrs: string;
  origin: [number, number];
  anchor: [number, number];
  transformVersion: string;
  verticalReference: string;
}
export interface SourceLocator {
  sourceRevisionId: string;
  page?: number;
  row?: number;
  partId?: string;
  featureId?: string;
  jsonPointer?: string;
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
    unit: "normalized";
  };
}
export interface AreaHeight {
  state: EvidenceState | "unknown";
  value: number | null;
  unit: "m";
  meaning: string;
  reference: string;
  originalValue?: unknown;
  originalUnit?: string;
  evidence?: SourceLocator[];
  claimId?: string;
  method?: "native_parse" | "human_entry" | "derived";
}
export interface NormalizedFeature {
  /** Zero-based index in the unchanged original feature collection. */
  sourceFeatureIndex?: number;
  geometryRole?: import("./officer").GeometryRole;
  semantics?: {
    geometryRole?: import("./officer").GeometryRole;
    evidenceState?: EvidenceState;
    levelReference?: string;
    sourceDate?: string;
    validFrom?: string;
    validTo?: string;
    horizontalUncertaintyM?: number;
    approvalStatus?: string;
    floorCount?: number;
    assetId?: string;
  };
  verticalExtent?: {
    lower: number;
    upper: number;
    unit: "m";
    reference: string;
    evidenceState: EvidenceState;
    evidence: SourceLocator[];
  };
  utilityProfile?: Record<string, unknown>;
  sourceKey: string;
  name: string;
  kind: FeatureKind;
  sourceGeometry: object;
  sourceReference?: AreaReference;
  geometry: AreaGeometry;
  geographicGeometry: AreaGeometry;
  height: AreaHeight;
  worldStatus: WorldStatus;
  properties: Record<string, unknown>;
  areaM2: number | null;
}
export interface PhysicalFeature extends NormalizedFeature {
  id: string;
  identifier: string;
  areaId: string;
  revision: number;
  sourceRevisionId: string;
  datasetNamespace: string;
  evidence: SourceLocator[];
  representation: "physical_exterior" | "physical_context";
}
export interface AdministrativeUnit {
  id: string;
  kind:
    | "country"
    | "state"
    | "district"
    | "subdistrict"
    | "development_block"
    | "village"
    | "urban_local_body"
    | "ward"
    | "locality";
  name: string;
  code?: string;
  authority?: string;
  source?: string;
}
export interface MapArea {
  dataKind?: "real" | "demonstration" | "mixed" | "empty";
  featureCount?: number;
  id: string;
  siteId: string;
  name: string;
  revision: number;
  reference: AreaReference | null;
  extent: [number, number, number, number] | null;
  geographicExtent: [number, number, number, number] | null;
  administrativeUnits: AdministrativeUnit[];
}
export interface AreaFinding {
  id: string;
  category: "geometric" | "coverage" | "rule" | "document";
  code: string;
  message: string;
  featureIds: string[];
  areaM2?: number;
  volumeM3?: number;
  geometry?: AreaGeometry;
  geographicGeometry?: AreaGeometry;
  participants?: PhysicalFeature[];
  method?: string;
  inputRevisions?: {
    featureId: string;
    revision: number;
    sourceRevisionId: string;
  }[];
  evidence?: SourceLocator[];
  quantities?: Record<string, number>;
  limitations?: string[];
}
export interface AreaCheck {
  id: string;
  areaId: string;
  areaRevision: number;
  status: "running" | "completed" | "failed";
  findings: AreaFinding[];
  coverage: string[];
  inputFingerprint: string;
  createdAt: string;
  stale?: boolean;
  error?: string;
}
export interface EvidenceQuestion {
  kind?: "missing_height" | "conflicting_claims";
  id: string;
  entityId: string;
  property: string;
  message: string;
  blocks: string;
  answer?: {
    choice: "keep_2d" | "estimate" | "select_claim";
    value?: number;
    reason: string;
    claimId?: string;
  };
}
export interface FactCandidate {
  subject?: string;
  id: string;
  entityId: string;
  property: string;
  value: unknown;
  unit?: string;
  referenceFrameId?: string;
  evidence: SourceLocator[];
  method: "native_parse" | "ai_extraction" | "human_entry" | "derived";
  evidenceState: EvidenceState;
  worldStatus: WorldStatus;
}
export interface DocumentPart {
  id: string;
  sourceRevisionId: string;
  locator: string;
  text: string;
  entityIds: string[];
  copiedFrom?: {
    caseId: string;
    sourceRevisionId: string;
    sourceHash: string;
    sourceRevision: number;
    sourceProfile: string;
    locator: string;
    reason: string;
    copiedAt: string;
    actor: string;
  };
}
export interface ImportPackage {
  quarantine?: import('./gis-quarantine').GisQuarantine;
  /** Explicit source-only intake; never a fabricated physical property. */
  sourceWorkspace?: { caseId: string; frame: import("./index").CoordinateFrame; worldStatus: PhysicalFeature["worldStatus"]; areaReferenceFingerprint: string };
  selectedClaimIds?: string[];
  factDecisions?: {
    claimId: string;
    reason: string;
    time: string;
    actor: string;
  }[];
  id: string;
  schemaVersion: "ulpin-canonical/2";
  areaId: string;
  name: string;
  datasetNamespace: string;
  revision: number;
  state:
    | "RECEIVED"
    | "NEEDS_INPUT"
    | "READY_FOR_REVIEW"
    | "REVIEWED"
    | "COMMITTED";
  sourceRevisionIds: string[];
  features: PhysicalFeature[];
  questions: EvidenceQuestion[];
  factCandidates: FactCandidate[];
  parts: DocumentPart[];
  warnings: string[];
  review?: {
    areaRevision: number;
    packageRevision: number;
    inputFingerprint: string;
    findings: AreaFinding[];
    coverage: string[];
    scope?: {
      validator: "area-check-officer-v2";
      marginMetres: number;
      extent: [number, number, number, number];
      contextCount: number;
      unqualifiedInScope: number;
      areaRevisionAtReview: number;
    };
  };
  createdAt: string;
  acknowledgement?: string;
}
/** Presentation only. Analytical geometry remains on the canonical feature. */
export interface SceneAsset {
  featureId: string;
  featureRevision: number;
  url: string;
  sha256: string;
  frame: string;
  position: [number, number, number];
  heading: number;
  provenance: string;
  purpose: "presentation";
}
export interface AreaContext {
  /** Display-only accepted proposals; analytical readers continue to use features. */
  displayFeatures?: (PhysicalFeature & {displayState?: 'unrecorded_proposal';proposalPackageId?: string})[];
  parcelAssociations?: import("./officer").PropertyAssociation[];
  parcelIdentifiers?: import("./officer").ParcelIdentifier[];
  sceneAssets?: SceneAsset[];
  area: MapArea;
  features: PhysicalFeature[];
  packages: ImportPackage[];
  latestCheck: AreaCheck | null;
}
/** A display feature as the context route sends it: without the geometry and reference no reader reads. */
export type AreaContextFeature = Omit<
  NonNullable<AreaContext["displayFeatures"]>[number], "sourceGeometry" | "geographicGeometry" | "sourceReference"
>;
/** An import package as the context route lists it. */
export interface AreaContextPackage {
  id: string;
  state: ImportPackage["state"];
  quarantine: { message: string; sourceSha256: string } | null;
}
/** The answer of GET /api/v1/areas/{areaId}/context: one feature list and package summaries. */
export interface AreaContextResponse extends Omit<AreaContext, "features" | "displayFeatures" | "packages"> {
  displayFeatures: AreaContextFeature[];
  packages: AreaContextPackage[];
}
