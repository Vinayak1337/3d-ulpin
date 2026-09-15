import type { AreaContext, BuildingDossier } from "@ulpin/contracts";
import { routes } from "./routes";

type NavigationQuery = { get(name: string): string | null };
export type NavigationRequest = {
  kind: "property" | "block" | "other";
  candidateId: string | null;
  requestedAreaId: string | null;
  recordId: string | null;
};
export type NavigationEvidence = {
  dossier?: Pick<
    BuildingDossier,
    "canonicalBuildingId" | "building" | "area" | "records"
  > | null;
  context?: Pick<AreaContext, "area" | "features"> | null;
};
function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value) || null;
  } catch {
    return null;
  }
}
export function navigationRequest(
  pathname: string,
  query: NavigationQuery,
  stored: { areaId: string | null; buildingId: string | null },
): NavigationRequest {
  const property = pathname.match(
    /^\/v2\/properties\/([^/]+)\/(?:register|workspace)\/?$/,
  );
  const block = pathname.match(/^\/v2\/blocks\/([^/]+)\/?$/);
  if (property)
    return {
      kind: "property",
      candidateId: decodeSegment(property[1]),
      requestedAreaId: query.get("area") || query.get("areaId"),
      recordId: query.get("record"),
    };
  if (block)
    return {
      kind: "block",
      candidateId: query.get("feature"),
      requestedAreaId: decodeSegment(block[1]),
      recordId: query.get("record"),
    };
  return {
    kind: "other",
    candidateId: stored.buildingId,
    requestedAreaId: stored.areaId,
    recordId: null,
  };
}

/** Neither a query parameter nor retained browser state establishes area membership. */
export function validatedNavigationTargets(
  request: NavigationRequest,
  evidence: NavigationEvidence,
) {
  const { candidateId, requestedAreaId } = request;
  const dossier =
    candidateId &&
    evidence.dossier?.canonicalBuildingId === candidateId &&
    evidence.dossier.building.id === candidateId &&
    evidence.dossier.building.kind === "building"
      ? evidence.dossier
      : null;
  const context =
    requestedAreaId && evidence.context?.area.id === requestedAreaId
      ? evidence.context
      : null;
  const member = context?.features.find(
    (feature) => feature.id === candidateId,
  );
  const buildingId =
    dossier?.canonicalBuildingId ||
    (member
      ? member.kind === "building"
        ? member.id
        : null
      : request.kind === "property"
        ? candidateId
        : null);
  const areaId = member
    ? context!.area.id
    : dossier?.area.id || (!candidateId ? context?.area.id : null) || null;
  const featureId =
    member?.id || (dossier ? dossier.canonicalBuildingId : null);
  const recordId = dossier?.records.some(
    (record) => record.id === request.recordId,
  )
    ? request.recordId
    : null;
  const withRecord = (route: string) =>
    recordId
      ? `${route}${route.includes("?") ? "&" : "?"}record=${encodeURIComponent(recordId)}`
      : route;
  return {
    buildingId,
    areaId,
    featureId,
    recordId,
    block: withRecord(routes.block(areaId, featureId)),
    register: withRecord(routes.register(buildingId, areaId)),
    workspace: withRecord(routes.workspace(buildingId, areaId)),
  };
}
