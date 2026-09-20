/** UI routes only. Source identifiers and API URLs are never rewritten. */
const segment = (value: string) => encodeURIComponent(value);
export function withQuery(
  path: string,
  values: Record<string, string | null | undefined>,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value) query.set(key, value);
  return `${path}${query.size ? `?${query}` : ""}`;
}
export const routes = {
  addFiles: (areaId?: string | null, buildingId?: string | null, caseId?: string | null) => withQuery("/studio/add-files", {area: areaId, building: buildingId, case: caseId}),
  home: "/studio/work",
  block: (areaId?: string | null, buildingId?: string | null) =>
    areaId
      ? withQuery(`/studio/areas/${segment(areaId)}`, { feature: buildingId })
      : "/studio/datasets",
  register: (buildingId?: string | null, areaId?: string | null) =>
    buildingId
      ? withQuery(`/studio/properties/${segment(buildingId)}/register`, {
          area: areaId,
        })
      : "/studio/registry",
  workspace: (buildingId?: string | null, areaId?: string | null) =>
    buildingId
      ? withQuery(`/studio/properties/${segment(buildingId)}/workspace`, {
          area: areaId,
        })
      : "/studio/workspaces",
  source: (sourceId: string) => `/api/v1/sources/${segment(sourceId)}/file`,
  case: (caseId: string) => `/studio/cases/${segment(caseId)}`,
};
