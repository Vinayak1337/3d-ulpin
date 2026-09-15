"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AreaContext, ImportPackage } from "@ulpin/contracts";
import type { SourceCatalogEntry } from "@/lib/source-catalog";
import {
  Dialog,
  Button,
  Badge,
  EmptyState,
  ErrorState,
  Icon,
} from "../shared/ui";
import { request, useMutation, useResource } from "../shared/hooks";
import { routes } from "../shared/routes";
import ImportForm from "./ImportForm";
import ImportReview from "./ImportReview";
export function downloadFile(
  name: string,
  content: string,
  type = "application/json",
) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function DataTools({
  open,
  initialMode = "import",
  onClose,
  context,
  selectedId,
  initialPackageId,
  onChanged,
}: {
  open: boolean;
  initialMode?: "import" | "export";
  onClose: () => void;
  context?: AreaContext | null;
  selectedId?: string | null;
  initialPackageId?: string;
  onChanged?: () => void;
}) {
  const [mode, setMode] = useState(initialMode),
    [source, setSource] = useState<"file" | "catalog">("file"),
    [pkg, setPackage] = useState<ImportPackage | null>(null),
    [exportType, setExportType] = useState("all"),
    [notice, setNotice] = useState("");
  const mutation = useMutation();
  const router = useRouter();
  const catalog = useResource<SourceCatalogEntry[]>(
    open && source === "catalog" ? "/source-catalog" : null,
  );
  const existing = useResource<ImportPackage>(
    open && initialPackageId ? `/import-packages/${initialPackageId}` : null,
  );
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setNotice("");
    }
  }, [open, initialMode]);
  useEffect(() => {
    if (existing.data) setPackage(existing.data);
  }, [existing.data]);
  const update = (operation: () => Promise<ImportPackage>) => {
    void mutation.run(async () => {
      const next = await operation();
      setPackage(next);
      onChanged?.();
    });
  };
  const committed = (next: ImportPackage) => {
    onClose();
    router.push(routes.block(next.areaId));
    onChanged?.();
  };
  const exportData = () => {
    if (!context) return;
    setNotice("");
    void mutation.run(async () => {
      const features =
        exportType === "selected"
          ? context.features.filter((f) => f.id === selectedId)
          : context.features;
      if (exportType === "selected" && !features.length)
        throw new Error("Select a feature before exporting selected data.");
      if (exportType === "view") {
        const svg = document.querySelector<SVGSVGElement>(
          ".ui-map-stage .ui-renderer[aria-hidden='false'] .ui-plan-svg",
        );
        if (!svg)
          throw new Error(
            "Switch to 2D Map to export the current vector view.",
          );
        downloadFile(
          `block-${context.area.id}-view.svg`,
          new XMLSerializer().serializeToString(svg),
          "image/svg+xml",
        );
      } else if (exportType === "report") {
        downloadFile(
          `block-${context.area.id}-report.json`,
          JSON.stringify(
            {
              schema: "ulpin-officer-report/2",
              exportedAt: new Date().toISOString(),
              area: context.area,
              check: context.latestCheck,
              sourceRevisions: [
                ...new Set(features.map((f) => f.sourceRevisionId)),
              ].map((id) => ({ id, url: routes.source(id) })),
              note: "Individual findings are not summed; overlapping areas may exist.",
            },
            null,
            2,
          ),
        );
      } else {
        downloadFile(
          `block-${context.area.id}.geojson`,
          JSON.stringify(
            {
              type: "FeatureCollection",
              features: features.map((f) => ({
                type: "Feature",
                id: f.id,
                geometry: f.geographicGeometry,
                properties: {
                  name: f.name,
                  identifier: f.identifier,
                  kind: f.kind,
                  geometryRole: f.geometryRole,
                  worldStatus: f.worldStatus,
                  sourceRevisionId: f.sourceRevisionId,
                  revision: f.revision,
                  height: f.height,
                  areaM2: f.areaM2,
                  analysisReference: context.area.reference,
                },
              })),
            },
            null,
            2,
          ),
          "application/geo+json",
        );
      }
      setNotice("Export downloaded.");
    });
  };
  return (
    <Dialog open={open} onClose={onClose} title="Data tools">
      <nav className="ui-data-tabs" aria-label="Data tools mode">
        {(["import", "export"] as const).map((value) => (
          <button
            key={value}
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
          >
            <Icon name={value === "import" ? "upload" : "download"} />
            {value === "import" ? "Import sources" : "Export data"}
          </button>
        ))}
      </nav>
      {mutation.error && <ErrorState message={mutation.error} />}{" "}
      {existing.error && (
        <ErrorState message={existing.error} retry={existing.reload} />
      )}
      {mode === "import" &&
        (pkg ? (
          <>
            <Button
              icon="back"
              variant="ghost"
              onClick={() => setPackage(null)}
            >
              Choose another source
            </Button>
            <ImportReview
              pkg={pkg}
              busy={mutation.busy}
              onUpdate={update}
              onCommitted={committed}
            />
          </>
        ) : (
          <>
            <div className="ui-source-tabs">
              <Button
                variant={source === "file" ? "primary" : "ghost"}
                onClick={() => setSource("file")}
              >
                Upload file
              </Button>
              <Button
                variant={source === "catalog" ? "primary" : "ghost"}
                onClick={() => setSource("catalog")}
              >
                Source catalogue
              </Button>
            </div>
            {source === "file" ? (
              <ImportForm
                area={context?.area}
                busy={mutation.busy}
                onImport={update}
              />
            ) : (
              <div className="ui-source-catalog">
                {catalog.error && (
                  <ErrorState message={catalog.error} retry={catalog.reload} />
                )}{" "}
                {catalog.data?.map((entry) => (
                  <article key={entry.id}>
                    <div className="ui-rail-caption">
                      <h3>{entry.name}</h3>
                      <Badge tone={entry.snapshot ? "info" : "warning"}>
                        {entry.snapshot ? "Saved snapshot" : "Access limited"}
                      </Badge>
                    </div>
                    <p>{entry.coverage}</p>
                    <small>{entry.provider}</small>
                    <div className="ui-catalog-actions">
                      {entry.snapshot && (
                        <Button
                          disabled={mutation.busy}
                          onClick={() =>
                            update(async () => {
                              const acquisition = await request<{ id: string }>(
                                "/acquisitions",
                                {
                                  sourceId: entry.id,
                                  mode: "saved",
                                  requestKey: crypto.randomUUID(),
                                },
                              );
                              return request<ImportPackage>(
                                "/import-packages",
                                {
                                  acquisitionId: acquisition.id,
                                  name: entry.snapshot?.name || entry.name,
                                },
                              );
                            })
                          }
                        >
                          Open saved source
                        </Button>
                      )}
                      <Button
                        disabled={mutation.busy || !entry.acquisitionEnabled}
                        onClick={() =>
                          update(async () => {
                            const acquisition = await request<{ id: string }>(
                              "/acquisitions",
                              {
                                sourceId: entry.id,
                                mode: "refresh",
                                requestKey: crypto.randomUUID(),
                              },
                            );
                            return request<ImportPackage>("/import-packages", {
                              acquisitionId: acquisition.id,
                              name: entry.name,
                            });
                          })
                        }
                      >
                        Refresh source
                      </Button>
                      <a
                        href={entry.metadataUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Source details <Icon name="external" size={14} />
                      </a>
                    </div>
                    {!entry.acquisitionEnabled && (
                      <p className="ui-muted-note">
                        Source access and reuse remain unresolved.
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </>
        ))}
      {mode === "export" &&
        (!context ? (
          <EmptyState
            title="Open a block first"
            description="Exports use the selected block's actual geometry, sources and latest check."
            icon="download"
          />
        ) : (
          <div className="ui-export-options">
            <h3>{context.area.name}</h3>
            <p>
              {context.features.length} recorded features · revision{" "}
              {context.area.revision}
            </p>
            {[
              {
                id: "all",
                name: "Block geometry",
                description:
                  "Geographic GeoJSON with identifiers and source references",
              },
              {
                id: "selected",
                name: "Selected feature",
                description: "Only the currently selected record",
              },
              {
                id: "view",
                name: "Current 2D view",
                description: "Vector SVG of the visible plan",
              },
              {
                id: "report",
                name: "Check & evidence report",
                description:
                  "Latest check, exact findings and original-source links",
              },
            ].map((option) => (
              <label key={option.id}>
                <input
                  type="radio"
                  name="export-type"
                  value={option.id}
                  checked={exportType === option.id}
                  onChange={() => setExportType(option.id)}
                />
                <span>
                  <strong>{option.name}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
            <Button
              icon="download"
              variant="primary"
              onClick={exportData}
              disabled={mutation.busy}
            >
              Download export
            </Button>
            {notice && <p role="status">{notice}</p>}
          </div>
        ))}
    </Dialog>
  );
}
