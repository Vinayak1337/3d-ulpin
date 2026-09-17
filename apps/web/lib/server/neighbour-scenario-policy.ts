import type { PhysicalFeature, WorldStatus } from "@ulpin/contracts";

/** Invented scenarios must not auto-join real-world observations merely because
 * they reuse the same coordinates. Explicit group/parcel links remain opt-in.
 */
export function usesGeographicNeighbours(
  features: Pick<PhysicalFeature, "worldStatus">[],
): boolean {
  return features.some((feature) =>
    feature.worldStatus === "observed" || feature.worldStatus === "planned",
  );
}

export function automaticNeighbourAllowed(
  features: Pick<PhysicalFeature, "worldStatus">[],
  neighbourStatus: WorldStatus,
): boolean {
  return usesGeographicNeighbours(features) &&
    (neighbourStatus === "observed" || neighbourStatus === "planned");
}
