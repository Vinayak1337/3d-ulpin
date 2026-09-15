"use client";
import { useState } from "react";
import { Badge, Button, EmptyState, Icon, Panel } from "../shared/ui";
import styles from "./register.module.css";
import type { BuildingDossier } from "@ulpin/contracts";
import { dateTime, historyEntries } from "./model";

export default function History({
  dossier,
  onSource,
}: {
  dossier: BuildingDossier;
  onSource: (id: string) => void;
}) {
  const [filter, setFilter] = useState("All");
  const entries = historyEntries(dossier).filter(
    (item) => filter === "All" || item.type === filter,
  );
  return (
    <>
      <div className={styles.tabTitle}>
        <div>
          <h2>Property history</h2>
          <p>Source receipt, evidence review and case decisions</p>
        </div>
        <select
          aria-label="History type"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          {["All", "Sources", "Reviews", "Associations", "Investigations"].map(
            (value) => (
              <option key={value}>{value}</option>
            ),
          )}
        </select>
      </div>
      <Panel>
        <div className={styles.revisionBar}>
          <span>
            Building <b>rev {dossier.revisions.feature}</b>
          </span>
          <span>
            Block <b>rev {dossier.revisions.area}</b>
          </span>
          <span>
            Register <b>rev {dossier.revisions.registry}</b>
          </span>
        </div>
        {entries.length ? (
          <ol className={styles.timeline}>
            {entries.map((entry) => (
              <li key={entry.id}>
                <span className={styles.timelineDot} />
                <div>
                  <div className={styles.actions}>
                    <strong>{entry.title}</strong>
                    <Badge>{entry.type}</Badge>
                  </div>
                  <p>{entry.detail}</p>
                  <small>
                    {dateTime(entry.time)}
                    {"actor" in entry ? ` · ${entry.actor}` : ""}
                  </small>
                  {"sourceId" in entry && (
                    <Button
                      variant="ghost"
                      onClick={() => onSource(entry.sourceId)}
                    >
                      Open source ↗
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            title="No dated events yet"
            description="Current revision numbers remain visible above."
          />
        )}
      </Panel>
    </>
  );
}
