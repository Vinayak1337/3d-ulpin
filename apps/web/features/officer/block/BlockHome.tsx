"use client";
import Link from "next/link";
import { useState } from "react";
import type { MapArea, AreaContext } from "@ulpin/contracts";
import { useResource } from "../shared/hooks";
import { routes } from "../shared/routes";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
} from "../shared/ui";
import MapPlan from "./MapPlan";
import DataTools from "./DataTools";
import "./home.css";
import "./data-tools.css";
function BlockCard({ area }: { area: MapArea }) {
  const context = useResource<AreaContext>(`/areas/${area.id}/context`);
  return (
    <Link className="block-card" href={routes.block(area.id)}>
      <div className="block-card-map">
        {context.data ? (
          <MapPlan
            features={context.data.features}
            extent={area.extent}
            interactive={false}
          />
        ) : (
          <LoadingState label="Loading outline" />
        )}
        <Badge tone={area.dataKind === "demonstration" ? "warning" : "info"}>
          {area.dataKind === "demonstration"
            ? "Fictional demo"
            : area.dataKind === "real"
              ? "Real sources"
              : "Saved dataset"}
        </Badge>
      </div>
      <div className="block-card-body">
        <h2>
          {area.name
            .replace(/v2/gi, "")
            .replace(/redesign verification/gi, "Verification fixture")}
        </h2>
        <p>
          {area.featureCount} features <span>·</span> Revision {area.revision}
        </p>
        <span className="block-card-action">
          Open block <Icon name="arrow" size={15} />
        </span>
      </div>
    </Link>
  );
}
export default function BlockHome() {
  const areas = useResource<MapArea[]>("/areas");
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState("all"),
    [importOpen, setImportOpen] = useState(false);
  const saved = (areas.data || []).filter((a) => a.featureCount && a.reference);
  const filtered = saved.filter(
    (a) =>
      (kind === "all" || a.dataKind === kind) &&
      a.name.toLowerCase().includes(query.toLowerCase()),
  );
  // Main product datasets first; previous verification areas remain accessible below.
  const ordered = [...filtered].sort(
    (a, b) =>
      Number(b.name === "Lake View · demonstration") -
      Number(a.name === "Lake View · demonstration"),
  );
  return (
    <main className="block-directory">
      <header className="directory-heading">
        <div>
          <span className="directory-kicker">SPATIAL RECORDS</span>
          <h1>Block Map</h1>
          <p>Choose a neighborhood to explore its properties.</p>
        </div>
        <Button
          icon="upload"
          variant="primary"
          onClick={() => setImportOpen(true)}
        >
          Import a block
        </Button>
      </header>
      <div className="directory-filter">
        <div role="group" aria-label="Dataset type">
          {[
            ["all", "All blocks"],
            ["real", "Real data"],
            ["demonstration", "Demonstrations"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          <Icon name="search" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a block"
            aria-label="Find a block"
          />
        </label>
      </div>
      {areas.error ? (
        <ErrorState message={areas.error} retry={areas.reload} />
      ) : areas.loading && !areas.data ? (
        <LoadingState label="Loading blocks" />
      ) : ordered.length ? (
        <div className="block-directory-grid">
          {ordered.map((area) => (
            <BlockCard key={area.id} area={area} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No matching blocks"
          description="Change the filter or import a source."
          icon="map"
        />
      )}
      <DataTools
        open={importOpen}
        onClose={() => setImportOpen(false)}
        initialMode="import"
        onChanged={() => void areas.reload()}
      />
    </main>
  );
}
