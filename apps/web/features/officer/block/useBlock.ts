"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  AreaContext,
  AreaGeometry,
  BuildingDossier,
  PhysicalFeature,
} from "@ulpin/contracts";
import type {
  AreaNavigation,
  SceneDetail,
  SceneBoundary,
} from "@/components/AreaViewer";
import { useResource } from "../shared/hooks";
import { defaultMapPreferences, useOfficerStore } from "../shared/store";
export function useBlock(areaId: string) {
  const context = useResource<AreaContext>(`/areas/${areaId}/context`);
  const query = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const repeatedSelection = ['feature','record','world','packet'].some(key => query.getAll(key).length > 1);
  const selectedId = repeatedSelection ? null : query.get("feature");
  const requestedRecord = repeatedSelection ? null : query.get('record');
  const findingId = query.get("findingId");
  const finding = context.data?.latestCheck?.stale
    ? null
    : context.data?.latestCheck?.findings.find((f) => f.id === findingId) ||
      null;
  const showConflicts = query.get("conflicts") === "1";
  const conflictFindings = useMemo(
    () =>
      context.data?.latestCheck?.stale
        ? []
        : (context.data?.latestCheck?.findings || []).filter(
            (f) => f.category === "geometric" && !!f.geometry,
          ),
    [context.data?.latestCheck],
  );
  const shownFindings = useMemo(
    () => (showConflicts ? conflictFindings : finding ? [finding] : []),
    [showConflicts, conflictFindings, finding],
  );
  const highlightedIds = [
    ...new Set(shownFindings.flatMap((f) => f.featureIds)),
  ];
  const issueGeometry: AreaGeometry | undefined = shownFindings.length
    ? {
        type: "GeometryCollection",
        geometries: shownFindings.flatMap((f) =>
          f.geometry ? [f.geometry] : [],
        ),
      }
    : undefined;
  const geographicIssueGeometry: AreaGeometry | undefined = shownFindings.length
    ? {
        type: "GeometryCollection",
        geometries: shownFindings.flatMap((f) =>
          f.geographicGeometry ? [f.geographicGeometry] : [],
        ),
      }
    : undefined;
  const featureLabels = useMemo(
    () =>
      Object.fromEntries(
        (context.data?.parcelIdentifiers || []).map((p) => [
          p.parcelId,
          p.value,
        ]),
      ),
    [context.data?.parcelIdentifiers],
  );
  const features = useMemo(() => {
    const list = context.data?.features || [];
    const extra = new Map(
      shownFindings.flatMap((f) => f.participants || []).map((p) => [p.id, p]),
    );
    for (const feature of list) extra.delete(feature.id);
    return [...list, ...extra.values()];
  }, [context.data, shownFindings]);
  const selectedCandidate = features.find((f) => f.id === selectedId) || null;
  const worlds=[...new Set(features.map(f=>f.worldStatus))];
  const requestedWorld = query.get('world');
  const invalidWorld = !!requestedWorld && (!worlds.includes(requestedWorld as typeof worlds[number])
    || !!selectedCandidate && selectedCandidate.worldStatus !== requestedWorld);
  const selected = invalidWorld ? null : selectedCandidate;
  const selectionError = repeatedSelection ? 'This link has conflicting selection parameters.'
    : invalidWorld ? 'The supplied source world does not contain this selection.'
    : selectedId && context.data && !selected ? 'The supplied feature is not in this block.'
    : requestedRecord && context.data && selected?.kind !== 'building' ? 'The supplied unit has no selected building in this block.'
    : null;
  const world=worlds.find(w=>w===requestedWorld)??selected?.worldStatus??worlds[0]??'observed';
  const dossier = useResource<BuildingDossier>(
    selected?.kind === "building" ? `/buildings/${selected.id}/dossier` : null,
  );
  const preferences = useOfficerStore(
      (s) => s.mapPreferences[areaId] || defaultMapPreferences,
    ),
    setPreferences = useOfficerStore((s) => s.setMapPreferences),
    selectBlock = useOfficerStore((s) => s.selectBlock),
    selectProperty = useOfficerStore((s) => s.selectProperty),
    clearSelection = useOfficerStore((s) => s.clearSelection);
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
    const feature = features.find((f) => f.id === id);
    if(!feature)return;
    updateQuery({feature:id,record:null,packet:null,world:feature.worldStatus});
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
      f.worldStatus===world&&(!preferences.hiddenLayers.includes(f.kind) ||
      f.id === selectedId ||
      highlightedIds.includes(f.id)),
  );
  return {
    context,
    worlds,world,
    packetId: repeatedSelection ? null : query.get('packet'),
    setWorld:(value:string)=>{if(worlds.includes(value as typeof world))updateQuery({world:value,feature:null,record:null,packet:null,findingId:null});},
    recordId:requestedRecord&&dossier.data?.records.some(r=>r.id===requestedRecord)?requestedRecord:null,
    recordUnavailable:!!requestedRecord&&!!dossier.data&&!dossier.data.records.some(r=>r.id===requestedRecord),
    selectedRecord:dossier.data?.records.find(r=>r.id===requestedRecord),
    selectRecord:(id:string|null)=>{if(id&&!dossier.data?.records.some(r=>r.id===id))return;updateQuery({record:id,packet:null});if(id){setPreferences(areaId,{inspector:'floors'});navigate('focus');}},
    selectionError,
    featureLabels,
    showConflicts,
    conflictCount: conflictFindings.length,
    highlightedIds,
    issueGeometry,
    geographicIssueGeometry,
    toggleConflicts: () => {
      updateQuery({ conflicts: showConflicts ? null : "1", findingId: null });
      setPreferences(areaId, { findingsOpen: true });
    },
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
