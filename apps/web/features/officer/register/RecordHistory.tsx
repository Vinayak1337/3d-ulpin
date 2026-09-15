"use client";
import type { RegistryRecord } from "@ulpin/contracts";
import { routes } from "../shared/routes";
import { useResource } from "../shared/hooks";
import { ErrorState, Panel } from "../shared/ui";
export default function RecordHistory({ record }: { record: RegistryRecord }) {
  const history = useResource<{
    history: { revision: number; created_at: string; body: RegistryRecord }[];
  }>(`/registry/${record.id}?revision=${record.revision}`);
  return (
    <Panel title="Revision history">
      {history.error ? (
        <ErrorState message={history.error} retry={history.reload} />
      ) : (
        <div style={{ padding: 16, display: "grid", gap: 12 }}>
          {history.data?.history.map((item) => (
            <details key={item.revision}>
              <summary>
                Revision {item.revision} ·{" "}
                {new Date(item.created_at).toLocaleDateString()}
              </summary>
              <p>
                {item.body.name} · {item.body.geometry?.area ?? "—"} m² ·{" "}
                {item.body.rights.length} recorded rights
              </p>
              {item.body.evidence.map((e, i) => (
                <a
                  key={i}
                  href={routes.source(e.sourceId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {e.locator}
                </a>
              ))}
            </details>
          ))}
        </div>
      )}
    </Panel>
  );
}
