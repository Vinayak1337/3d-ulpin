"use client";
import { useState } from "react";
import { useDebouncedValue, useResource } from "../shared/hooks";
import type { ResolveMatch } from "../shared/SearchDialog";
import { useV2Store } from "../shared/store";
import { EmptyState, ErrorState, Icon, LoadingState } from "../shared/ui";
import styles from "./Workspace.module.css";
export type PropertyChoice = {
  buildingId: string;
  areaId: string;
  name: string;
  identifier: string;
};
export default function PropertyChooser({
  onChoose,
}: {
  onChoose: (property: PropertyChoice) => void;
}) {
  const [query, setQuery] = useState("");
  const settled = useDebouncedValue(query.trim());
  const recent = useV2Store((s) => s.recentProperties);
  const result = useResource<{ matches: ResolveMatch[] }>(
    settled ? `/resolve?identifier=${encodeURIComponent(settled)}` : null,
  );
  const matches: PropertyChoice[] = settled
    ? (result.data?.matches || []).flatMap((match) => {
        const buildingId =
          match.canonicalBuildingId ||
          match.buildingId ||
          (match.feature?.kind === "building" ? match.feature.id : undefined);
        const areaId = match.areaIds[0] || match.feature?.areaId;
        return buildingId && areaId
          ? [
              {
                buildingId,
                areaId,
                name: match.feature?.name || "Linked property",
                identifier: match.feature?.identifier || buildingId,
              },
            ]
          : [];
      })
    : recent;
  return (
    <div className={styles.chooser}>
      <label className={styles.field}>
        Property identifier
        <input
          placeholder="Find a property"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={150}
        />
      </label>
      {result.loading && <LoadingState label="Searching properties" />}
      {result.error && <ErrorState message={result.error} />}
      <div className={styles.choiceList}>
        {matches.map((p) => (
          <button key={p.buildingId} onClick={() => onChoose(p)}>
            <Icon name="building" />
            <span>
              <strong>{p.name}</strong>
              <small>{p.identifier}</small>
            </span>
            <Icon name="arrow" />
          </button>
        ))}
      </div>
      {!matches.length && !result.loading && (
        <EmptyState
          title={settled ? "No matching building" : "Find the target property"}
          description="Search an identifier from loaded block data. Assignment always needs an explicit property."
          icon="search"
        />
      )}
    </div>
  );
}
