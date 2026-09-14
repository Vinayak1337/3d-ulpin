"use client";
import { useEffect, useState } from "react";
import type { BuildingDossier } from "@ulpin/contracts";
import AreaWorkbench from "./AreaWorkbench";
import type { PropertyPanelMode } from "./PropertyDossierPanel";
import { registryRequest } from "@/lib/registry-client";
export default function PropertyPage({
  buildingId,
  mode = "register",
}: {
  buildingId: string;
  mode?: PropertyPanelMode;
}) {
  const [areaId, setAreaId] = useState<string | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setAreaId(null);
    setError("");
    void registryRequest<BuildingDossier>(`/buildings/${buildingId}/dossier`)
      .then((value) => {
        if (active) setAreaId(value.area.id);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [buildingId]);
  if (error)
    return (
      <main className="property-page-message">
        <h1>Property unavailable</h1>
        <p role="alert">{error}</p>
        <a href="/areas">Return to 3D Block</a>
      </main>
    );
  if (!areaId)
    return (
      <main className="property-page-message" role="status">
        Opening the selected property and its block…
      </main>
    );
  return (
    <AreaWorkbench
      initialAreaId={areaId}
      initialFeatureId={buildingId}
      initialPanel={mode}
    />
  );
}
