import type { PhysicalFeature } from "@ulpin/contracts";
import { routes } from "./routes";

export type ResolveMatch = {
  kind: string;
  feature?: PhysicalFeature;
  record?: { id: string; name?: string; identifier?: string };
  site?: { id: string; name?: string; identifier?: string };
  areaIds: string[];
  buildingId?: string;
  canonicalBuildingId?: string;
  relatedBuildings?: { feature?: PhysicalFeature; id?: string }[];
};
export type SearchTarget = {
  id?: string;
  kind: "building" | "feature" | "area";
  areaId: string;
  name: string;
  identifier: string;
  recordId?: string;
  recordName?: string;
};
export type VerifiedMembership = {
  areaId: string;
  featureIds: readonly string[];
};

/** The match-level area list may cover several parents; it cannot pair an arbitrary parent with a block. */
export function searchTargets(
  match: ResolveMatch,
  selectedArea?: string | null,
  membership?: VerifiedMembership,
): SearchTarget[] {
  const areaFor = (id: string, owner?: string): string | undefined => {
    if (
      selectedArea &&
      membership?.areaId === selectedArea &&
      membership.featureIds.includes(id)
    )
      return selectedArea;
    if (owner) return owner;
    return match.areaIds.length === 1 ? match.areaIds[0] : undefined;
  };
  const targetFor = (
    feature: PhysicalFeature,
    record = false,
  ): SearchTarget | undefined => {
    const areaId = areaFor(feature.id, feature.areaId);
    if (!areaId) return;
    return {
      id: feature.id,
      areaId,
      kind: feature.kind === "building" ? "building" : "feature",
      name: feature.name,
      identifier: feature.identifier,
      ...(record && match.record
        ? {
            recordId: match.record.id,
            recordName: match.record.name || match.record.identifier,
          }
        : {}),
    };
  };
  // A parcel/utility search selects that feature. Its spatial neighbours are not asserted as owners.
  if (match.kind === "physical_feature" && match.feature) {
    const target = targetFor(match.feature, !!match.record);
    return target ? [target] : [];
  }
  const parents = new Map<string, PhysicalFeature>();
  for (const feature of [
    match.feature,
    ...(match.relatedBuildings || []).map((item) => item.feature),
  ])
    if (feature?.kind === "building") parents.set(feature.id, feature);
  const targets = [...parents.values()]
    .map((feature) => targetFor(feature, true))
    .filter((target): target is SearchTarget => !!target);
  if (targets.length) return targets;
  const explicitBuildingId = match.canonicalBuildingId || match.buildingId;
  if (explicitBuildingId) {
    const areaId = areaFor(explicitBuildingId);
    if (areaId)
      return [
        {
          id: explicitBuildingId,
          areaId,
          kind: "building",
          name: "Linked property",
          identifier: explicitBuildingId,
          ...(match.record
            ? {
                recordId: match.record.id,
                recordName: match.record.name || match.record.identifier,
              }
            : {}),
        },
      ];
  }
  if (match.kind === "site" && match.areaIds.length === 1)
    return [
      {
        kind: "area",
        areaId: match.areaIds[0],
        name: match.site?.name || "Loaded block",
        identifier: match.site?.identifier || match.areaIds[0],
      },
    ];
  return [];
}

export function searchTargetRoute(
  target: SearchTarget,
  family: "block" | "register" | "workspace",
) {
  const route =
    target.kind !== "building" || family === "block"
      ? routes.block(target.areaId, target.id)
      : family === "workspace"
        ? routes.workspace(target.id, target.areaId)
        : routes.register(target.id, target.areaId);
  return target.recordId
    ? `${route}${route.includes("?") ? "&" : "?"}record=${encodeURIComponent(target.recordId)}`
    : route;
}
