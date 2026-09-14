"use client";
import { useEffect, useRef, useState } from "react";
import type {
  AreaFinding,
  BuildingDossier,
  PhysicalFeature,
  PreparationCase,
  RegistryRecord,
} from "@ulpin/contracts";
import { registryRequest as request } from "@/lib/registry-client";
import DocumentPreparation from "./DocumentPreparation";
import InvestigationPanel from "./InvestigationPanel";
import { retainOfficerContext } from "./OfficerNavigation";

export type PropertyPanelMode =
  "register" | "evidence" | "prepare" | "investigation";
export default function PropertyDossierPanel({
  building,
  initialMode = "register",
  initialRecordId,
  refreshKey,
  checkId,
  onDossier,
  onDetail,
  onInspect,
  onFocus,
}: {
  building: PhysicalFeature;
  initialMode?: PropertyPanelMode;
  initialRecordId?: string;
  refreshKey?: number;
  checkId?: string;
  onDossier: (dossier: BuildingDossier | null) => void;
  onDetail: (record: RegistryRecord | null) => void;
  onInspect: (finding: AreaFinding) => void;
  onFocus: () => void;
}) {
  const [dossier, setDossier] = useState<BuildingDossier | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [mode, setMode] = useState<PropertyPanelMode>(initialMode),
    [busy, setBusy] = useState(""),
    [revision, setRevision] = useState(0),
    [preparation, setPreparation] = useState<PreparationCase | null>(null),
    [selectedRecord, setSelectedRecord] = useState<string | null>(null),
    [source, setSource] = useState<string | null>(null);
  const callbacks = useRef({ onDossier, onDetail });
  callbacks.current = { onDossier, onDetail };
  const currentId = useRef(building.id);
  currentId.current = building.id;
  const preparationKeys = useRef(new Map<string, string>());
  useEffect(() => {
    setMode(initialMode);
    setSelectedRecord(null);
    setPreparation(null);
    callbacks.current.onDetail(null);
  }, [building.id, initialMode]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    setDossier(null);
    callbacks.current.onDossier(null);
    fetch(`/api/v1/buildings/${building.id}/dossier`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error?.message || "Property register is unavailable.",
          );
        return result as BuildingDossier;
      })
      .then((result) => {
        if (!active || result.canonicalBuildingId !== currentId.current) return;
        setDossier(result);
        if (initialRecordId) {
          const record = result.records.find(
            (item) => item.id === initialRecordId,
          );
          if (record) {
            setSelectedRecord(record.id);
            callbacks.current.onDetail(record);
          }
        }
        setPreparation(result.preparations[0] || null);
        callbacks.current.onDossier(result);
        retainOfficerContext({
          buildingId: building.id,
          areaId: building.areaId,
          caseId: result.preparations[0]?.caseId,
        });
      })
      .catch((cause) => {
        if (active && cause.name !== "AbortError") setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [building.id, building.revision, refreshKey, revision]);
  const refresh = () => setRevision((value) => value + 1);
  const openPreparation = async () => {
    setMode("prepare");
    if (preparation) return;
    setBusy("Opening this building’s preparation…");
    setError("");
    const id = building.id;
    let key = preparationKeys.current.get(id);
    if (!key) {
      key = crypto.randomUUID();
      preparationKeys.current.set(id, key);
    }
    try {
      const result = await request<PreparationCase>(
        `/buildings/${id}/preparation-cases`,
        { requestKey: key, expectedRevision: building.revision },
      );
      if (currentId.current === id) {
        setPreparation(result);
        retainOfficerContext({
          buildingId: id,
          areaId: building.areaId,
          caseId: result.caseId,
        });
      }
    } catch (cause) {
      if (currentId.current === id)
        setError(
          cause instanceof Error
            ? cause.message
            : "Preparation is unavailable.",
        );
    } finally {
      if (currentId.current === id) setBusy("");
    }
  };
  const floors =
      dossier?.records.filter((record) => record.kind === "floor") || [],
    spaces = dossier?.records.filter((record) => record.kind === "space") || [];
  return (
    <div className="property-dossier" data-building-id={building.id}>
      <div className="property-heading">
        <span className="area-eyebrow">
          {building.worldStatus} ·{" "}
          {building.geometryRole?.replaceAll("_", " ") || "building exterior"}
        </span>
        <h2>{building.name}</h2>
        <p className="property-short-id">{building.identifier}</p>
      </div>
      <div className="property-mode-tabs" aria-label="Selected property">
        <button
          aria-pressed={mode === "register"}
          onClick={() => {
            setMode("register");
            refresh();
          }}
        >
          Register
        </button>
        <button
          aria-pressed={mode === "evidence"}
          onClick={() => setMode("evidence")}
        >
          Evidence
        </button>
        <button
          aria-pressed={mode === "prepare"}
          onClick={() => void openPreparation()}
        >
          Prepare
        </button>
        <button
          aria-pressed={mode === "investigation"}
          onClick={() => setMode("investigation")}
        >
          Investigate
        </button>
      </div>
      {error && (
        <div className="area-warning" role="alert">
          {error}
          <button onClick={refresh}>Retry</button>
        </div>
      )}
      {busy && <p role="status">{busy}</p>}
      {loading ? (
        <div className="property-loading" role="status">
          <span />
          <p>Opening this property’s register…</p>
        </div>
      ) : (
        dossier && (
          <>
            {mode === "register" && (
              <>
                <dl className="property-summary">
                  <div>
                    <dt>Footprint</dt>
                    <dd>
                      {building.areaM2 === null
                        ? "—"
                        : `${building.areaM2.toLocaleString(undefined, { maximumFractionDigits: 1 })} m²`}
                    </dd>
                  </div>
                  <div>
                    <dt>Exterior height</dt>
                    <dd>
                      {building.height.value === null
                        ? "Not supplied"
                        : `${building.height.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} m`}
                    </dd>
                  </div>
                  <div>
                    <dt>Detailed spaces</dt>
                    <dd>{spaces.length || "Not supplied"}</dd>
                  </div>
                </dl>
                <div className="property-action-row">
                  <button onClick={onFocus}>Focus property</button>
                  <button
                    className="area-primary"
                    disabled={!!busy || building.revision === 0}
                    onClick={() => void openPreparation()}
                  >
                    Add plans to this building
                  </button>
                </div>
                <h3>Parcels</h3>
                {!dossier.parcels.length ? (
                  <p className="property-empty">
                    No parcel association has been supplied. A nearby polygon is
                    not a confirmed property boundary.
                  </p>
                ) : (
                  dossier.parcels.map(({ feature, association, status }) => (
                    <div className="property-relationship" key={feature.id}>
                      <strong>{feature.name}</strong>
                      <span>
                        {status === "confirmed"
                          ? "Confirmed association"
                          : "Spatial candidate · needs evidence"}
                      </span>
                      <small>{feature.identifier}</small>
                      {association?.reason && <p>{association.reason}</p>}
                      {status !== "confirmed" && (
                        <details>
                          <summary>Confirm with evidence</summary>
                          <form
                            className="officer-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const data = new FormData(event.currentTarget),
                                source = dossier.sources.find(
                                  (item) => item.id === data.get("source"),
                                );
                              if (!source) return;
                              setBusy("Recording parcel association…");
                              setError("");
                              void request("/property-associations", {
                                ...(association ? { id: association.id } : {}),
                                fromId: building.id,
                                toId: feature.id,
                                relationship: "occupies_parcel",
                                status: "confirmed",
                                expectedRevision: association?.revision ?? 0,
                                expectedFromRevision: building.revision,
                                expectedToRevision: feature.revision,
                                evidence: source.evidence.length
                                  ? source.evidence
                                  : [{ sourceRevisionId: source.id }],
                                reason: String(data.get("reason")),
                              })
                                .then(refresh)
                                .catch((cause) => setError(cause.message))
                                .finally(() => setBusy(""));
                            }}
                          >
                            <label>
                              Source supporting this association
                              <select name="source" required>
                                {dossier.sources.map((source) => (
                                  <option key={source.id} value={source.id}>
                                    {source.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Association reason
                              <input
                                name="reason"
                                required
                                placeholder="Explain how this source links the building and parcel"
                              />
                            </label>
                            <button
                              disabled={!!busy || !dossier.sources.length}
                            >
                              Confirm association
                            </button>
                          </form>
                        </details>
                      )}
                    </div>
                  ))
                )}
                <h3>Floors and spaces</h3>
                {!spaces.length ? (
                  <div className="property-empty">
                    <p>
                      This building has an exterior record. No supported
                      interior spaces have been linked yet.
                    </p>
                    <button
                      disabled={!!busy || building.revision === 0}
                      onClick={() => void openPreparation()}
                    >
                      Prepare 3D details
                    </button>
                  </div>
                ) : (
                  <div className="property-record-tree">
                    <button
                      className="property-tree-root"
                      onClick={() => {
                        setSelectedRecord(null);
                        onDetail(null);
                      }}
                    >
                      All detailed spaces <span>{spaces.length}</span>
                    </button>
                    {floors.map((floor) => (
                      <div key={floor.id} className="property-floor">
                        <button
                          aria-pressed={selectedRecord === floor.id}
                          onClick={() => {
                            setSelectedRecord(floor.id);
                            onDetail(floor);
                          }}
                        >
                          {floor.name.replace(/^property\s*\/\s*/i, "")}
                        </button>
                        {spaces
                          .filter((space) =>
                            space.links.some(
                              (link) =>
                                link.type === "floor" &&
                                link.targetId === floor.id,
                            ),
                          )
                          .map((space) => (
                            <button
                              className="property-space"
                              aria-pressed={selectedRecord === space.id}
                              key={space.id}
                              onClick={() => {
                                setSelectedRecord(space.id);
                                onDetail(space);
                              }}
                            >
                              {space.name}
                              <small>{space.identifier}</small>
                            </button>
                          ))}
                      </div>
                    ))}
                    {spaces
                      .filter(
                        (space) =>
                          !space.links.some(
                            (link) =>
                              link.type === "floor" &&
                              floors.some(
                                (floor) => floor.id === link.targetId,
                              ),
                          ),
                      )
                      .map((space) => (
                        <button
                          className="property-space"
                          aria-pressed={selectedRecord === space.id}
                          key={space.id}
                          onClick={() => {
                            setSelectedRecord(space.id);
                            onDetail(space);
                          }}
                        >
                          {space.name}
                          <small>{space.identifier}</small>
                        </button>
                      ))}
                    {selectedRecord && (
                      <div className="property-record-evidence">
                        {dossier.records
                          .find((record) => record.id === selectedRecord)
                          ?.evidence.map((binding, index) => (
                            <a
                              key={index}
                              href={`/api/v1/sources/${binding.sourceId}/file`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {binding.locator} ↗
                            </a>
                          ))}
                      </div>
                    )}
                  </div>
                )}
                {!!dossier.groups.length && (
                  <details>
                    <summary>Block memberships</summary>
                    {dossier.groups.map((group) => (
                      <p key={group.id}>
                        {group.name} · {group.kind.replaceAll("_", " ")}
                      </p>
                    ))}
                  </details>
                )}
                {!!dossier.issues.length && (
                  <>
                    <h3>Issues for this property · {dossier.issues.length}</h3>
                    {dossier.issues.map((finding) => (
                      <button
                        className="area-finding"
                        key={finding.id}
                        onClick={() => onInspect(finding)}
                      >
                        <strong>{finding.message}</strong>
                        {finding.areaM2 !== undefined && (
                          <span>
                            {finding.areaM2.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}{" "}
                            m²
                          </span>
                        )}
                      </button>
                    ))}
                  </>
                )}
                <details>
                  <summary>Register exports and revisions</summary>
                  <div className="property-action-row">
                    {["json", "csv", "html"].map((format) => (
                      <a
                        key={format}
                        href={`/api/v1/buildings/${building.id}/register?format=${format}`}
                        target={format === "html" ? "_blank" : undefined}
                        rel="noreferrer"
                      >
                        {format === "html"
                          ? "Print / save PDF"
                          : format.toUpperCase()}{" "}
                        ↗
                      </a>
                    ))}
                  </div>
                  <p className="area-note">
                    Property revision {dossier.revisions.feature} · block
                    revision {dossier.revisions.area} · registry revision{" "}
                    {dossier.revisions.registry}
                  </p>
                </details>
              </>
            )}
            {mode === "evidence" && (
              <>
                <h3>Original property evidence</h3>
                {!dossier.sources.length && (
                  <p className="property-empty">
                    No originals are linked to this property yet.
                  </p>
                )}
                {dossier.sources.map((item) => (
                  <div className="property-source" key={item.id}>
                    <button onClick={() => setSource(item.url)}>
                      <strong>{item.name}</strong>
                      <span>Open original ↗</span>
                    </button>
                    <small>
                      Source revision {item.revision} ·{" "}
                      {new Date(item.createdAt).toLocaleDateString()}
                    </small>
                    {item.evidence.map((locator, index) => (
                      <p className="area-note" key={index}>
                        {locator.page
                          ? `Page ${locator.page}`
                          : locator.row
                            ? `Row ${locator.row}`
                            : locator.featureId
                              ? `Feature ${locator.featureId}`
                              : locator.partId
                                ? "Associated document part"
                                : "Original source"}
                      </p>
                    ))}
                  </div>
                ))}
                <details>
                  <summary>Meaning and measurement limits</summary>
                  <p>{building.height.meaning}</p>
                  <p className="area-note">
                    {building.height.reference} ·{" "}
                    {building.height.state.replaceAll("_", " ")}
                  </p>
                  {dossier.missing.map((missing, index) => (
                    <p key={index}>{missing}</p>
                  ))}
                </details>
              </>
            )}
            {mode === "prepare" &&
              (preparation ? (
                <DocumentPreparation
                  key={preparation.id}
                  preparation={preparation}
                  building={building}
                  onRefresh={() => {
                    /* The Register action refreshes the committed dossier without discarding draft forms. */
                  }}
                />
              ) : (
                <div className="property-empty">
                  <p>
                    Open a preparation linked to this permanent building ID.
                  </p>
                  <button
                    disabled={!!busy || building.revision === 0}
                    className="area-primary"
                    onClick={() => void openPreparation()}
                  >
                    Open building preparation
                  </button>
                </div>
              ))}
            {mode === "investigation" && (
              <InvestigationPanel
                checkId={checkId}
                key={building.id}
                dossier={dossier}
                onRefresh={refresh}
                onInspect={onInspect}
              />
            )}
          </>
        )
      )}
      {source && (
        <div className="property-source-overlay">
          <header>
            <strong>Original property source</strong>
            <button
              aria-label="Close source preview"
              onClick={() => setSource(null)}
            >
              ×
            </button>
          </header>
          <iframe src={source} title="Original property source" />
          <a href={source} target="_blank" rel="noreferrer">
            Open source in new tab ↗
          </a>
        </div>
      )}
    </div>
  );
}
