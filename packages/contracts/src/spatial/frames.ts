import type { SpatialFrame, XYZ } from "./types";
/** WGS84 ENU -> ECEF, column-major. This is not an arbitrary CRS/datum transformer. */
export function enuToEcef(frame: SpatialFrame): readonly number[] {
    if (frame.kind !== "engineering" || frame.horizontalUnit !== "m" || frame.axes !== "east-north-up" || frame.verticalUnit !== "m" || !frame.anchor)
        throw new Error("Explicit metre ENU world placement required");
    const { longitude, latitude, ellipsoidHeight: h } = frame.anchor;
    if (![longitude, latitude, h].every(Number.isFinite) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90)
        throw new Error("Invalid world anchor");
    const l = longitude * Math.PI / 180, p = latitude * Math.PI / 180, sl = Math.sin(l), cl = Math.cos(l), sp = Math.sin(p), cp = Math.cos(p);
    const n = 6378137 / Math.sqrt(1 - 0.0066943799901413165 * sp * sp);
    return [-sl, cl, 0, 0, -sp * cl, -sp * sl, cp, 0, cp * cl, cp * sl, sp, 0, (n + h) * cp * cl, (n + h) * cp * sl, (n * (1 - 0.0066943799901413165) + h) * sp, 1];
}
export function transformPoint(matrix: readonly number[], point: XYZ): XYZ {
    if (matrix.length !== 16 || !matrix.every(Number.isFinite))
        throw new Error("Invalid 4x4 transform");
    if (point.length !== 3 || !point.every(Number.isFinite))
        throw new Error("Invalid finite 3D point");
    const [x, y, z] = point, w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    if (Math.abs(w) < 1e-12)
        throw new Error("Point has invalid homogeneous coordinate");
    return [(matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w, (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w, (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w];
}
