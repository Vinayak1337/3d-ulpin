"use client";
import type { BuildingDossier } from "@ulpin/contracts";
import {
  Badge,
  Button,
  EmptyState,
  Icon,
  Panel,
  type IconName,
} from "../shared/ui";
import RegisterGeometry from "./Geometry";
import { number, sourceKind, date, historyEntries } from "./model";
import styles from "./register.module.css";

export default function Overview({
  dossier,
  refreshing,
  onRefresh,
  onMap,
  onRecord,
  onSource,
  onEvidence,
  onIssues,
  onHistory,
}: {
  dossier: BuildingDossier;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onMap: () => void;
  onRecord: (id: string) => void;
  onSource: (id: string) => void;
  onEvidence: (id?: string) => void;
  onIssues: () => void;
  onHistory: () => void;
}) {
  const floors = dossier.records.filter((record) => record.kind === "floor"),
    spaces = dossier.records.filter((record) => record.kind === "space");
  return (
    <>
      <div className={styles.tabTitle}>
        <div>
          <h2>Property overview</h2>
          <p>Recorded geometry, sources and review context</p>
        </div>
        <Button
          variant="ghost"
          icon="history"
          onClick={() => void onRefresh()}
          disabled={refreshing}
        >
          Refresh
        </Button>
      </div>
      <div className={styles.metricGrid}>
        <Metric
          icon="building"
          label="Footprint"
          value={number(dossier.building.areaM2, "m²")}
        />
        <Metric
          icon="layers"
          label="Recorded floors"
          value={floors.length ? String(floors.length) : "Not supplied"}
        />
        <Metric
          icon="home"
          label="Units / spaces"
          value={spaces.length ? String(spaces.length) : "Not supplied"}
        />
        <Metric
          icon="document"
          label="Evidence sources"
          value={String(dossier.sources.length)}
        />
      </div>
      <div className={styles.overviewGrid}>
        <div className={styles.stack}>
          <Panel
            title="Recorded property plan"
            actions={
              <Button variant="ghost" onClick={() => onMap()} icon="external">
                Open map
              </Button>
            }
          >
            <RegisterGeometry
              dossier={dossier}
              onSelect={(id) => {
                onRecord(id);
              }}
            />
          </Panel>
          <Panel title="Parcels & representations">
            <div className={styles.relations}>
              {dossier.parcels.length ? (
                dossier.parcels.map((item) => (
                  <article key={item.feature.id}>
                    <div>
                      <strong>{item.feature.name}</strong>
                      <small className={styles.mono}>
                        {item.feature.identifier}
                      </small>
                    </div>
                    <Badge
                      tone={item.status === "confirmed" ? "success" : "warning"}
                    >
                      {item.status === "confirmed"
                        ? "Association confirmed"
                        : "Suggested linkage"}
                    </Badge>
                    <p>
                      {item.association?.reason ||
                        "Review the supporting evidence before confirming this linkage."}
                    </p>
                    <div className={styles.actions}>
                      {item.association?.evidence.map((value, index) => (
                        <Button
                          key={index}
                          variant="ghost"
                          onClick={() => onSource(value.sourceRevisionId)}
                        >
                          Source {index + 1} ↗
                        </Button>
                      ))}
                    </div>
                  </article>
                ))
              ) : (
                <EmptyState
                  title="No confirmed parcel linkage"
                  description="A nearby polygon does not establish a property boundary."
                />
              )}
            </div>
            {dossier.representations.length > 1 && (
              <p className={styles.note}>
                {dossier.representations.length} linked geometry representations
              </p>
            )}
          </Panel>
        </div>
        <div className={styles.stack}>
          <Panel
            title="Evidence & documents"
            actions={
              <Button variant="ghost" onClick={() => onEvidence()}>
                View all
              </Button>
            }
          >
            <div className={styles.shortList}>
              {dossier.sources.slice(0, 4).map((item) => (
                <button key={item.id} onClick={() => onEvidence(item.id)}>
                  <Icon
                    name={sourceKind(item) === "Photos" ? "photo" : "document"}
                  />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {sourceKind(item)} · {date(item.createdAt)}
                    </small>
                  </span>
                  <Icon name="chevron" />
                </button>
              ))}
            </div>
            {!dossier.sources.length && (
              <EmptyState title="No evidence retained" />
            )}
          </Panel>
          <Panel
            title="Issues & checks"
            actions={
              <Button variant="ghost" onClick={() => onIssues()}>
                View all
              </Button>
            }
          >
            {dossier.check?.stale ? (
              <p className={styles.warning}>
                Check is stale. Rerun in the block.
              </p>
            ) : dossier.issues.length ? (
              <div className={styles.shortList}>
                {dossier.issues.slice(0, 3).map((issue) => (
                  <button key={issue.id} onClick={() => onIssues()}>
                    <Icon name="warning" />
                    <span>
                      <strong>{issue.message}</strong>
                      {issue.areaM2 !== undefined && (
                        <small>{number(issue.areaM2, "m²")}</small>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                title={
                  dossier.check ? "No current findings" : "Not checked yet"
                }
                description={
                  dossier.check
                    ? "Within the scope of the latest technical check."
                    : "Run checks in the block to inspect relationships."
                }
              />
            )}
          </Panel>
          <Panel
            title="Latest activity"
            actions={
              <Button variant="ghost" onClick={() => onHistory()}>
                View all
              </Button>
            }
          >
            <ol className={styles.timeline}>
              {historyEntries(dossier)
                .slice(0, 3)
                .map((entry) => (
                  <li key={entry.id}>
                    <span className={styles.timelineDot} />
                    <div>
                      <strong>{entry.title}</strong>
                      <small>{date(entry.time)}</small>
                    </div>
                  </li>
                ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}) {
  return (
    <div className={styles.metric}>
      <span>
        <Icon name={icon} size={24} />
      </span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </div>
  );
}
