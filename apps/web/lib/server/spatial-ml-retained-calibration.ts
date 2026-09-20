import { z } from "zod";
import type { AreaReference, CoordinateFrame, ImportPackage, SpatialMlCalibration, SpatialMlItem } from "@ulpin/contracts";
import { fingerprint } from "./domain";

const point = z.tuple([z.number().finite(), z.number().finite()]);
const calibrationSchema = z.object({
  rasterSha256: z.string(), imagePoints: z.tuple([point, point]), worldPoints: z.tuple([point, point]),
  frame: z.string().min(1), reason: z.string().min(3),
});
type Receipt = {
  itemId?: string; jobId?: string; inferenceFingerprint?: string; originalSourceRevisionId?: string;
  originalSha256?: string; originalPartId?: string; page?: number; rasterSha256?: string;
  calibration?: unknown; model?: {id: string; sha256: string};
  sourceWorkspace?: ImportPackage["sourceWorkspace"];
  target?: {areaId?: string; frame?: string; coordinateFrame?: CoordinateFrame; areaReferenceFingerprint?: string};
};
/** Read-only reuse: never upgrade controls from another raster, source part or metric reference. */
export function retainedFootprintCalibration(
  item: SpatialMlItem, receipt: Receipt | null, pkg: ImportPackage,
  current: {frame: CoordinateFrame; reference: AreaReference | null; sourceSha256: string; sourcePartHash: string},
): SpatialMlCalibration | undefined {
  const raster = item.result?.raster;
  if (item.task !== "building" || item.state !== "succeeded" || !raster || !receipt) return;
  const parsed = calibrationSchema.safeParse(receipt.calibration);
  if (!parsed.success) return;
  const calibration = parsed.data;
  const part = pkg.parts.find(part => part.id === item.partId && part.sourceRevisionId === item.sourceRevisionId);
  if (pkg.id !== item.packageId || !pkg.sourceRevisionIds.includes(item.sourceRevisionId) || !part || fingerprint(part) !== current.sourcePartHash) return;
  if (receipt.itemId !== item.id || receipt.jobId !== item.currentJobId || receipt.inferenceFingerprint !== item.inputFingerprint ||
    receipt.originalSourceRevisionId !== item.sourceRevisionId || receipt.originalSha256 !== item.sourceSha256 ||
    current.sourceSha256 !== item.sourceSha256 || receipt.originalPartId !== item.partId || receipt.page !== item.page ||
    receipt.model?.id !== item.result?.model.id || receipt.model?.sha256 !== item.result?.model.sha256 ||
    receipt.rasterSha256 !== raster.sha256 || calibration.rasterSha256 !== raster.sha256) return;
  const retainedFrame = receipt.target?.coordinateFrame || receipt.sourceWorkspace?.frame;
  const retainedReference = receipt.target?.areaReferenceFingerprint || receipt.sourceWorkspace?.areaReferenceFingerprint;
  if (!retainedFrame || !retainedReference || !current.reference || receipt.target?.areaId !== pkg.areaId ||
    receipt.target.frame !== current.frame.id || calibration.frame !== current.frame.id ||
    fingerprint(retainedFrame) !== fingerprint(current.frame) || retainedReference !== fingerprint(current.reference)) return;
  if (pkg.sourceWorkspace && (fingerprint(pkg.sourceWorkspace.frame) !== fingerprint(current.frame) || pkg.sourceWorkspace.areaReferenceFingerprint !== fingerprint(current.reference))) return;
  if (calibration.imagePoints.some(([x,y]) => x < 0 || y < 0 || x > raster.width || y > raster.height)) return;
  const distinct = (points: SpatialMlCalibration["imagePoints"]) => Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]) > 0;
  if (!distinct(calibration.imagePoints) || !distinct(calibration.worldPoints)) return;
  return calibration;
}
