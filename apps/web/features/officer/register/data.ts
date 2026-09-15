"use client";
import { useResource } from "../shared/hooks";
export interface PropertySummary {
  buildingId: string;
  spaces: number;
  floors: number;
}
/** One bounded summary query; opening a property fetches its full evidence dossier. */
export function useRegisterDirectory(areaId?: string) {
  return useResource<PropertySummary[]>(
    areaId ? `/property-directory?area=${encodeURIComponent(areaId)}` : null,
  );
}
