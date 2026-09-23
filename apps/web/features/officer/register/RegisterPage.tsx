"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  AreaContext,
  AreaFinding,
  BuildingDossier,
} from "@ulpin/contracts";
import { useQueryState, useResource } from "../shared/hooks";
import { routes } from "../shared/routes";
import { useOfficerStore } from "../shared/store";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  type IconName,
} from "../shared/ui";
import ParcelIdentity from "../shared/ParcelIdentity";
import { hasGoogleAttribution } from "@/lib/map-attribution";
import Evidence, { SourcePreview } from "./Evidence";
import Investigation from "./Investigation";
import { words } from "./model";
import Overview from "./Overview";
import Floors from "./Floors";
import Issues from "./Issues";
import History from "./History";
import styles from "./register.module.css";
import ScopedExport from "../shared/ScopedExport";
import Packet0Action from "../../usp/shared/Packet0Action";

const tabs = [
  "overview",
  "floors",
  "evidence",
  "issues",
  "history",
  "investigation",
] as const;
type Tab = (typeof tabs)[number];
const navigation: { id: Tab; label: string; icon: IconName }[] = [
  { id: "floors", label: "Floors & spaces", icon: "layers" },
  { id: "overview", label: "Property details", icon: "building" },
  { id: "evidence", label: "Documents", icon: "document" },
  { id: "issues", label: "Checks", icon: "warning" },
  { id: "history", label: "History", icon: "history" },
  { id: "investigation", label: "Investigation", icon: "search" },
];

