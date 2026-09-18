import { calibrationSnapshot, type CalibrationKind } from "./calibration";
import { compileSpatialSnapshot, type CompiledPublication } from "../compiler/compile";
import type { SpatialSnapshot } from "@ulpin/contracts";
// Only these two immutable, public, synthetic calibration fixtures are cached here.
// This must NOT be reused as a user-data or whole-world repository.
const calibrationCache = new Map<CalibrationKind, {
    snapshot: SpatialSnapshot;
    publication: CompiledPublication;
}>();
export function calibrationPublication(kind: CalibrationKind) {
    let result = calibrationCache.get(kind);
    if (!result) {
        const snapshot = calibrationSnapshot(kind);
        result = { snapshot, publication: compileSpatialSnapshot(snapshot, `/api/v1/spatial/calibration/${kind}`) };
        calibrationCache.set(kind, result);
    }
    return result;
}
