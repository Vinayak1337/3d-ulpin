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
  home: "/blocks",
  block: (areaId?: string | null, buildingId?: string | null) =>
    areaId
      ? withQuery(`/blocks/${segment(areaId)}`, { feature: buildingId })
      : "/blocks",
  register: (buildingId?: string | null, areaId?: string | null) =>
    buildingId
      ? withQuery(`/properties/${segment(buildingId)}/register`, {
          area: areaId,
        })
      : "/register",
  workspace: (buildingId?: string | null, areaId?: string | null) =>
    buildingId
      ? withQuery(`/properties/${segment(buildingId)}/workspace`, {
          area: areaId,
        })
      : "/workspace",
  source: (sourceId: string) => `/api/v1/sources/${segment(sourceId)}/file`,
  case: (caseId: string) => `/workspace/${segment(caseId)}`,
};