export default function RegisterPage({ buildingId }: { buildingId: string }) {
  const resource = useResource<BuildingDossier>(
      `/buildings/${encodeURIComponent(buildingId)}/dossier`,
    ),
    search = useSearchParams(),
    router = useRouter();
  const requestedArea = search.get("area") || search.get("areaId");
  const duplicateRecord = search.getAll("record").length > 1;
  const requestedRecord = duplicateRecord ? null : search.get("record");
  const validRequestedRecord = !duplicateRecord && resource.data?.records.some(
    (item) => item.id === requestedRecord,
  )
    ? requestedRecord
    : undefined;
  const membership = useResource<AreaContext>(
    requestedArea && resource.data && requestedArea !== resource.data.area.id
      ? `/areas/${encodeURIComponent(requestedArea)}/context`
      : null,
  );
  const [tab, setTab] = useQueryState(
      "tab",
      tabs,
      "floors",
    ),
    [selectedRecord, setSelectedRecord] = useState<string>(),
    [sourceId, setSourceId] = useState<string>(),
    [sourceDialog, setSourceDialog] = useState<string>(),
    [exportOpen, setExportOpen] = useState(false),
    [findingId, setFindingId] = useState<string>();
  const selectProperty = useOfficerStore((state) => state.selectProperty);
  const dossier = resource.data;
  const validatedArea = membership.data?.features.some(
    (item) => item.id === buildingId,
  )
    ? membership.data.area
    : undefined;
  const backArea = validatedArea || dossier?.area;
  useEffect(() => {
    if (dossier && backArea && !membership.loading)
      selectProperty({
        buildingId: dossier.canonicalBuildingId,
        areaId: backArea.id,
        name: dossier.building.name,
        identifier: dossier.building.identifier,
        areaName: backArea.name,
      });
  }, [dossier, backArea, selectProperty, membership.loading]);
  useEffect(() => {
    setSelectedRecord(validRequestedRecord || undefined);
    setSourceId(undefined);
    setSourceDialog(undefined);
    setFindingId(undefined);
  }, [buildingId, validRequestedRecord]);
  if (!dossier)
    return (
      <div className={styles.page}>
        {resource.error ? (
          <ErrorState
            message={resource.error}
            retry={() => void resource.reload()}
          />
        ) : (
          <LoadingState label="Opening property register" />
        )}
      </div>
    );
  if (dossier.canonicalBuildingId !== buildingId)
    return (
      <ErrorState
        message="The returned record does not match this property."
        retry={() => void resource.reload()}
      />
    );
  const selected = dossier.records.find(
    (record) => record.id === selectedRecord,
  );
  const source = dossier.sources.find((item) => item.id === sourceDialog);
  const openEvidence = (id?: string) => {
    setSourceId(id);
    setTab("evidence");
  };
  const backUrl =
    routes.block(backArea?.id, buildingId) +
    (validRequestedRecord
      ? `&record=${encodeURIComponent(validRequestedRecord)}`
      : "") +
    (validRequestedRecord && search.getAll("packet").length === 1 && search.get("packet")
      ? `&packet=${encodeURIComponent(search.get("packet")!)}` : "");
  const onMap = (finding?: AreaFinding) => {
    let url = backUrl;
    if (finding)
      url += `${url.includes("?") ? "&" : "?"}findingId=${encodeURIComponent(finding.id)}`;
    router.push(url);
  };
  const investigate = (id?: string) => {
    setFindingId(id);
    setTab("investigation");
  };
  const chooseRecord = (id: string, openFloors = false) => {
    if (id && !dossier.records.some((r) => r.id === id)) return;
    setSelectedRecord(id);
    const query = new URLSearchParams(search.toString());
    query.delete("packet");
    if (id) query.set("record", id);
    else {
      query.delete("record");
      query.set("tab", tab);
    }
    if (openFloors) query.set("tab", "floors");
    router.replace(
      `/studio/properties/${encodeURIComponent(buildingId)}/register?${query}`,
      { scroll: false },
    );
  };
  return (
    <main className={styles.page} data-register-building={buildingId}>
      <div className={styles.breadcrumb}>
        <Link href={backUrl}>
          <Icon name="back" /> {backArea?.name || "Block"} map
        </Link>
        <span className={styles.saved}>
          Saved locally · revision {dossier.building.revision}
        </span>
      </div>
      <header className={styles.propertyHeader}>
        <span className={styles.titleIcon}>
          <Icon name="register" size={27} />
        </span>
        <div className={styles.headerIdentity}>
          <div className={styles.titleLine}>
            <h1>{dossier.building.name}</h1>
            <Badge
              tone={
                dossier.building.worldStatus === "synthetic"
                  ? "warning"
                  : "neutral"
              }
            >
              {dossier.building.worldStatus === "synthetic"
                ? "Fictional demo"
                : words(dossier.building.worldStatus)}
            </Badge>
          </div>
          <p>
            <span className={styles.mono}>
              3D ULPIN: {dossier.building.identifier}
            </span>{" "}
            <span className={styles.dot}>·</span> Building register
          </p>
          <ParcelIdentity identifiers={dossier.parcelIdentifiers} />
          {hasGoogleAttribution([dossier.building]) && (
            <p>Reference outline: <a href="https://sites.research.google/gr/open-buildings/" target="_blank" rel="noreferrer">Google Open Buildings V3</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> (selection / road context) · ODbL. {dossier.building.worldStatus === "synthetic" && "Heights, interiors and occupants are fictional."}</p>
          )}
          {String(dossier.building.properties.source_provider || "").includes("OpenStreetMap") && (
            <p>
              Footprint source: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · ODbL.
              {dossier.building.worldStatus === "synthetic" && " Heights, rooms, residents and parcel links in this scenario are fictional."}
            </p>
          )}
        </div>
        <div className={styles.actions}>
          <Button
            icon="download"
            onClick={() => {
              setExportOpen(true);
            }}
          >
            Export register
          </Button>
          <Link
            className={styles.linkButton}
            href={routes.workspace(buildingId, backArea?.id)}
          >
            <Icon name="workspace" /> Prepare an update
          </Link>
        </div>
      </header>
      {resource.error && (
        <ErrorState
          message={resource.error}
          retry={() => void resource.reload()}
        />
      )}
      {(duplicateRecord || (requestedRecord && !validRequestedRecord)) && (
        <p className={styles.warning} role="alert">
          The supplied unit is not part of this property. Select a recorded unit before opening its evidence or packet.
        </p>
      )}
      {requestedArea &&
        requestedArea !== dossier.area.id &&
        !membership.loading &&
        !validatedArea && (
          <p className={styles.warning}>
            {membership.error
              ? "Block context could not be verified."
              : "This property is not a member of the requested block."}{" "}
            Returning to its recorded area.
          </p>
        )}
      <nav
        className={styles.tabNavigation}
        aria-label="Property register sections"
      >
        {navigation.map((item) => (
          <button
            key={item.id}
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => setTab(item.id)}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {item.id === "issues" && dossier.issues.length > 0 && (
              <b>{dossier.issues.length}</b>
            )}
            {item.id === "evidence" && <small>{dossier.sources.length}</small>}
          </button>
        ))}
      </nav>
      <div className={styles.registerLayout}>
        <div className={styles.content} key={`${buildingId}:${tab}`}>
          {tab === "overview" && (
            <Overview
              dossier={dossier}
              refreshing={resource.loading}
              onRefresh={resource.reload}
              onMap={() => onMap()}
              onRecord={(id) => {
                chooseRecord(id, true);
              }}
              onSource={setSourceDialog}
              onEvidence={openEvidence}
              onIssues={() => setTab("issues")}
              onHistory={() => setTab("history")}
            />
          )}
          {tab === "floors" && (
            <Floors
              dossier={dossier}
              selected={selected}
              onSelect={chooseRecord}
              onEvidence={setSourceDialog}
              workspaceUrl={routes.workspace(buildingId, backArea?.id)}
            />
          )}
          {tab === "evidence" && (
            <>
              {selected?.kind === "space" && <Packet0Action key={`${dossier.area.siteId}:${selected.id}@${selected.revision}`} dossier={dossier} record={selected} />}
              <Evidence dossier={dossier} initialSourceId={sourceId} />
            </>
          )}
          {tab === "issues" && (
            <Issues
              dossier={dossier}
              onMap={onMap}
              onInvestigate={investigate}
              onEvidence={setSourceDialog}
            />
          )}
          {tab === "history" && (
            <History dossier={dossier} onSource={setSourceDialog} />
          )}
          {tab === "investigation" && (
            <Investigation
              key={`${buildingId}:${search.get("case") || ""}:${findingId || ""}`}
              dossier={dossier}
              onRefresh={resource.reload}
              onMap={onMap}
              initialFindingId={findingId}
              initialCaseId={search.get("case") || undefined}
            />
          )}
        </div>
      </div>
      <Dialog
        open={exportOpen}
        title="Export property register"
        onClose={() => setExportOpen(false)}
      >
        <ScopedExport dossier={dossier} selectedId={selected?.id}/>
      </Dialog>
      <Dialog
        open={!!sourceDialog}
        title="Source evidence"
        onClose={() => setSourceDialog(undefined)}
      >
        {source ? (
          <SourcePreview source={source} dossier={dossier} />
        ) : (
          <EmptyState
            title="Source not available in this dossier"
            description="The source may belong to another retained record."
          />
        )}
      </Dialog>
    </main>
  );
}
