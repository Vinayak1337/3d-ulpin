import type {
  AreaGeometry,
  AreaFinding,
  MapArea,
  PhysicalFeature,
  SourceLocator,
  EvidenceState,
  WorldStatus,
  ImportPackage,
} from "./area";
import type { ProcessingJob } from "./index";
import type { RegistryReview } from "./registry";
import type { RegistryRecord } from "./registry";

export type GeometryRole =
  | "unknown"
  | "observed_ground_occupation"
  | "observed_roof_projection"
  | "approved_building_outline"
  | "recorded_parcel"
  | "public_road_land"
  | "road_surface"
  | "public_land"
  | "physical_utility"
  | "documented_restriction";
export interface PropertyAssociation {
  id: string;
  revision: number;
  fromId: string;
  toId: string;
  relationship:
    | "occupies_parcel"
    | "representation_of"
    | "detailed_record"
    | "shared_space";
  status: "suggested" | "confirmed" | "rejected";
  evidence: SourceLocator[];
  reason: string;
  actor: string;
  updatedAt: string;
  fromRevision: number;
  toRevision: number;
}
export interface BlockGroup {
  id: string;
  areaId: string;
  name: string;
  revision?: number;
  kind:
    | "analysis_extent"
    | "layout_block"
    | "development_block"
    | "ward"
    | "locality";
  boundary: AreaGeometry;
  geographicBoundary: AreaGeometry;
  authority?: string;
  code?: string;
  evidence: SourceLocator[];
  featureIds: string[];
}
export interface PlacementTransform {
  id: string;
  revision: number;
  sourceFrame: string;
  targetFrame: string;
  method: "canonical_area" | "control_points_similarity";
  matrix: [number, number, number, number, number, number];
  verticalReference: string;
  verticalOffset: number | null;
  sourceVerticalReference?: string;
  evidence: SourceLocator[];
  status: "unresolved" | "reviewed";
  controlPoints?: { source: [number, number]; target: [number, number] }[];
}
export interface PreparationCase {
  id: string;
  buildingId: string;
  areaId: string;
  caseId: string;
  packageId: string;
  revision: number;
  buildingRevision: number;
  placement: PlacementTransform;
  url: string;
  returnUrl: string;
}
/** Persisted preparation state, verified against the current retained build inputs. */
export interface PreparationContinuation {
  packageRevision: number;
  preparationRevision: number;
  caseRevision: number;
  status: "needs_build" | "retry_build" | "processing" | "ready" | "reviewed" | "recorded";
  spaceCount: number;
  job: ProcessingJob | null;
  review: RegistryReview | null;
}
export interface DossierSource {
  id: string;
  name: string;
  sha256: string;
  revision: number;
  profile: string;
  createdAt: string;
  url: string;
  evidence: SourceLocator[];
}
export interface DetailedSceneRecord {
  record: RegistryRecord;
  geographicGeometry?: AreaGeometry;
  localGeometry?: AreaGeometry;
  lower?: number;
  upper?: number;
  verticalReference?: string;
}
export interface EvidenceRequest {
  id: string;
  question: string;
  status: "OPEN" | "ANSWERED";
  response?: string;
  evidence: SourceLocator[];
  createdAt: string;
  answeredAt?: string;
}
export interface Investigation {
  id: string;
  revision: number;
  buildingId: string;
  areaId: string;
  reference: string;
  status:
    | "OPEN"
    | "NEEDS_EVIDENCE"
    | "READY_FOR_REVIEW"
    | "REVIEWED"
    | "CLOSED";
  classification: string;
  notes: string;
  nextAction: string;
  inputSnapshot: {
    areaRevision: number;
    featureRevision: number;
    checkId?: string;
    fingerprint: string;
  };
  registerSnapshot?: Pick<
    BuildingDossier,
    | "building"
    | "area"
    | "records"
    | "detailedScene"
    | "sources"
    | "associations"
    | "parcels"
    | "parcelIdentifiers"
    | "missing"
  >;
  findings: AreaFinding[];
  evidence: SourceLocator[];
  requests: EvidenceRequest[];
  history: { actor: string; time: string; reason: string; status: string }[];
  createdAt: string;
  updatedAt: string;
}
export interface ParcelIdentifier {
  parcelId: string;
  scheme: string;
  value: string;
  issuer: string;
  evidence: { sourceRevisionId?: string; locator?: string };
}
export interface BuildingDossier {
  parcelIdentifiers?: ParcelIdentifier[];
  check?: { id: string; areaRevision: number; stale: boolean };
  building: PhysicalFeature;
  canonicalBuildingId: string;
  area: MapArea;
  representations: PhysicalFeature[];
  associations: PropertyAssociation[];
  parcels: {
    feature: PhysicalFeature;
    association?: PropertyAssociation;
    status: "confirmed" | "suggested";
  }[];
  groups: BlockGroup[];
  records: RegistryRecord[];
  detailedScene: DetailedSceneRecord[];
  sources: DossierSource[];
  preparations: PreparationCase[];
  packages: ImportPackage[];
  issues: AreaFinding[];
  investigations: Investigation[];
  missing: string[];
  revisions: { feature: number; area: number; registry: number };
}
export type CanonicalFactProperty =
  | "outline.geometry"
  | "outline.role"
  | "placement.controls"
  | "building.floorCount"
  | "building.exteriorHeight"
  | "space.geometry"
  | "space.lower"
  | "space.upper"
  | "space.label"
  | "space.levelLabel"
  | "utility.profile"
  | "source.date"
  | "source.status";
export interface PreparationFact {
  id: string;
  entityId: string;
  subject: string;
  property: CanonicalFactProperty;
  value: unknown;
  unit?: string;
  referenceFrameId?: string;
  evidence: SourceLocator[];
  evidenceState: EvidenceState;
  worldStatus: WorldStatus;
  method: "native_parse" | "ai_extraction" | "human_entry" | "derived";
}
export interface PreparationRequirements {
  footprint: string[];
  exterior: string[];
  detailedSpaces: string[];
  placement: string[];
  utility: string[];
}
