export type Point2 = [number, number];
export interface CoordinateFrame {
  id: string;
  horizontalUnit: "m";
  verticalUnit: "m";
  benchmark: string;
}
export type SourceProfile =
  | "parcel-local-json-v1"
  | "levels-csv-v1"
  | "control-csv-v1"
  | "plan-png-v1"
  | "plan-pdf-v1";
export interface Issue {
  code: string;
  message: string;
  field?: string;
  severity: "error" | "warning" | "info";
}
export interface SourceBinding {
  sourceId: string;
  locator: string;
}
export interface EvidenceBindings {
  footprint?: SourceBinding;
  lower?: SourceBinding;
  upper?: SourceBinding;
  alignment?: SourceBinding;
}
export interface PlanCalibration {
  sourceId: string;
  page: number;
  imagePoints: [Point2, Point2];
  worldPoints: [Point2, Point2];
}
export type UnitKind = "unit" | "common" | "basement";
export interface UnitSpec {
  id: string;
  alias: string;
  name: string;
  kind: UnitKind;
  footprint: Point2[];
  lower: number | null;
  upper: number | null;
  lowerVerified: boolean;
  upperVerified: boolean;
  bindings: EvidenceBindings;
  revision: number;
  levelLabel: string;
  calibration?: PlanCalibration;
}
export interface ComputedUnit extends UnitSpec {
  lower: number;
  upper: number;
  area: number;
  height: number;
  volume: number;
}
export interface ContextFeature {
  alias: string;
  kind: "parcel" | "building";
  footprint: Point2[];
  name?: string;
}
export interface OverlapRegion {
  footprint: Point2[];
  lower: number;
  upper: number;
  volume: number;
}
export interface Finding {
  id: string;
  code: string;
  severity: "error" | "warning" | "info";
  title: string;
  description: string;
  unitIds: string[];
  sourceIds: string[];
  overlap?: OverlapRegion;
}
export interface ModelSnapshot {
  id: string;
  caseId: string;
  revision: number;
  frame: CoordinateFrame;
  units: ComputedUnit[];
  context: ContextFeature[];
  findings: Finding[];
  inputFingerprint: string;
  createdAt: string;
  method: string;
}
export interface SpatialFeature {
  alias: string;
  name: string;
  kind: UnitKind | "parcel" | "building";
  footprint: Point2[];
  levelLabel?: string;
  draftLower?: number;
  draftUpper?: number;
}
export interface LevelRow {
  alias: string;
  lower: number | null;
  upper: number | null;
  benchmark: string;
  unit: "m";
  method: string;
  locator: string;
}
export interface ControlPoint {
  id: string;
  x: number;
  y: number;
  benchmark: string;
  locator: string;
}
export interface InspectionResult {
  profile: SourceProfile;
  status: "ready" | "needs_input" | "failed";
  issues: Issue[];
  summary: string;
  frame?: CoordinateFrame;
  features?: SpatialFeature[];
  levels?: LevelRow[];
  controls?: ControlPoint[];
  image?: { width: number; height: number; pages?: number };
}
export interface SourceRevision {
  id: string;
  caseId: string;
  familyId: string;
  revision: number;
  name: string;
  profile: SourceProfile;
  mimeType: string;
  bytes: number;
  sha256: string;
  status: "received" | "processing" | "ready" | "needs_input" | "failed";
  createdAt: string;
  inspection: InspectionResult | null;
}
export interface CaseRecord {
  id: string;
  archived: boolean;
  name: string;
  description: string;
  frame: CoordinateFrame;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface ProcessingJob {
  id: string;
  caseId: string;
  sourceId: string | null;
  operation: "inspect" | "build";
  status: "queued" | "running" | "succeeded" | "failed" | "stale";
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  inputFingerprint: string;
}
export interface CaseDetail {
  identity: PropertyIdentity;
  case: CaseRecord;
  sources: SourceRevision[];
  units: UnitSpec[];
  model: ModelSnapshot | null;
  jobs: ProcessingJob[];
  context: ContextFeature[];
  history: { id: string; kind: string; message: string; createdAt: string }[];
}
export interface PropertyIdentity {
  rootId: string;
  status: "prototype";
  scope: "property-workspace";
  floors: { id: string; code: string; label: string; parentId: string }[];
  spaces: {
    id: string;
    code: string;
    unitId: string;
    parentId: string;
    path: string;
  }[];
}
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}
export interface BuildInput {
  frame: CoordinateFrame;
  units: UnitSpec[];
  context: ContextFeature[];
  inputFingerprint: string;
}
export interface BuildResult {
  frame: CoordinateFrame;
  units: ComputedUnit[];
  context: ContextFeature[];
  findings: Finding[];
  inputFingerprint: string;
  method: string;
}
