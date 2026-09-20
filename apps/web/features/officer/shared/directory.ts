import type { MapArea } from "@ulpin/contracts";

export function datasetLabel(kind?: MapArea["dataKind"]): string {
  if (kind === "demonstration") return "Fictional demonstration";
  if (kind === "real") return "Real sources";
  if (kind === "mixed") return "Mixed real and fictional sources";
  if (kind === "empty") return "No mapped sources yet";
  return "Source status unclassified";
}
export function filterAreas(areas: MapArea[], query: string, kind: string): MapArea[] {
  const needle = query.trim().toLocaleLowerCase();
  return areas.filter(area =>
    (kind === "all" || (kind === "saved" ? area.dataKind !== "demonstration" && (area.featureCount ?? 0) > 0 : area.dataKind === kind)) &&
    `${area.name} ${area.id}`.toLocaleLowerCase().includes(needle),
  ).sort((a,b) => a.name.localeCompare(b.name));
}
export interface WorkspaceSummary {
  id: string; name: string; propertyName?: string; buildingId?: string; areaId?: string;
  updatedAt: string; sourceCount: number;
}
export function filterWorkspaces(cases: WorkspaceSummary[], query: string, status: string): WorkspaceSummary[] {
  const needle = query.trim().toLocaleLowerCase();
  return cases.filter(item =>
    (status === "all" || (status === "linked" ? !!item.buildingId : !item.buildingId)) &&
    `${item.name} ${item.propertyName ?? ""} ${item.id} ${item.buildingId ?? ""}`.toLocaleLowerCase().includes(needle),
  ).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
