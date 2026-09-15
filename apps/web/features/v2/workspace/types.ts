import type { AreaGeometry, DocumentPart, Point2 } from "@ulpin/contracts";

export type WorkspaceMode = "measure" | "calibrate" | "compare" | "build";
export type MeasureTool =
  | "pan"
  | "distance"
  | "area"
  | "perimeter"
  | "angle"
  | "height"
  | "point";
export type CanvasSource = {
  id: string;
  name: string;
  hash: string;
  url?: string;
  kind: "image" | "pdf" | "geometry" | "text";
  status?: string;
  frame?: string;
  geometry?: AreaGeometry;
  parts: DocumentPart[];
  originalKind?: "image" | "pdf" | "text";
};
export type Calibration = {
  sourceId: string;
  sourceHash: string;
  page: number;
  imagePoints: [Point2, Point2];
  worldPoints: [Point2, Point2];
  metresPerUnit: number;
  method: "known_distance" | "control_points";
  frame?: string;
  reason: string;
  savedAt: string;
};
export type Measurement = {
  id: string;
  sourceId: string;
  sourceHash: string;
  page: number;
  tool: Exclude<MeasureTool, "pan">;
  points: Point2[];
  value: number | null;
  unit: "m" | "m²" | "°" | "point";
  label: string;
  reference?: string;
  calibration?: Calibration;
  noted: boolean;
  createdAt: string;
};
