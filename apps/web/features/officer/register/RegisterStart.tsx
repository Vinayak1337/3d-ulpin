"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { AreaContext, MapArea } from "@ulpin/contracts";
import { useOfficerStore } from "../shared/store";
import { useResource } from "../shared/hooks";
import { routes, withQuery } from "../shared/routes";
import {
  searchTargets,
  searchTargetRoute,
  type ResolveMatch,
} from "../shared/search-targets";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
} from "../shared/ui";
import { studioResolutionUrl } from "../../studio/product/urls";
import { datasetLabel } from "../shared/directory";
import BuildingPreview from "../scene/BuildingPreview";
import { useRegisterDirectory } from "./data";
import "./directory.css";
export default function RegisterStart({ identifier }: { identifier?: string } = {}) {
  const router = useRouter(),
    params = useSearchParams();
  const [query, setQuery] = useState(identifier || params.get("q") || "");
  useEffect(() => setQuery(identifier || params.get("q") || ""), [params, identifier]);
  const areas = useResource<MapArea[]>("/areas");
  const recentEntries = useOfficerStore((s) => s.recentProperties),
    storedArea = useOfficerStore((s) => s.selectedAreaId);
  const recent = recentEntries.filter(item => areas.data?.some(area => area.id === item.areaId));
  const requestedArea = params.get("area") || storedArea;
  const areaId =
    areas.data?.find((a) => a.id === requestedArea)?.id ||
    areas.data?.find((a) => a.featureCount && a.dataKind === "real")?.id;
  const context = useResource<AreaContext>(
    areaId ? `/areas/${areaId}/context` : null,
  );
  const submitted = identifier || params.get("q") || "";
  const resultRoute = (href: string) => identifier
    ? studioResolutionUrl(href, Object.fromEntries([...new Set(params.keys())].map(key => [key, params.getAll(key)])), true)
    : href;
  const result = useResource<{ matches: ResolveMatch[]; status: string }>(
    submitted ? `/resolve?identifier=${encodeURIComponent(submitted)}` : null,
  );
  const features = (context.data?.features || []).filter(
    (f) => f.kind === "building",
  );
  const dossiers = useRegisterDirectory(areaId);
  return (
    <main className="register-directory">
      <header className="directory-heading">
        <div>
          <span className="directory-kicker">PROPERTY RECORDS</span>
          <h1>Property Register</h1>
          <p>Find a property and open its floors, evidence, and history.</p>
        </div>
        <Link className="ui-button" href={routes.block()}>
          <Icon name="map" />
          Browse blocks
        </Link>
      </header>
      <form
        className="register-search"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(
            withQuery("/studio/registry", { q: query.trim(), area: areaId }),
          );
        }}
      >
        <Icon name="search" size={22} />
        <input
          aria-label="Search property identifier or address"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Property identifier, source ID, or address"
        />
        <Button type="submit" variant="primary" disabled={!query.trim()}>
          Find property
        </Button>
      </form>
      {submitted && (
        <section
          className="register-search-results"
          aria-label="Search results"
        >
          {result.loading ? (
            <LoadingState label="Finding properties" />
          ) : result.error ? (
            <ErrorState message={result.error} retry={result.reload} />
          ) : result.data?.matches.length ? (
            result.data.matches.map((match, index) => {
              const targets = searchTargets(
                match,
                areaId,
                context.data
                  ? {
                      areaId: context.data.area.id,
                      featureIds: context.data.features.map((f) => f.id),
                    }
                  : undefined,
              );
              return (
                <div key={index}>
                  {targets.map((target) => (
                    <Link
                      key={`${target.id}:${target.areaId}`}
                      href={resultRoute(searchTargetRoute(target, "register"))}
                    >
                      <Icon name="building" />
                      <span>
                        <strong>{target.recordName || target.name}</strong>
                        <small>{target.identifier}</small>
                      </span>
                      <span>
                        {target.kind === "building"
                          ? "Open register"
                          : "Open block"}{" "}
                        →
                      </span>
                    </Link>
                  ))}
                  {!targets.length && match.record && (
                    <Link href={resultRoute(`/studio/registry/records/${encodeURIComponent(match.record.id)}`)}>
                      Open retained local record ·{" "}
                      {match.record.name || match.record.identifier}
                    </Link>
                  )}
                </div>
              );
            })
          ) : (
            <EmptyState
              title="No matching property"
              description="Try an address, source ID, or a different identifier."
            />
          )}
        </section>
      )}
      <div className="register-directory-layout">
        <section>
          <div className="register-directory-heading">
            <h2>
              Properties in block <Badge>{features.length}</Badge>
            </h2>
            <select
              aria-label="Register block"
              value={areaId || ""}
              onChange={(e) =>
                router.push(
                  withQuery("/studio/registry", {
                    area: e.target.value,
                    q: submitted,
                  }),
                )
              }
            >
              <option value="">Choose a saved block</option>
              {[
                ["real", "Real sources"],
                ["demonstration", "Fictional demonstrations"],
                ["mixed", "Mixed real and fictional sources"],
                ["other", "Source status unclassified"],
              ].map(([kind,label]) => <optgroup label={label} key={kind}>{(areas.data || []).filter(a => a.featureCount && (kind === 'other' ? a.dataKind !== 'real' && a.dataKind !== 'demonstration' && a.dataKind !== 'mixed' : a.dataKind === kind)).map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</optgroup>)}
            </select>
          </div>
          {areaId && <p className="register-source-label">{datasetLabel(areas.data?.find(area => area.id === areaId)?.dataKind)}</p>}
          {areas.error ? <ErrorState message={areas.error} retry={areas.reload} /> : context.error ? (
            <ErrorState message={context.error} retry={context.reload} />
          ) : context.loading && !context.data ? (
            <LoadingState label="Opening block directory" />
          ) : features.length ? (
            <div className="property-card-grid">
              {features.map((feature) => {
                const dossier = (dossiers.data || []).find(
                    (d) => d.buildingId === feature.id,
                  ),
                  spaces = dossier?.spaces;
                return (
                  <Link
                    href={routes.register(feature.id, areaId)}
                    className="property-card"
                    key={feature.id}
                  >
                    <BuildingPreview feature={feature} />
                    <div>
                      <h3>{feature.name}</h3>
                      <p>
                        {feature.worldStatus === "synthetic"
                          ? "Fictional demonstration"
                          : feature.height.state.replaceAll("_", " ")}{" "}
                        <span>·</span> {feature.areaM2?.toFixed(1) || "—"} m²
                      </p>
                      <footer>
                        <span>
                          {spaces
                            ? `${spaces} recorded spaces`
                            : dossier
                              ? "Exterior record"
                              : "Open record"}
                        </span>
                        <Icon name="arrow" />
                      </footer>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title={areaId ? "No buildings in this block" : "Choose a block to browse properties"}
              description="Use the block selector or search for a property identifier above."
            />
          )}
        </section>
        <aside>
          <h2>Recently opened</h2>
          {recent.length ? (
            recent.slice(0, 7).map((item) => (
              <Link
                key={item.buildingId}
                href={routes.register(item.buildingId, item.areaId)}
              >
                <Icon name="history" />
                <span>
                  <strong>{item.name.replace(/v2/gi, "")}</strong>
                  <small>{item.areaName?.replace(/v2/gi, "")}</small>
                </span>
                <Icon name="chevron" />
              </Link>
            ))
          ) : (
            <p>Properties you open will appear here.</p>
          )}
          <div className="directory-help">
            <Icon name="map" size={26} />
            <h3>One property, connected views</h3>
            <p>
              Select a building on the map to open the same register and plans.
            </p>
            <Link href={routes.block(areaId)}>{areaId ? "Open this block" : "Browse saved blocks"} →</Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
