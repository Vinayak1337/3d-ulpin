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
import ScopedExport from "../shared/ScopedExport";
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
    [pkg, setPackage] = useState<ImportPackage | null>(null);
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
      {mode==='import'&&<ol className="import-progress" aria-label="Import progress">{['Original source','Map fields','Inspect geometry','Review','Record'].map((label,index)=>{const step=!pkg?1:pkg.state==='COMMITTED'?4:pkg.state==='REVIEWED'?3:2;return <li key={label} aria-current={index===step?'step':undefined} data-done={index<step}><span>{index+1}</span>{label}</li>;})}</ol>}
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
          <ScopedExport context={context} selectedId={selectedId}/>

        ))}
    </Dialog>
  );
}
