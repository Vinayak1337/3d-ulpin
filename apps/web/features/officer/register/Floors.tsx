"use client";
import { useState } from "react";
import { Badge, Button, EmptyState, Icon, Panel } from "../shared/ui";
import styles from "./register.module.css";
import Link from "next/link";
import type { BuildingDossier, RegistryRecord } from "@ulpin/contracts";
import RegisterGeometry from "./Geometry";
import PropertyScene from "../scene/PropertyScene";
import { number, words, recordEvidence } from "./model";

export default function Floors({
  dossier,
  selected,
  onSelect,
  onEvidence,
  workspaceUrl,
}: {
  dossier: BuildingDossier;
  selected?: RegistryRecord;
  onSelect: (id: string) => void;
  onEvidence: (id: string) => void;
  workspaceUrl: string;
}) {
  const [query, setQuery] = useState("");
  const floorId =
    selected?.kind === "floor"
      ? selected.id
      : selected?.links.find((link) => link.type === "floor")?.targetId ||
        "all";
  const floors = dossier.records.filter((item) => item.kind === "floor"),
    spaces = dossier.records.filter((item) => item.kind === "space");
  const rows = spaces.filter(
    (item) =>
      (floorId === "all" ||
        item.links.some(
          (link) => link.type === "floor" && link.targetId === floorId,
        )) &&
      `${item.name} ${item.identifier} ${item.rights.map((right) => right.party).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const evidence = selected ? recordEvidence(dossier, selected) : [];
  const hasParties = spaces.some((record) => record.rights.length > 0);
  return (
    <>
      {!spaces.length ? (
        <Panel>
          <RegisterGeometry dossier={dossier} />
          <EmptyState
            title="Interior records not supplied"
            description="This building has an exterior record. Add reviewed plans and levels to prepare its floors and units."
            action={
              <Link
                className={`${styles.linkButton} ${styles.linkPrimary}`}
                href={workspaceUrl}
              >
                Prepare building details
              </Link>
            }
          />
        </Panel>
      ) : (
        <div className={styles.floorsGrid}>
          <Panel title="Recorded model">
            <PropertyScene
              dossier={dossier}
              selectedId={selected?.id}
              onSelect={onSelect}
            />
            <div className={styles.floorChips}>
              <button
                aria-pressed={floorId === "all"}
                onClick={() => onSelect("")}
              >
                All floors <b>{spaces.length}</b>
              </button>
              {floors.map((floor) => (
                <button
                  key={floor.id}
                  aria-pressed={floorId === floor.id}
                  onClick={() => {
                    onSelect(floor.id);
                  }}
                >
                  {floor.name.replace(/^property\s*\/\s*/i, "")}
                  <b>
                    {
                      spaces.filter((space) =>
                        space.links.some(
                          (link) =>
                            link.type === "floor" && link.targetId === floor.id,
                        ),
                      ).length
                    }
                  </b>
                </button>
              ))}
            </div>
          </Panel>
          <div className={styles.stack}>
            <Panel title="Floors & spaces">
              {hasParties && (
                <p className={styles.note}>
                  {spaces.every((record) => record.synthetic)
                    ? "Fictional resident / shared-use entries. These are not actual occupants, owners or registered deeds."
                    : "Source-recorded party claims. Geometry alone does not establish occupancy or ownership."}
                </p>
              )}
              <div className={styles.filters}>
                <input
                  aria-label="Search units"
                  placeholder="Search unit, identifier or recorded party"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Unit / 3D ULPIN</th>
                      <th>Area</th>
                      <th>Levels</th>
                      <th>Use</th>
                      {hasParties && <th>Recorded party</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((record) => (
                      <tr
                        key={record.id}
                        data-selected={selected?.id === record.id}
                      >
                        <td>
                          <button onClick={() => onSelect(record.id)}>
                            <strong>{record.name}</strong>
                            <small className={styles.mono}>
                              {record.identifier}
                            </small>
                          </button>
                        </td>
                        <td>{number(record.geometry?.area, "m²")}</td>
                        <td>
                          {record.geometry
                            ? `${number(record.geometry.lower)}–${number(record.geometry.upper)} m`
                            : "Not supplied"}
                        </td>
                        <td>{words(record.use || "unspecified")}</td>
                        {hasParties && (
                          <td>{record.rights.map((right) => right.party).join("; ") || "Not recorded"}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!rows.length && <EmptyState title="No matching units" />}
            </Panel>
            {selected && (
              <Panel
                title={selected.name}
                actions={
                  <Badge>
                    {words(selected.kind)} · rev {selected.revision}
                  </Badge>
                }
              >
                <div className={styles.unitDetail}>
                  <h3>Source evidence</h3>
                  {evidence.length ? (
                    evidence.map(({ source, locator }, index) => (
                      <Button
                        key={index}
                        variant="ghost"
                        onClick={() => onEvidence(source.id)}
                        icon="document"
                      >
                        {source.name} · {locator}
                      </Button>
                    ))
                  ) : (
                    <p className={styles.note}>
                      No source available in this dossier.
                    </p>
                  )}
                  <details className={styles.recordDetails}><summary>Record details, rights & downloads</summary>
                  <dl>
                    <div>
                      <dt>3D ULPIN</dt>
                      <dd className={styles.mono}>{selected.identifier}</dd>
                    </div>
                    {selected.geometry && (
                      <>
                        <div>
                          <dt>Recorded area</dt>
                          <dd>{number(selected.geometry.area, "m²")}</dd>
                        </div>
                        <div>
                          <dt>Volume</dt>
                          <dd>{number(selected.geometry.volume, "m³")}</dd>
                        </div>
                        <div>
                          <dt>Lower / upper</dt>
                          <dd>
                            {number(selected.geometry.lower, "m")} /{" "}
                            {number(selected.geometry.upper, "m")}
                          </dd>
                        </div>
                      </>
                    )}
                  </dl>
                  <p className={styles.note}>Level reference: {dossier.detailedScene.find(item => item.record.id === selected.id)?.verticalReference || dossier.area.reference?.verticalReference || "Not supplied"}</p>
                  {selected.rights.length > 0 && (
                    <section aria-label="Recorded parties and source evidence">
                      <h3>{selected.synthetic ? "Fictional residents / shared use" : "Recorded parties / claims"}</h3>
                      {selected.rights.map((right, index) => (
                        <div key={`${right.party}:${index}`}>
                          <strong>{right.party}</strong>
                          <p className={styles.note}>{words(right.type)} · {selected.synthetic ? "Fictional demonstration, not an actual resident or ownership right." : "A recorded claim, not an ownership determination."}</p>
                          <p className={styles.note}>{right.evidence.locator}</p>
                          {dossier.sources.some((source) => source.id === right.evidence.sourceId) && (
                            <Button variant="ghost" icon="document" onClick={() => onEvidence(right.evidence.sourceId)}>
                              View party source evidence
                            </Button>
                          )}
                        </div>
                      ))}
                    </section>
                  )}
                  <div className={styles.scopeDownloads}>
                    <a
                      className="ui-button"
                      href={`/api/v1/buildings/${dossier.building.id}/register?format=pdf&record=${selected.id}`}
                    >
                      <Icon name="download" />
                      Download {selected.kind === "floor"
                        ? "floor"
                        : "unit"}{" "}
                      PDF
                    </a>
                    <a
                      className="ui-button"
                      href={`/api/v1/buildings/${dossier.building.id}/register?format=zip&record=${selected.id}`}
                    >
                      <Icon name="download" />
                      Report + original sources
                    </a>
                  </div>

                  </details>
                </div>
              </Panel>
            )}
          </div>
        </div>
      )}
    </>
  );
}
