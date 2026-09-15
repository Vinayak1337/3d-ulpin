"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  AreaContext,
  BuildingDossier,
  PhysicalFeature,
} from "@ulpin/contracts";
import type {
  AreaNavigation,
  SceneDetail,
  SceneBoundary,
} from "@/components/AreaViewer";
import { useResource } from "../shared/hooks";
import { defaultMapPreferences, useV2Store } from "../shared/store";
export function useBlock(areaId: string) {
  const context = useResource<AreaContext>(`/areas/${areaId}/context`);
  const query = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const selectedId = query.get("feature");
  const findingId = query.get("findingId");
  const finding = context.data?.latestCheck?.stale
    ? null
    : context.data?.latestCheck?.findings.find((f) => f.id === findingId) ||
      null;
  const features = useMemo(() => {
    const list = context.data?.features || [];
    return [
      ...list,
      ...(finding?.participants || []).filter(
        (p) => !list.some((f) => f.id === p.id),
      ),
    ];
  }, [context.data, finding]);
  const selected = features.find((f) => f.id === selectedId) || null;
  const dossier = useResource<BuildingDossier>(
    selected?.kind === "building" ? `/buildings/${selected.id}/dossier` : null,
  );
  const preferences = useV2Store(
      (s) => s.mapPreferences[areaId] || defaultMapPreferences,
    ),
    setPreferences = useV2Store((s) => s.setMapPreferences),
    selectBlock = useV2Store((s) => s.selectBlock),
    selectProperty = useV2Store((s) => s.selectProperty),
    clearSelection = useV2Store((s) => s.clearSelection);
  const [navigation, setNavigation] = useState<AreaNavigation>({
    action: "fit",
    sequence: 0,
  });
  const navigate = useCallback(
    (action: AreaNavigation["action"]) =>
      setNavigation((old) => ({ action, sequence: old.sequence + 1 })),
    [],
  );
  useEffect(() => {
    if (context.data) selectBlock(areaId, context.data.area.name);
  }, [context.data, areaId, selectBlock]);
  useEffect(() => {
    if (selected?.kind === "building")
      selectProperty({
        areaId,
        buildingId: selected.id,
        name: selected.name,
        identifier: selected.identifier,
        areaName: context.data?.area.name,
      });
    else if (context.data) clearSelection();
  }, [
    selected,
    areaId,
    context.data?.area.name,
    selectProperty,
    clearSelection,
  ]);
  useEffect(() => {
    if (findingId) setPreferences(areaId, { findingsOpen: true });
  }, [findingId, areaId, setPreferences]);
  const updateQuery = (values: Record<string, string | null>) => {
    const next = new URLSearchParams(query.toString());
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, {
      scroll: false,
    });
  };
  const select = (id: string) => {
    updateQuery({ feature: id });
    const feature = features.find((f) => f.id === id);
    if (feature?.kind === "utility")
      setPreferences(areaId, { inspector: "utility" });
    else if (feature?.kind === "parcel")
      setPreferences(areaId, { inspector: "parcel" });
    else setPreferences(areaId, { inspector: "property" });
  };
  const details = useMemo<SceneDetail[]>(
    () =>
      (dossier.data?.detailedScene || [])
        .filter(
          (d) =>
            d.geographicGeometry &&
            Number.isFinite(d.lower) &&
            Number.isFinite(d.upper),
        )
        .map((d) => ({
          id: d.record.id,
          name: d.record.name,
          geographicGeometry: d.geographicGeometry!,
          localGeometry:
            dossier.data?.area.id === areaId ? d.localGeometry : undefined,
          lower: d.lower!,
          upper: d.upper!,
          verticalReference: d.verticalReference,
          kind: d.record.kind === "floor" ? "floor" : "space",
        })),
    [dossier.data, areaId],
  );
  const boundaries = useMemo<SceneBoundary[]>(
    () =>
      (dossier.data?.groups || []).map((g) => ({
        id: g.id,
        name: g.name,
        geographicGeometry: g.geographicBoundary,
        localGeometry: g.areaId === areaId ? g.boundary : undefined,
      })),
    [dossier.data, areaId],
  );
  const visibleFeatures = features.filter(
    (f) =>
      !preferences.hiddenLayers.includes(f.kind) ||
      f.id === selectedId ||
      finding?.featureIds.includes(f.id),
  );
  return {
    context,
    dossier,
    features,
    visibleFeatures,
    selected,
    selectedId,
    finding,
    details,
    boundaries,
    preferences,
    setPreferences: (patch: Parameters<typeof setPreferences>[1]) =>
      setPreferences(areaId, patch),
    navigation,
    navigate,
    select,
    selectFinding: (id: string | null) => updateQuery({ findingId: id }),
  };
}
export type BlockController = ReturnType<typeof useBlock>;
