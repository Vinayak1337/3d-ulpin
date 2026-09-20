import type { AreaGeometry, ImportPackage } from "./area";
import type { Point2 } from "./index";

/** Model pixels are suggestions. Metre geometry requires a separately reviewed transform. */
export type SpatialMlTask = "floor-plan" | "building";
export type SpatialMlState =
  | "queued"
  | "running"
  | "succeeded"
  | "empty"
  | "failed"
  | "blocked"
  | "cancelled";
export interface SpatialMlModel {
  id: string;
  task: SpatialMlTask;
  sha256: string;
  profileVersion: string;
  name: string;
  license: string;
  ready: boolean;
  reason?: string;
  evaluation?: string;
}
export interface SpatialMlStatus {
  models: SpatialMlModel[];
  maxBatchItems: number;
}
export interface SpatialMlCalibration {
  rasterSha256: string;
  imagePoints: [Point2, Point2];
  worldPoints: [Point2, Point2];
  frame: string;
  reason: string;
}
export interface SpatialMlSelection {
  componentId: string;
  subject: string;
}
export interface SpatialMlComponent {
  id: string;
  className: string;
  /** Model score, not survey accuracy or probability of legal correctness. */
  score: number;
  /** Coordinates on the retained upright raster, x right and y down, in pixels. */
  geometry: Extract<AreaGeometry, { type: "Polygon" | "MultiPolygon" }>;
}
export interface SpatialMlResult {
  model: { id: string; sha256: string };
  raster: { sha256: string; width: number; height: number; url: string };
  mask: { sha256: string; width: number; height: number; url: string };
  components: SpatialMlComponent[];
  receipt: Record<string, unknown>;
}
export interface SpatialMlApplication {
  requestKey: string;
  inputFingerprint: string;
  calibration: SpatialMlCalibration;
  entityId: string;
  selections: SpatialMlSelection[];
  property: "space.geometry" | "outline.geometry";
  factIds: string[];
  packageRevision: number;
  appliedAt: string;
}
export interface SpatialMlItem {
  id: string;
  batchId: string;
  packageId: string;
  sourceRevisionId: string;
  sourceSha256: string;
  partId: string;
  page: number;
  task: SpatialMlTask;
  modelId: string;
  modelSha256: string;
  inputFingerprint: string;
  state: SpatialMlState;
  currentJobId: string;
  attempts: {
    jobId: string;
    state: SpatialMlState;
    createdAt: string;
    completedAt?: string;
    error?: string;
    errorCode?: string;
  }[];
  result?: SpatialMlResult;
  applications: SpatialMlApplication[];
  /** Read-only controls from an exact matching retained footprint receipt. */
  retainedFootprintCalibration?: SpatialMlCalibration;
  footprintDrafts?: {
    packageId: string;
    inputFingerprint: string;
    createdAt: string;
  }[];
  createdAt: string;
  updatedAt: string;
}
export interface SpatialMlBatch {
  id: string;
  packageId: string;
  requestKey: string;
  createdAt: string;
  items: SpatialMlItem[];
}
export interface SpatialMlBatchRequest {
  packageId: string;
  expectedRevision: number;
  requestKey: string;
  items: {
    sourceRevisionId: string;
    partId: string;
    page: number;
    task: SpatialMlTask;
    modelId?: string;
  }[];
}
export interface SpatialMlApplyRequest {
  expectedRevision: number;
  requestKey: string;
  entityId: string;
  selections: SpatialMlSelection[];
  property: "space.geometry" | "outline.geometry";
  calibration: SpatialMlCalibration;
}
export interface SpatialMlApplyResponse {
  package: ImportPackage;
  item: SpatialMlItem;
}
