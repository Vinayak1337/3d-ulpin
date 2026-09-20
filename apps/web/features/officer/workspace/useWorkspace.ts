"use client";
import { documentFormat, documentSizeError } from "@/lib/document-formats";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AreaContext,
  AreaGeometry,
  BuildingDossier,
  CaseDetail,
  ImportPackage,
  PreparationCase,
  PreparationRequirements,
  SourceProfile,
} from "@ulpin/contracts";
import { api } from "@/lib/client";
import { request, useMutation, useResource } from "../shared/hooks";
import { routes } from "../shared/routes";
import { useOfficerStore } from "../shared/store";
import type { CanvasSource } from "./types";

const sourceKind = (name: string, profile = ""): CanvasSource["kind"] =>
  /\.pdf$/i.test(name) || profile.includes("pdf")
    ? "pdf"
    : /\.(png|jpe?g|webp)$/i.test(name) || profile.includes("png")
      ? "image"
      : "text";
function asGeometry(value: unknown): AreaGeometry | undefined {
  const geometry = value as AreaGeometry | null;
  return geometry &&
    [
      "Polygon",
      "MultiPolygon",
      "LineString",
      "MultiLineString",
      "Point",
      "MultiPoint",
      "GeometryCollection",
    ].includes(geometry.type)
    ? geometry
    : undefined;
}
export function useWorkspace(buildingId?: string, unassignedCaseId?: string) {
  const dossier = useResource<BuildingDossier>(
    buildingId ? `/buildings/${buildingId}/dossier` : null,
  );
  const search = useSearchParams();
  const requestedArea = search.get("area");
  const membership = useResource<AreaContext>(
    requestedArea && dossier.data && requestedArea !== dossier.data.area.id
      ? `/areas/${encodeURIComponent(requestedArea)}/context`
      : null,
  );
  const backArea = membership.data?.features.some((f) => f.id === buildingId)
    ? membership.data.area
    : dossier.data?.area;
  const [opened, setOpened] = useState<PreparationCase | null>(null);
  const recordedPreparation =
    dossier.data?.preparations.find((p) => p.id === opened?.id) ||
    dossier.data?.preparations[0];
  const preparation =
    opened &&
    (!recordedPreparation || opened.revision > recordedPreparation.revision)
      ? opened
      : recordedPreparation || null;
  const sourceWorkspace = useResource<ImportPackage>(unassignedCaseId && !buildingId ? `/source-workspaces?caseId=${unassignedCaseId}` : null);
  const pkg = useResource<ImportPackage>(
    preparation ? `/import-packages/${preparation.packageId}` : sourceWorkspace.data ? `/import-packages/${sourceWorkspace.data.id}` : null,
  );
  const caseId = preparation?.caseId || unassignedCaseId;
  const detail = useResource<CaseDetail>(caseId ? `/cases/${caseId}` : null);
  const requirements = useResource<PreparationRequirements>(
    pkg.data ? `/import-packages/${pkg.data.id}/requirements` : null,
  );
  const mutation = useMutation();
  const requestKey = useRef<string | null>(null);
  const receiptKeys = useRef(new WeakMap<File, string>());
  const receiptKey = (file: File) => {
    const retained = receiptKeys.current.get(file); if (retained) return retained;
    const key = crypto.randomUUID(); receiptKeys.current.set(file, key); return key;
  };
  const selectProperty = useOfficerStore((state) => state.selectProperty);
  useEffect(() => {
    if (!dossier.data || !backArea || membership.loading) return;
    const d = dossier.data;
    selectProperty({
      buildingId: d.canonicalBuildingId,
      areaId: backArea.id,
      name: d.building.name,
      identifier: d.building.identifier,
      areaName: backArea.name,
    });
  }, [dossier.data, backArea, membership.loading, selectProperty]);
  const jobRunning = detail.data?.jobs.some((job) =>
    ["queued", "running"].includes(job.status),
  );
  useEffect(() => {
    if (!jobRunning) return;
    const timer = setTimeout(() => {
      void detail.reload();
    }, 1200);
    return () => clearTimeout(timer);
  }, [jobRunning, detail.data, detail.reload]);
  const refresh = async () => {
    await Promise.all([
      dossier.reload(),
      pkg.reload(),
      detail.reload(),
      requirements.reload(),
    ]);
  };
  const updatePackage = async (value: ImportPackage) => {
    pkg.setData(value);
    await Promise.all([
      dossier.reload(),
      requirements.reload(),
      detail.reload(),
    ]);
  };
  const open = async () =>
    mutation.run(async () => {
      if (!dossier.data || !buildingId) return;
      requestKey.current ||= crypto.randomUUID();
      const next = await request<PreparationCase>(
        `/buildings/${buildingId}/preparation-cases`,
        {
          requestKey: requestKey.current,
          expectedRevision: dossier.data.building.revision,
        },
      );
      setOpened(next);
      await dossier.reload();
      return next;
    });
  const upload = async (files: File[]) =>
    mutation.run(async () => {
      if (!files.length) return;
      const sizeError = files.map(documentSizeError).find(Boolean);
      if (sizeError) throw new Error(sizeError);
      if (pkg.data && (buildingId || pkg.data.sourceWorkspace)) {
        let current = pkg.data;
        try {
          for (const file of files) {
            const format = documentFormat(file.name);
            if (!format) throw new Error(`Unsupported document: ${file.name}. Use PDF, PNG, JPEG, CSV, text or DOCX.`);
            const form = new FormData();
            form.set("file", file);
            form.set("format", format!);
            form.set("entityIds", JSON.stringify(buildingId ? [buildingId] : []));
            form.set("expectedRevision", String(current.revision));
            form.set("requestKey", receiptKey(file));
            const response = await fetch(
              `/api/v1/import-packages/${current.id}/${buildingId ? "documents" : "source-documents"}`,
              { method: "POST", body: form },
            );
            const value = await response.json();
            if (!response.ok)
              throw new Error(
                value.error?.message || `Could not read ${file.name}`,
              );
            current = value;
            pkg.setData(current);
          }
        } finally {
          await updatePackage(current);
        }
      } else if (caseId) {
        try {
          for (const file of files) {
            const format = documentFormat(file.name);
            if (!format) throw new Error("Use PDF, PNG, JPEG, CSV, text or DOCX.");
            const form = new FormData(); form.set("file", file); form.set("format", format); form.set("requestKey", receiptKey(file));
            const response = await fetch(`/api/v1/cases/${caseId}/reference-documents`, {method:"POST",body:form});
            const value = await response.json(); if(!response.ok) throw new Error(value.error?.message || `Could not read ${file.name}`);
          }
        } finally {
          await detail.reload();
        }
      } else throw new Error("Create a workspace first.");
      return true;
    });
  const sources = useMemo<CanvasSource[]>(() => {
    if (dossier.data) {
      const d = dossier.data;
      const candidates = pkg.data?.factCandidates || [];
      const list: CanvasSource[] = d.sources.map((source) => {
        const originalKind = sourceKind(source.name, source.profile);
        const claim = candidates.find(
          (fact) =>
            fact.property.endsWith(".geometry") &&
            fact.evidence.some((e) => e.sourceRevisionId === source.id) &&
            asGeometry(fact.value),
        );
        return {
          id: source.id,
          name: source.name,
          hash: source.sha256,
          url: source.url,
          originalKind: originalKind as "image" | "pdf" | "text",
          kind: originalKind === "text" && claim ? "geometry" : originalKind,
          frame: claim?.referenceFrameId,
          geometry: claim ? asGeometry(claim.value) : undefined,
          parts: (pkg.data?.parts || []).filter(
            (part) => part.sourceRevisionId === source.id,
          ),
          status: "Retained",
        };
      });
      list.push({
        id: `outline:${d.building.id}`,
        name: "Recorded property outline",
        hash: `${d.building.id}:${d.building.revision}`,
        kind: "geometry",
        frame: `AREA-${d.area.id}`,
        geometry: d.building.geometry,
        parts: [],
        status: "Recorded",
      });
      return list;
    }
    return (detail.data?.sources || []).map((source) => ({
      id: source.id,
      name: source.name,
      hash: source.sha256,
      url: routes.source(source.id),
      kind: sourceKind(source.name, source.profile),
      status: source.status,
      originalKind: sourceKind(source.name, source.profile) as "image" | "pdf" | "text",
      parts: pkg.data ? pkg.data.parts.filter(part => part.sourceRevisionId === source.id) : source.inspection?.referenceParts || [],
    }));
  }, [dossier.data, pkg.data, detail.data]);
  return {
    dossier: dossier.data,
    backArea,
    intakeAreaId: requestedArea,
    contextWarning:
      requestedArea &&
      dossier.data &&
      requestedArea !== dossier.data.area.id &&
      !membership.loading &&
      backArea?.id !== requestedArea
        ? "Requested block membership could not be verified. Returning to the recorded area."
        : "",
    preparation,
    pkg: pkg.data,
    sourceWorkspace: sourceWorkspace.data,
    detail: detail.data,
    requirements: requirements.data,
    sources,
    caseId,
    buildingId,
    open,
    upload,
    refresh,
    updatePackage,
    setPreparation: setOpened,
    setCase: detail.setData,
    busy: mutation.busy,
    error:
      mutation.error ||
      dossier.error ||
      pkg.error ||
      sourceWorkspace.error ||
      detail.error ||
      requirements.error,
    loading: dossier.loading || detail.loading || pkg.loading,
    run: mutation.run,
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;
