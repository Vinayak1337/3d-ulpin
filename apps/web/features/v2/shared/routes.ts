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
  home: "/v2",
  block: (areaId?: string | null, buildingId?: string | null) =>
    areaId
      ? withQuery(`/v2/blocks/${segment(areaId)}`, { feature: buildingId })
      : "/v2",
  register: (buildingId?: string | null, areaId?: string | null) =>
    buildingId
      ? withQuery(`/v2/properties/${segment(buildingId)}/register`, {
          area: areaId,
        })
      : "/v2/register",
  workspace: (buildingId?: string | null, areaId?: string | null) =>
    buildingId
      ? withQuery(`/v2/properties/${segment(buildingId)}/workspace`, {
          area: areaId,
        })
      : "/v2/workspace",
  source: (sourceId: string) => `/api/v1/sources/${segment(sourceId)}/file`,
  legacy: "/legacy",
};
