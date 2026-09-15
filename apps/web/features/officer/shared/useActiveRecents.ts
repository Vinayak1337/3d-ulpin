"use client";
import type { MapArea } from "@ulpin/contracts";
import { useResource } from "./hooks";
import { useOfficerStore } from "./store";
/** Archived blocks remain recoverable by URL but leave active navigation. */
export function useActiveRecents(enabled = true) {
  const saved = useOfficerStore((s) => s.recentProperties);
  const areas = useResource<MapArea[]>(enabled ? "/areas" : null);
  const active = new Set((areas.data || []).map((a) => a.id));
  return saved.filter((item) => active.has(item.areaId));
}
