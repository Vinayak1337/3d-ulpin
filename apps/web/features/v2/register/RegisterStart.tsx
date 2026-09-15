"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type {
  AreaContext,
  MapArea,
  PhysicalFeature,
  RegistryRecord,
} from "@ulpin/contracts";
import { useResource } from "../shared/hooks";
import { routes } from "../shared/routes";
import {
  searchTargets,
  searchTargetRoute,
  type ResolveMatch,
} from "../shared/search-targets";
import { useV2Store } from "../shared/store";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  Panel,
} from "../shared/ui";
import { useRegisterDirectory } from "./data";
import { date, number, words } from "./model";
import styles from "./register.module.css";

interface ResolveResult {
  status: "matched" | "ambiguous" | "not_found";
  matches: ResolveMatch[];
}
export default function RegisterStart() {
  const params = useSearchParams(),
    [query, setQuery] = useState(params.get("q") || ""),
    [submitted, setSubmitted] = useState(params.get("q") || ""),
    [filter, setFilter] = useState("");
  const incomingQuery = params.get("q");
  useEffect(() => {
    setQuery(incomingQuery || "");
    setSubmitted(incomingQuery || "");
  }, [incomingQuery]);
  const selectedArea = useV2Store((state) => state.selectedAreaId),
    selectedBuilding = useV2Store((state) => state.selectedBuildingId),
    recents = useV2Store((state) => state.recentProperties),
    selectBlock = useV2Store((state) => state.selectBlock);
  const areas = useResource<MapArea[]>("/areas");
  const areaId = selectedArea || areas.data?.[0]?.id;
  const context = useResource<AreaContext>(
    areaId ? `/areas/${encodeURIComponent(areaId)}/context` : null,
  );
  const result = useResource<ResolveResult>(
    submitted ? `/resolve?identifier=${encodeURIComponent(submitted)}` : null,
  );
  const features = (context.data?.features || []).filter(
    (item) => item.kind === "building",
  );
  const directory = useRegisterDirectory([
    ...recents.slice(0, 4).map((item) => item.buildingId),
    ...features.slice(0, 8).map((item) => item.id),
  ]);
  const cases = directory.data
    .flatMap((item) =>
      item.investigations.map((record) => ({
        record,
        building: item.building,
        area: item.area,
      })),
    )
    .sort(
      (a, b) => Date.parse(b.record.updatedAt) - Date.parse(a.record.updatedAt),
    )
    .slice(0, 5);
  const drafts = directory.data
    .flatMap((item) =>
      item.preparations.map((preparation) => ({
        preparation,
        building: item.building,
        area: item.area,
        pkg: item.packages.find((pkg) => pkg.id === preparation.packageId),
      })),
    )
    .filter((item) => item.pkg?.state !== "COMMITTED")
    .slice(0, 5);
  return (
    <main className={styles.startPage}>
      <div className={styles.startHeading}>
        <span className={styles.titleIcon}>
          <Icon name="register" size={30} />
        </span>
        <div>
          <span className={styles.eyebrow}>Property records</span>
          <h1>Property Register</h1>
          <p>Find a building. Open its record, evidence and review history.</p>
        </div>
        <Link
          className={styles.linkButton}
          href={routes.block(areaId, selectedBuilding)}
        >
          <Icon name="map" /> Open Block Map
        </Link>
      </div>
      <Panel className={styles.searchPanel}>
        <form
          className={styles.searchForm}
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(query.trim());
          }}
        >
          <Icon name="search" size={23} />
          <input
            aria-label="Search property identifier"
            placeholder="Search source ID, building ID or property identifier"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={200}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={!query.trim() || result.loading}
            icon="arrow"
          >
            Find property
          </Button>
        </form>
        {result.loading && <LoadingState label="Searching loaded records" />}
        {result.error && (
          <ErrorState
            message={result.error}
            retry={() => void result.reload()}
          />
        )}
        {result.data && query.trim() === submitted && (
          <div className={styles.searchResults}>
            {!result.data.matches.length ? (
              <EmptyState
                title="Not present in loaded data"
                description="Check the identifier or choose a building from a block."
              />
            ) : (
              <>
                <div className={styles.resultHeading}>
                  <strong>
                    {result.data.matches.length} matching{" "}
                    {result.data.matches.length === 1 ? "record" : "records"}
                  </strong>
                  {result.data.status === "ambiguous" && (
                    <Badge tone="warning">Choose the correct property</Badge>
                  )}
                </div>
                {result.data.matches.map((match, index) => {
                  const targets = searchTargets(
                    match,
                    areaId,
                    context.data
                      ? {
                          areaId: context.data.area.id,
                          featureIds: context.data.features.map(
                            (item) => item.id,
                          ),
                        }
                      : undefined,
                  );
                  return (
                    <div key={index}>
                      {targets.length > 1 && (
                        <p className={styles.note}>
                          This record is linked to multiple buildings. Choose a
                          property.
                        </p>
                      )}
                      {targets.map((target) => (
                        <article
                          key={`${target.kind}:${target.id || target.areaId}`}
                        >
                          <Icon
                            name={
                              target.kind === "building" ? "building" : "map"
                            }
                            size={24}
                          />
                          <div>
                            <strong>{target.recordName || target.name}</strong>
                            {target.recordName && <small>{target.name}</small>}
                            <small className={styles.mono}>
                              {target.identifier}
                            </small>
                          </div>
                          <Link
                            className={`${styles.linkButton} ${target.kind === "building" ? styles.linkPrimary : ""}`}
                            href={searchTargetRoute(target, "register")}
                          >
                            {target.kind === "building"
                              ? "Open register"
                              : "Open in block"}
                            <Icon name="arrow" />
                          </Link>
                        </article>
                      ))}
                      {!targets.length && (
                        <EmptyState
                          title="No linked block property"
                          description="This record is retained but has no supported building association."
                        />
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </Panel>
      {selectedBuilding && (
        <Link
          href={routes.register(selectedBuilding, areaId)}
          className={styles.selectedHandoff}
        >
          <Icon name="target" />
          <span>Continue with the selected building</span>
          <strong>
            {recents.find((item) => item.buildingId === selectedBuilding)
              ?.name || "Open selected property"}
          </strong>
          <Icon name="arrow" />
        </Link>
      )}
      <div className={styles.startGrid}>
        <Panel
          title="Recent properties"
          actions={<Badge>{recents.length}</Badge>}
        >
          <div className={styles.propertyList}>
            {recents.slice(0, 6).map((item) => (
              <Link
                key={item.buildingId}
                href={routes.register(item.buildingId, item.areaId)}
              >
                <span className={styles.propertyTile}>
                  <Icon name="building" size={24} />
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small className={styles.mono}>{item.identifier}</small>
                  <small>
                    {item.areaName || "Viewed in this browser session"}
                  </small>
                </span>
                <Icon name="chevron" />
              </Link>
            ))}
          </div>
          {!recents.length && (
            <EmptyState
              title="No recent properties"
              description="Buildings you open will appear here."
              icon="history"
            />
          )}
        </Panel>
        <Panel title="Open from a block" className={styles.directoryPanel}>
          <div className={styles.filters}>
            <label>
              Block
              <select
                value={areaId || ""}
                onChange={(event) => {
                  const area = areas.data?.find(
                    (item) => item.id === event.target.value,
                  );
                  if (area) selectBlock(area.id, area.name);
                }}
              >
                <option value="">Choose block</option>
                {areas.data?.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </select>
            </label>
            <input
              aria-label="Filter properties in block"
              placeholder="Filter buildings"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          {areas.error && (
            <ErrorState
              message={areas.error}
              retry={() => void areas.reload()}
            />
          )}{" "}
          {context.error && (
            <ErrorState
              message={context.error}
              retry={() => void context.reload()}
            />
          )}{" "}
          {context.loading ? (
            <LoadingState label="Loading buildings" />
          ) : (
            <div className={styles.propertyList}>
              {features
                .filter((item) =>
                  `${item.name} ${item.identifier} ${item.sourceKey}`
                    .toLowerCase()
                    .includes(filter.toLowerCase()),
                )
                .slice(0, 30)
                .map((item) => (
                  <Link key={item.id} href={routes.register(item.id, areaId)}>
                    <span className={styles.propertyTile}>
                      <Icon name="building" />
                    </span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {number(item.areaM2, "m²")} footprint ·{" "}
                        {words(item.worldStatus)}
                      </small>
                      <small className={styles.mono}>{item.identifier}</small>
                    </span>
                    <Icon name="chevron" />
                  </Link>
                ))}
            </div>
          )}
          {!context.loading && !features.length && (
            <EmptyState
              title="No buildings in this block"
              description="Import sources or choose another block."
            />
          )}
          {features.length > 30 && (
            <p className={styles.note}>
              Showing up to 30 buildings. Filter this block to find more.
            </p>
          )}
        </Panel>
        <div className={styles.stack}>
          <Panel
            title="Saved investigations"
            actions={directory.loading ? <Badge>Loading</Badge> : undefined}
          >
            <div className={styles.shortList}>
              {cases.map(({ record, building, area }) => (
                <Link
                  key={record.id}
                  href={`${routes.register(building.id, area.id)}&tab=investigation&case=${record.id}`}
                >
                  <Icon name="search" />
                  <span>
                    <strong>{record.reference}</strong>
                    <small>
                      {building.name} · {date(record.updatedAt)}
                    </small>
                    <Badge
                      tone={record.status === "CLOSED" ? "neutral" : "info"}
                    >
                      {words(record.status)}
                    </Badge>
                  </span>
                  <Icon name="chevron" />
                </Link>
              ))}
            </div>
            {!cases.length && !directory.loading && (
              <EmptyState
                title="No saved cases in this selection"
                description="Open a property to start a local investigation."
              />
            )}
          </Panel>
          <Panel title="Register preparation drafts">
            <div className={styles.shortList}>
              {drafts.map(({ preparation, building, area, pkg }) => (
                <Link
                  key={preparation.id}
                  href={routes.workspace(building.id, area.id)}
                >
                  <Icon name="workspace" />
                  <span>
                    <strong>{building.name}</strong>
                    <small>
                      {pkg ? words(pkg.state) : "Preparation available"}
                    </small>
                  </span>
                  <Icon name="chevron" />
                </Link>
              ))}
            </div>
            {!drafts.length && !directory.loading && (
              <EmptyState
                title="No drafts in this selection"
                description="Create or resume a property workspace."
                action={
                  <Link className={styles.linkButton} href={routes.workspace()}>
                    Open Workspace
                  </Link>
                }
              />
            )}
          </Panel>
          <p className={styles.note}>
            Case and draft summaries cover recent properties and the first eight
            buildings in the selected block.
            {directory.failed
              ? ` ${directory.failed} record summaries are unavailable.`
              : ""}
          </p>
        </div>
      </div>
    </main>
  );
}
