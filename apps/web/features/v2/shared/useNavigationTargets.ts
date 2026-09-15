"use client";
import type { AreaContext, BuildingDossier } from "@ulpin/contracts";
import { useResource } from "./hooks";
import {
  navigationRequest,
  validatedNavigationTargets,
} from "./navigation-targets";

export function useNavigationTargets(
  ...input: Parameters<typeof navigationRequest>
) {
  const request = navigationRequest(...input);
  const dossier = useResource<BuildingDossier>(
    request.candidateId
      ? `/buildings/${encodeURIComponent(request.candidateId)}/dossier`
      : null,
  );
  const canonicalOwner =
    dossier.data?.canonicalBuildingId === request.candidateId &&
    dossier.data.building.id === request.candidateId &&
    dossier.data.building.kind === "building"
      ? dossier.data.area.id
      : null;
  const context = useResource<AreaContext>(
    request.requestedAreaId && request.requestedAreaId !== canonicalOwner
      ? `/areas/${encodeURIComponent(request.requestedAreaId)}/context`
      : null,
  );
  return validatedNavigationTargets(request, {
    dossier: dossier.data,
    context: context.data,
  });
}
