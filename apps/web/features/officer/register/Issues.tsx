"use client";
import { useState } from "react";
import { Badge, Button, EmptyState, Icon, Panel } from "../shared/ui";
import styles from "./register.module.css";
import type { AreaFinding, BuildingDossier } from "@ulpin/contracts";
import RegisterGeometry from "./Geometry";
import { number, words } from "./model";

export default function Issues({
  dossier,
  onMap,
  onInvestigate,
  onEvidence,
}: {
  dossier: BuildingDossier;
  onMap: (finding: AreaFinding) => void;
  onInvestigate: (id?: string) => void;
  onEvidence: (id: string) => void;
}) {
  const [type, setType] = useState("all"),
    [status, setStatus] = useState("all"),
    [selected, setSelected] = useState<string>();
  const issueStatus = (id: string) =>
    dossier.investigations.find((item) =>
      item.findings.some((finding) => finding.id === id),
    )?.status || "UNASSIGNED";
  const issues = dossier.issues.filter(
    (item) =>
      (type === "all" || item.category === type) &&
      (status === "all" || issueStatus(item.id) === status),
  );
  const current = issues.find((item) => item.id === selected);
  return (
    <>
      <div className={styles.tabTitle}>
        <div>
          <h2>Issues & discrepancies</h2>
          <p>Latest technical check · quantities are per finding</p>
        </div>
        <Button onClick={() => onInvestigate()}>Open investigation</Button>
      </div>
      <div className={styles.filters}>
        <label>
          Type
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="all">All types</option>
            {[...new Set(dossier.issues.map((item) => item.category))].map(
              (value) => (
                <option key={value} value={value}>
                  {words(value)}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          Case status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">Any status</option>
            {[
              ...new Set(dossier.issues.map((item) => issueStatus(item.id))),
            ].map((value) => (
              <option key={value} value={value}>
                {words(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Severity
          <select defaultValue="unrated">
            <option value="unrated">Not rated by source</option>
          </select>
        </label>
      </div>
      {dossier.check?.stale && (
        <p className={styles.warning}>
          The check is stale. Rerun checks in the block before starting a
          current discrepancy review.
        </p>
      )}
      <div className={styles.issuesGrid}>
        <Panel
          title={
            dossier.check?.stale
              ? "Current findings unavailable"
              : `${issues.length} findings`
          }
        >
          {issues.length ? (
            issues.map((issue) => (
              <button
                className={styles.issueRow}
                key={issue.id}
                aria-pressed={current?.id === issue.id}
                onClick={() => setSelected(issue.id)}
              >
                <Icon
                  name={issue.category === "coverage" ? "info" : "warning"}
                  size={23}
                />
                <span>
                  <strong>{issue.message}</strong>
                  <small>{issue.code}</small>
                  <span className={styles.actions}>
                    <Badge tone="warning">{words(issue.category)}</Badge>
                    <Badge tone="neutral">
                      {issueStatus(issue.id) === "UNASSIGNED"
                        ? "No investigation"
                        : `Case: ${words(issueStatus(issue.id))}`}
                    </Badge>
                  </span>
                </span>
                <b>
                  {issue.areaM2 !== undefined
                    ? number(issue.areaM2, "m²")
                    : issue.volumeM3 !== undefined
                      ? number(issue.volumeM3, "m³")
                      : "›"}
                </b>
              </button>
            ))
          ) : (
            <EmptyState
              title={
                dossier.check?.stale
                  ? "Check needs updating"
                  : dossier.issues.length
                    ? "No matching findings"
                    : dossier.check
                      ? "No current findings"
                      : "Not checked yet"
              }
              description={
                dossier.check
                  ? "This does not certify ownership, safety or statutory compliance."
                  : "Run a technical check from the block."
              }
            />
          )}
        </Panel>
        {current && (
          <Panel title="Finding detail">
            <RegisterGeometry dossier={dossier} finding={current} compact />
            <div className={styles.findingDetail}>
              <h3>{current.message}</h3>
              <p>
                {current.method || "See the retained check for method details."}
              </p>
              {current.limitations?.map((limitation, index) => (
                <p className={styles.note} key={index}>
                  {limitation}
                </p>
              ))}
              <div className={styles.actions}>
                <Button onClick={() => onMap(current)} icon="map">
                  View on map
                </Button>
                <Button
                  variant="primary"
                  onClick={() => onInvestigate(current.id)}
                >
                  Investigate
                </Button>
              </div>
              {current.evidence?.map((value, index) => (
                <Button
                  key={index}
                  variant="ghost"
                  onClick={() => onEvidence(value.sourceRevisionId)}
                  icon="document"
                >
                  Source {index + 1}
                </Button>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}
