"use client";
import type { BuildingDossier } from "@ulpin/contracts";
import { Button, Icon, Panel } from "../shared/ui";
import PropertyScene from "../scene/PropertyScene";
import FloorIndex from "./FloorIndex";
import DocumentThumbnail, {
  documentLabel,
} from "../documents/DocumentThumbnail";
import { number, date, historyEntries } from "./model";
import styles from "./register.module.css";
type Props = {
  dossier: BuildingDossier;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onMap: () => void;
  onRecord: (id: string) => void;
  onSource: (id: string) => void;
  onEvidence: (id?: string) => void;
  onIssues: () => void;
  onHistory: () => void;
};
export default function Overview({
  dossier,
  onMap,
  onRecord,
  onSource,
  onEvidence,
  onIssues,
  onHistory,
}: Props) {
  const floors = dossier.records.filter((r) => r.kind === "floor"),
    spaces = dossier.records.filter((r) => r.kind === "space");
  const documents = [...dossier.sources]
    .sort(
      (a, b) =>
        Number(/\.(pdf|png)$/i.test(b.name)) -
        Number(/\.(pdf|png)$/i.test(a.name)),
    )
    .slice(0, 4);
  return (
    <>
      <div className={styles.metricGrid}>
        {[
          ["Building footprint", number(dossier.building.areaM2, "m²")],
          ["Recorded floors", floors.length || "Not supplied"],
          ["Units / spaces", spaces.length || "Not supplied"],
          ["Evidence sources", dossier.sources.length],
        ].map(([label, value]) => (
          <div className={styles.referenceMetric} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className={styles.referenceOverview}>
        <div className={styles.stack}>
          <Panel
            title="Building & floors"
            actions={
              <Button variant="ghost" icon="map" onClick={onMap}>
                View block
              </Button>
            }
          >
            <div className={styles.buildingFloorComposition}>
              <PropertyScene dossier={dossier} onSelect={onRecord} />
              <FloorIndex floors={floors} spaces={spaces} onRecord={onRecord} />
            </div>
          </Panel>
        </div>
        <aside className={styles.stack}>
          <Panel
            title="Evidence & documents"
            actions={
              <Button variant="ghost" onClick={() => onEvidence()}>
                View all
              </Button>
            }
          >
            {documents.map((source) => (
              <button
                className="document-card"
                key={source.id}
                onClick={() => onSource(source.id)}
              >
                <DocumentThumbnail
                  source={{
                    id: source.id,
                    name: source.name,
                    url: source.url,
                    hash: source.sha256,
                    kind: /\.pdf$/i.test(source.name)
                      ? "pdf"
                      : /\.(png|jpe?g)$/i.test(source.name)
                        ? "image"
                        : "text",
                    parts: [],
                  }}
                />
                <span>
                  <strong>{documentLabel(source.name)}</strong>
                  <small>Original · revision {source.revision}</small>
                  <small style={{ display: "block", marginTop: 6 }}>
                    {date(source.createdAt)}
                  </small>
                </span>
              </button>
            ))}
          </Panel>
          <Panel
            title="Issues & discrepancies"
            actions={
              <Button variant="ghost" onClick={onIssues}>
                {dossier.issues.length}
              </Button>
            }
          >
            {dossier.issues.length ? (
              <div className={styles.referenceIssues}>
                {dossier.issues.slice(0, 3).map((issue) => (
                  <button key={issue.id} onClick={onIssues}>
                    <Icon name="warning" />
                    <span>{issue.message}</span>
                    <Icon name="chevron" />
                  </button>
                ))}
              </div>
            ) : (
              <p className={styles.referenceNote}>
                No findings in the current recorded check.
              </p>
            )}
          </Panel>
          <Panel
            title="Recent activity"
            actions={
              <Button variant="ghost" onClick={onHistory}>
                History
              </Button>
            }
          >
            <div className={styles.referenceActivity}>
              {historyEntries(dossier)
                .slice(0, 3)
                .map((entry, index) => (
                  <div key={index}>
                    <Icon name="history" />
                    <span>
                      {entry.title}
                      <small>{date(entry.time)}</small>
                    </span>
                  </div>
                ))}
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}
