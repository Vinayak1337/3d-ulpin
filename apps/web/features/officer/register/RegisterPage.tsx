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
import Evidence, { SourcePreview } from "./Evidence";
import Investigation from "./Investigation";
import PropertyScene from "../scene/PropertyScene";
import { number, words } from "./model";
import Overview from "./Overview";
import Floors from "./Floors";
import Issues from "./Issues";
import History from "./History";
import styles from "./register.module.css";

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
  { id: "overview", label: "Overview", icon: "building" },
  { id: "floors", label: "Floors & Units", icon: "layers" },
  { id: "evidence", label: "Evidence", icon: "document" },
  { id: "issues", label: "Issues", icon: "warning" },
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
  const requestedRecord = search.get("record");
  const validRequestedRecord = resource.data?.records.some(
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
      validRequestedRecord ? "floors" : "overview",
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
      : "");
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
    if (id) query.set("record", id);
    else {
      query.delete("record");
      query.set("tab", tab);
    }
    if (openFloors) query.set("tab", "floors");
    router.replace(
      `/properties/${encodeURIComponent(buildingId)}/register?${query}`,
      { scroll: false },
    );
  };
  const parcelCount = dossier.parcels.filter(
    (parcel) => parcel.status === "confirmed",
  ).length;
  return (
    <main className={styles.page} data-register-building={buildingId}>
      <div className={styles.breadcrumb}>
        <Link href={backUrl}>
          <Icon name="back" /> Back to Block
        </Link>
        <span>/</span>
        <span>{backArea?.name}</span>
        <span>/</span>
        <strong>{dossier.building.name}</strong>
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
            <span className={styles.mono}>{dossier.building.identifier}</span>{" "}
            <span className={styles.dot}>·</span> Building register
          </p>
        </div>
        <div className={styles.actions}>
          <Button icon="download" onClick={() => setExportOpen(true)}>
            Export register
          </Button>
          <Link
            className={`${styles.linkButton} ${styles.linkPrimary}`}
            href={routes.workspace(buildingId, backArea?.id)}
          >
            <Icon name="workspace" /> Open Workspace
          </Link>
        </div>
      </header>
      {resource.error && (
        <ErrorState
          message={resource.error}
          retry={() => void resource.reload()}
        />
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
        <aside className={styles.sidebar}>
          <div className={styles.identityCard}>
            <PropertyScene dossier={dossier} compact />
            <div>
              <small>Property record</small>
              <strong>{dossier.building.name}</strong>
              <span>{dossier.building.sourceKey}</span>
            </div>
          </div>

          <div className={styles.sidebarFacts}>
            <div>
              <span>Building footprint</span>
              <strong>{number(dossier.building.areaM2, "m²")}</strong>
            </div>
            <div>
              <span>Exterior height</span>
              <strong>{number(dossier.building.height.value, "m")}</strong>
            </div>
            <div>
              <span>Parcel linkage</span>
              <strong>
                {parcelCount ? `${parcelCount} confirmed` : "Not confirmed"}
              </strong>
            </div>
          </div>
          <Link className={styles.sidebarMap} href={backUrl}>
            <Icon name="map" /> View in block <Icon name="arrow" />
          </Link>
        </aside>
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
            <Evidence dossier={dossier} initialSourceId={sourceId} />
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
        <p className={styles.note}>
          {dossier.building.name} · current recorded revision
        </p>
        <div className={styles.exportOptions}>
          {["json", "csv", "html"].map((format) => (
            <a
              key={format}
              href={`/api/v1/buildings/${buildingId}/register?format=${format}`}
              target={format === "html" ? "_blank" : undefined}
              rel="noreferrer"
            >
              <Icon
                name={format === "html" ? "document" : "download"}
                size={25}
              />
              <strong>
                {format === "html" ? "Print / save PDF" : format.toUpperCase()}
              </strong>
              <span>
                {format === "html"
                  ? "Plan, section and register report"
                  : format === "json"
                    ? "Structured register and evidence"
                    : "Tabular records and source references"}
              </span>
            </a>
          ))}
        </div>
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
