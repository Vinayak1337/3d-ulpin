"use client";
import Link from "next/link";
import { useEffect,useState } from "react";
import {useSearchParams} from "next/navigation";
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
import { datasetLabel, filterAreas } from "../shared/directory";
import MapPlan from "./MapPlan";
import {savedDatasetUrl,type SavedSpatialDataset} from "@/lib/spatial-datasets";
import DataTools from "./DataTools";
import "./home.css";
import "./data-tools.css";
function BlockCard({ area }: { area: MapArea }) {
  const context = useResource<AreaContext>(area.featureCount === 0 ? null : `/areas/${area.id}/context`);
  return (
    <Link className="block-card" href={routes.block(area.id)}>
      <div className="block-card-map">
        {area.featureCount === 0 ? <p className="block-outline-status">No mapped features yet</p> : context.data ? (
          <MapPlan
            features={context.data.features}
            extent={area.extent}
            interactive={false}
          />
        ) : context.error ? <p className="block-outline-status">Outline unavailable</p> : (
          <LoadingState label="Loading outline" />
        )}
        <Badge tone={area.dataKind === "demonstration" ? "warning" : "info"}>
          {datasetLabel(area.dataKind)}
        </Badge>
      </div>
      <div className="block-card-body">
        <h2>
          {area.name}
        </h2>
        <p>
          {area.featureCount ?? "—"} features <span>·</span> Revision {area.revision}
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
  const datasets = useResource<SavedSpatialDataset[]>("/spatial-datasets");
  const search=useSearchParams();
  const [query, setQuery] = useState(search.get("q") || "");
  const kind = search.get("kind") || "all";
  const [importOpen, setImportOpen] = useState(search.get('import')==='1');
  useEffect(() => { setQuery(search.get("q") || ""); setImportOpen(search.get('import')==='1'); }, [search]);
  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(window.location.search);
    if(value) next.set(key,value); else next.delete(key);
    window.history.replaceState(null, '', '/studio/datasets'+(next.size?'?'+next:''));
  };
  const ordered = filterAreas(areas.data || [], query, kind);
  const demos = kind === "all" || kind === "demonstration" ? (datasets.data??[]).filter(d => `${d.name} ${d.id}`.toLowerCase().includes(query.trim().toLowerCase())) : [];

  return (
    <main className="block-directory">
      <header className="directory-heading">
        <div>
          <span className="directory-kicker">SPATIAL RECORDS</span>
          <h1>Maps</h1>
          <p>Choose a dataset to explore its map and property records.</p>
          <div className="directory-links"><Link href="/studio/registry">Find a property</Link><Link href="/studio/work">Resume work <Icon name="arrow" size={14} /></Link></div>
        </div>
        <Button
          icon="upload"
          variant="primary"
          onClick={() => { window.location.href = routes.addFiles(); }}
        >
          Add files
        </Button>
      </header>
      <div className="directory-filter">
        <div role="group" aria-label="Dataset type">
          {[
            ["all", "All datasets"],
            ["saved", "Mapped sources"],
            ["demonstration", "Fictional demonstrations"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={kind === value}
              onClick={() => updateFilter("kind", value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          <Icon name="search" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); updateFilter("q", e.target.value); }}
            placeholder="Find a block"
            aria-label="Find a block"
          />
        </label>
      </div>
      {datasets.error && <ErrorState message={datasets.error} retry={datasets.reload} />}
      {datasets.loading && !datasets.data && <LoadingState label="Loading saved datasets"/>}
      {areas.error && <ErrorState message={areas.error} retry={areas.reload} />}
      {areas.loading && !areas.data && <LoadingState label="Loading saved blocks" />}
      {!!(demos.length || ordered.length) && <div className="block-directory-grid">
        {demos.map(dataset => <Link className="block-card block-demo-card" href={savedDatasetUrl(dataset.id)} key={dataset.id}>
          <div className="block-card-body"><Badge tone="warning">Fictional demonstration</Badge><h2>{dataset.name}</h2><p>{dataset.buildingCount} buildings <span>·</span> {dataset.floorCount} supplied floors</p><p>Saved dataset · revision {dataset.revision} · needs review</p><span className="block-card-action">Open map <Icon name="arrow" size={15}/></span></div>
        </Link>)}
        {ordered.map(area => <BlockCard key={area.id} area={area}/>)}
      </div>}
      {!datasets.loading && !datasets.error && !areas.loading && !areas.error && !demos.length && !ordered.length && <EmptyState title="No matching datasets" description="Change the filter or import a source." icon="map"/>}
      <footer className="directory-footer"><span>Saved datasets retain original files and spatial records. Fictional records remain separate from surveyed sources.</span><Link href="/studio/source-study">Delhi source study & downloads</Link></footer>
      <DataTools
        open={importOpen}
        onClose={() => {setImportOpen(false);updateFilter('import', '');}}
        initialMode="import"
        onChanged={() => void areas.reload()}
      />
    </main>
  );
}
