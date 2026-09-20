"use client";
import { useState } from "react";
import { Badge, Button, EmptyState, Icon, formatNumber } from "../shared/ui";
import type { BlockController } from "./useBlock";
export default function FindingsTray({ block, onClose }: { block: BlockController; onClose?: () => void }) {
  const [filter, setFilter] = useState("all");
  const check = block.context.data?.latestCheck;
  const findings = check?.findings || [];
  const filtered = findings.filter(
    (f) => filter === "all" || f.category === filter,
  );
  const text = (message: string) =>
    [
      ...block.features,
      ...findings.flatMap((finding) => finding.participants || []),
    ].reduce(
      (value, feature) => value.replaceAll(feature.id, feature.name),
      message,
    );
  const title = (code: string) => {
    const label = code.replaceAll("_", " ").toLowerCase();
    return label.charAt(0).toUpperCase() + label.slice(1);
  };
  return (
    <section className="ui-findings-tray" aria-label="Block findings">
      <header>
        <div>
          <Icon name="warning" />
          <h2>Checks</h2>
          <Badge tone={findings.length ? "warning" : "neutral"}>
            {findings.length}
          </Badge>
          {check?.stale && <Badge tone="warning">Out of date</Badge>}
        </div>
        <nav aria-label="Finding filters">
          {["all", "geometric", "coverage", "document"].map((value) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === "all"
                ? "All"
                : value === "geometric"
                  ? "Geometry"
                  : value.charAt(0).toUpperCase() + value.slice(1)}
            </button>
          ))}
        </nav>
        <Button
          variant="ghost"
          icon="close"
          aria-label="Close findings"
          onClick={onClose || (() => block.setPreferences({ findingsOpen: false }))}
        />
      </header>
      {check?.stale && (
        <p className="ui-stale-check" role="status">
          Historical results. Run a check to update findings and map highlights.
        </p>
      )}
      <div className="ui-findings-list">
        {filtered.map((f) => (
          <button
            className="ui-finding"
            key={f.id}
            disabled={check?.stale}
            title={text(f.message)}
            aria-pressed={block.finding?.id === f.id}
            onClick={() => block.selectFinding(f.id)}
          >
            <span
              className={`ui-finding-icon ${f.category === "geometric" ? "ui-finding-icon--danger" : ""}`}
            >
              <Icon name={f.category === "geometric" ? "warning" : "info"} />
            </span>
            <span className="ui-finding-copy">
              <strong>{title(f.code)}</strong>
              <small>
                {f.featureIds
                  .map(
                    (id) =>
                      f.participants?.find((feature) => feature.id === id)
                        ?.name ||
                      block.features.find((feature) => feature.id === id)
                        ?.name ||
                      "Linked feature",
                  )
                  .join(" · ")}
              </small>
              {block.finding?.id === f.id && <small>{text(f.message)}</small>}
            </span>
            {f.areaM2 !== undefined ? (
              <b>
                {formatNumber(f.areaM2)} <small>m²</small>
              </b>
            ) : f.volumeM3 !== undefined ? (
              <b>
                {formatNumber(f.volumeM3)} <small>m³</small>
              </b>
            ) : (
              <Icon name="arrow" size={14} />
            )}
          </button>
        ))}
        {!filtered.length && (
          <EmptyState
            title={!check ? "No check yet" : "No findings in this filter"}
            description={
              !check
                ? "Run a check against the current block revision."
                : check.stale
                  ? "Run a current check before relying on this result."
                  : "This result covers only the supplied evidence and supported checks."
            }
            icon="check"
          />
        )}
      </div>
    </section>
  );
}
