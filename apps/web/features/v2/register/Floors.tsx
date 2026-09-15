"use client";
import { useState } from "react";
import { Badge, Button, EmptyState, Icon, Panel } from "../shared/ui";
import styles from "./register.module.css";
import Link from "next/link";
import type { BuildingDossier, RegistryRecord } from "@ulpin/contracts";
import RegisterGeometry from "./Geometry";
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
  const [floorId, setFloorId] = useState("all"),
    [query, setQuery] = useState("");
  const floors = dossier.records.filter((item) => item.kind === "floor"),
    spaces = dossier.records.filter((item) => item.kind === "space");
  const rows = spaces.filter(
    (item) =>
      (floorId === "all" ||
        item.links.some(
          (link) => link.type === "floor" && link.targetId === floorId,
        )) &&
      `${item.name} ${item.identifier}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const evidence = selected ? recordEvidence(dossier, selected) : [];
  return (
    <>
      <div className={styles.tabTitle}>
        <div>
          <h2>Floors & Units</h2>
          <p>Recorded interior boundaries and source levels</p>
        </div>
        <Link className={styles.linkButton} href={workspaceUrl}>
          <Icon name="workspace" /> Open Workspace
        </Link>
      </div>
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
          <Panel title="Building geometry">
            <RegisterGeometry
              dossier={dossier}
              selectedId={selected?.id}
              onSelect={onSelect}
            />
            <div className={styles.floorChips}>
              <button
                aria-pressed={floorId === "all"}
                onClick={() => setFloorId("all")}
              >
                All floors <b>{spaces.length}</b>
              </button>
              {floors.map((floor) => (
                <button
                  key={floor.id}
                  aria-pressed={floorId === floor.id}
                  onClick={() => {
                    setFloorId(floor.id);
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
            <Panel title="Unit register">
              <div className={styles.filters}>
                <input
                  aria-label="Search units"
                  placeholder="Search unit name or identifier"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Unit / space</th>
                      <th>Area</th>
                      <th>Levels</th>
                      <th>Use</th>
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
                  <dl>
                    <div>
                      <dt>Identifier</dt>
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
                </div>
              </Panel>
            )}
          </div>
        </div>
      )}
    </>
  );
}
