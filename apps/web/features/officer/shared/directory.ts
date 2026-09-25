import type { MapArea } from "@ulpin/contracts";
import { areaClassification } from '@/lib/ui/provenance';

export function datasetLabel(kind?: MapArea["dataKind"]): string {
  return kind ? areaClassification({ dataKind: kind }) : 'Source status unclassified';
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
