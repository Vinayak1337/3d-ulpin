"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { AreaContext, MapArea } from "@ulpin/contracts";
import { Icon } from "../../officer/shared/ui";
import { searchTargets, searchTargetRoute, type ResolveMatch } from "../../officer/shared/search-targets";
import { useDebouncedValue, useResource } from "../../officer/shared/hooks";
import { productFamily, productNavigation } from "./urls";
import { savedDatasetUrl, type SavedSpatialDataset, type DatasetIdentityMatch } from "@/lib/spatial-datasets";
import { confirmStudioNavigation } from "../data/navigation-guard";
import "./product.css";
import "./header.css";

type Result = { key: string; label: string; detail: string; href: string };
type Props = { actions?: ReactNode; theme: "light" | "dark"; onThemeToggle: () => void };

export default function ProductHeader({ actions, theme, onThemeToggle }: Props) {
  const path = usePathname();
  const router = useRouter();
  const family = productFamily(path);
  const areaId = path.match(/^\/studio\/areas\/([^/]+)/)?.[1] ?? null;
  const areaContext = useResource<AreaContext>(areaId ? `/areas/${encodeURIComponent(areaId)}/context` : null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [datasets, setDatasets] = useState(false);
  const [mobile, setMobile] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const chooser = useRef<HTMLDivElement>(null);
  const settled = useDebouncedValue(query.trim());
  const remote = useResource<{ matches: ResolveMatch[] }>(settled ? `/resolve?identifier=${encodeURIComponent(settled)}` : null);
  const spatialSearch = useResource<{ matches: DatasetIdentityMatch[] }>(settled ? `/spatial-datasets/search?q=${encodeURIComponent(settled)}` : null);
  const areas = useResource<MapArea[]>(datasets ? "/areas" : null);
  const savedDatasets = useResource<SavedSpatialDataset[]>(datasets ? "/spatial-datasets" : null);

  const results = useMemo<Result[]>(() => {
    if (!query.trim()) return [];
    const stored = settled === query.trim()
      ? (remote.data?.matches ?? []).flatMap(match => searchTargets(match)).map(target => ({
          key: `${target.kind}:${target.id}:${target.areaId}:${target.recordId ?? ""}`,
          label: target.recordName ? `${target.recordName} · ${target.name}` : target.name,
          detail: `Saved record · ${target.identifier}`,
          href: searchTargetRoute(target, family),
        }))
      : [];
    if (settled === query.trim()) stored.unshift(...(spatialSearch.data?.matches ?? []).map(match => ({
      key: `dataset:${match.datasetId}:${match.objectId}`,
      label: match.identifier,
      detail: `${match.datasetName} · ${match.label}`,
      href: match.href,
    })));
    return [...new Map(stored.map(result => [result.key, result])).values()].slice(0, 12);
  }, [query, settled, remote.data, spatialSearch.data, family]);

  useEffect(() => setActive(results.length ? 0 : -1), [query, results.length]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const editable = event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
      if ((event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !editable) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")) {
        event.preventDefault();
        search.current?.focus();
        setOpen(true);
      }
      if (event.key === "Escape") {
        setOpen(false);
        setDatasets(false);
        setMobile(false);
        if (document.activeElement === search.current) search.current?.blur();
      }
    };
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
      if (!chooser.current?.contains(event.target as Node)) setDatasets(false);
    };
    window.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("keydown", key); document.removeEventListener("pointerdown", outside); };
  }, []);
  const choose = (result: Result) => {
    if (!confirmStudioNavigation(result.href)) return;
    setOpen(false);
    setQuery("");
    router.push(result.href);
  };

  return <header className="city-header" data-product-header>
    <Link className="city-brand" href="/studio" aria-label="3D ULPIN Studio home"><span>3D ULPIN<small>STUDIO</small></span></Link>
    <nav className={`city-nav ${mobile ? "is-open" : ""}`} aria-label="Product sections">
      {productNavigation.map(item => <Link key={item.key} href={item.href} aria-current={family === item.key ? "page" : undefined} onClick={() => setMobile(false)}>
        <Icon name={item.key === "block" ? "map" : item.key === "register" ? "register" : "workspace"} size={17} /><span>{item.label}</span>
      </Link>)}
    </nav>
    <div className="city-search" ref={container}>
      <Icon name="search" size={17} />
      <input ref={search} role="combobox" aria-label="Search properties and record IDs" aria-expanded={open && !!query.trim()} aria-controls="city-search-list" aria-activedescendant={open && active >= 0 ? `city-result-${active}` : undefined} aria-autocomplete="list" value={query} maxLength={150} placeholder="Search properties and record IDs" onChange={event => { setQuery(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); setActive(index => Math.min(results.length - 1, index + 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
        if (event.key === "Enter" && results[active]) { event.preventDefault(); choose(results[active]); }
      }} />
      <kbd>/</kbd>
      {open && query.trim() && <div className="city-search-results" id="city-search-list" role="listbox" aria-label="Matching properties">
        {results.map((result, index) => <button key={result.key} id={`city-result-${index}`} role="option" aria-selected={index === active} onMouseMove={() => setActive(index)} onClick={() => choose(result)}><Icon name="building" size={19} /><span><strong>{result.label}</strong><small>{result.detail}</small></span><Icon name="external" size={14} /></button>)}
        {(remote.loading || spatialSearch.loading || settled !== query.trim()) && <p role="status">Searching saved sources…</p>}
        {(remote.error || spatialSearch.error) && <p role="alert">Saved search unavailable. <button onClick={() => void Promise.all([remote.reload(), spatialSearch.reload()])}>Retry</button></p>}
        {!results.length && !remote.loading && !spatialSearch.loading && settled === query.trim() && <p>No matching property. Search a record ID, or browse the property register.</p>}
        <footer>Distinct datasets retain their own identities. <Link href="/studio/registry">Browse registers</Link></footer>
      </div>}
    </div>
    <div className="city-dataset" ref={chooser}>
      <button aria-label="Choose an area" aria-expanded={datasets} onClick={() => setDatasets(value => !value)}><Icon name="layers" size={17} /><span>{areaContext.data?.area.name ?? "Areas"}</span><Icon name="down" size={13} /></button>
      {datasets && <div className="city-dataset-menu"><header><strong>Saved areas and datasets</strong><button onClick={() => setDatasets(false)} aria-label="Close area chooser"><Icon name="close" size={16} /></button></header>
        {areas.data?.map(area => <Link key={area.id} aria-current={area.id === areaId ? "page" : undefined} href={`/studio/areas/${area.id}`} onClick={() => setDatasets(false)}><Icon name="map" size={16} /><span>{area.name}<small>{area.featureCount ?? "Unknown"} features · {area.dataKind ?? "Unclassified"}</small></span></Link>)}
        {savedDatasets.data?.map(dataset => <Link key={dataset.id} href={savedDatasetUrl(dataset.id)} onClick={() => setDatasets(false)}><Icon name="layers" size={16} /><span>{dataset.name}<small>{dataset.buildingCount} buildings · saved</small></span></Link>)}
        {(areas.loading || savedDatasets.loading) && <p>Loading saved areas…</p>}
        {(areas.error || savedDatasets.error) && <button onClick={() => void Promise.all([areas.reload(), savedDatasets.reload()])}>Retry saved areas</button>}
        <Link href="/studio/datasets" onClick={() => setDatasets(false)}>Browse all datasets →</Link>
      </div>}
    </div>
    <span className="city-snapshot-status" aria-label={areaContext.data ? "Saved area snapshot" : "Workspace status unavailable"}><span className="ui-dot" />{areaContext.data ? "Snapshot" : "Status unavailable"}</span>
    <button className="city-theme-toggle" aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`} onClick={onThemeToggle}><Icon name="settings" size={18} /><span>{theme === "dark" ? "Light" : "Dark"}</span></button>
    {actions && <div className="city-header-actions">{actions}</div>}
    <span className="city-user-status" title="No user profile is available">User unavailable</span>
    <button className="city-mobile-menu" aria-label="Main navigation" aria-expanded={mobile} onClick={() => setMobile(value => !value)}><Icon name={mobile ? "close" : "menu"} size={20} /></button>
  </header>;
}
