import type { AreaGeometry, PhysicalFeature } from "@ulpin/contracts";
export const geometryParts = (geometry: AreaGeometry): AreaGeometry[] =>
  geometry.type === "GeometryCollection"
    ? geometry.geometries.flatMap(geometryParts)
    : [geometry];
export function utilityScene(feature: PhysicalFeature) {
  const profile = feature.utilityProfile as
    | {
        unresolved?: string[];
        crossSection?: {
          shape: string;
          diameterM?: number;
          widthM?: number;
          heightM?: number;
        };
        resolved?: {
          positions: number[][];
          verticalReference: string;
          method: string;
          checkSupport: string;
          limitation?: string;
          solidMeaning?: string;
        };
      }
    | undefined;
  const resolved = profile?.resolved,
    section = profile?.crossSection,
    geographic = feature.geographicGeometry;
  if (
    !resolved ||
    !section ||
    profile?.unresolved?.length ||
    geographic.type !== "LineString" ||
    resolved.positions.length !== geographic.coordinates.length ||
    !resolved.positions.every(
      (point) => point.length === 3 && point.every(Number.isFinite),
    )
  )
    return null;
  const width =
      section.shape === "circular" ? section.diameterM : section.widthM,
    height = section.shape === "circular" ? section.diameterM : section.heightM;
  if (
    !width ||
    !height ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return null;
  return {
    ...resolved,
    width,
    height,
    shape: section.shape,
    geographicPositions: geographic.coordinates.map((point, index) => [
      point[0],
      point[1],
      resolved.positions[index][2],
    ]),
  };
}
