"use client";
import { useEffect, useRef, useState } from "react";
import type {
  AreaContext,
  ImportPackage,
  PreparationCase,
  SpatialMlApplyRequest,
  SpatialMlApplyResponse,
  SpatialMlBatch,
  SpatialMlItem,
  SpatialMlStatus,
  SpatialMlTask,
} from "@ulpin/contracts";
import { request, useResource } from "../../shared/hooks";
import { Badge, Button, Dialog } from "../../shared/ui";
import type { CanvasSource } from "../types";
import ExtractionReview from "./ExtractionReview";
import DataTools from "../../block/DataTools";
import "./spatial-ml.css";

const running = (item: SpatialMlItem) =>
  ["queued", "running"].includes(item.state);
export default function SpatialExtractionPanel({
  pkg,
  buildingId,
  preparation,
  sources,
  disabled,
  onUpdated,
}: {
  pkg: ImportPackage;
  buildingId?: string;
  preparation?: PreparationCase;
  sources: CanvasSource[];
  disabled: boolean;
  onUpdated: (pkg: ImportPackage) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [task, setTask] = useState<SpatialMlTask>(buildingId ? "floor-plan" : "building");
  const [parts, setParts] = useState<string[]>([]),
    [pages, setPages] = useState<Record<string, number>>({});
  const [activeId, setActiveId] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [reviewPackageId, setReviewPackageId] = useState<string | undefined>();
  const retryKeys = useRef<Record<string, string>>({});
  const operation = useRef<{ signature: string; key: string } | null>(null);
  const status = useResource<SpatialMlStatus>(
    open ? "/spatial-ml/status" : null,
  );
  const batches = useResource<SpatialMlBatch[]>(
    open ? `/spatial-ml/batches?packageId=${encodeURIComponent(pkg.id)}` : null,
  );
  const items = (batches.data || []).flatMap((batch) => batch.items);
  const active = items.find((item) => item.id === activeId);
  const pending = items.some(running);
  const model =
    status.data?.models.find(
      (candidate) => candidate.task === task && candidate.ready,
    ) || status.data?.models.find((candidate) => candidate.task === task);
  const eligible = pkg.parts.filter(
    (part) =>
      (buildingId ? part.entityIds.includes(buildingId) : !!pkg.sourceWorkspace && part.entityIds.length === 0) &&
      sources.some(
        (source) =>
          source.id === part.sourceRevisionId &&
          ["image", "pdf"].includes(source.originalKind || source.kind),
      ),
  );
  useEffect(() => {
    if (!open || !pending) return;
    const timer = setTimeout(() => void batches.reload(), 1800);
    return () => clearTimeout(timer);
  }, [open, pending, batches.data, batches.reload]);
  async function operate(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The extraction request could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function queue() {
    if (!model?.ready) return;
    const payload = {
      packageId: pkg.id,
      expectedRevision: pkg.revision,
      items: eligible
        .filter((part) => parts.includes(part.id))
        .map((part) => ({
          sourceRevisionId: part.sourceRevisionId,
          partId: part.id,
          page:
            pages[part.id] ||
            Number(part.locator.match(/page\s*[:#]?\s*(\d+)/i)?.[1]) ||
            1,
          task,
          modelId: model.id,
        })),
    };
    const signature = JSON.stringify(payload);
    if (operation.current?.signature !== signature)
      operation.current = { signature, key: crypto.randomUUID() };
    await operate(async () => {
      const batch = await request<SpatialMlBatch>("/spatial-ml/batches", {
        ...payload,
        requestKey: operation.current!.key,
      });
      setActiveId(batch.items[0]?.id || null);
      setParts([]);
      await batches.reload();
    });
  }
  async function apply(payload: SpatialMlApplyRequest) {
    if (!active) return;
    await operate(async () => {
      if (active.task === "building") {
        const context = await request<AreaContext>(
          `/areas/${pkg.areaId}/context`,
        );
        const result = await request<{ package: ImportPackage }>(
          `/spatial-ml/items/${active.id}/footprint-drafts`,
          {
            expectedRevision: payload.expectedRevision,
            expectedAreaRevision: context.area.revision,
            requestKey: payload.requestKey,
            selections: payload.selections,
            calibration: payload.calibration,
          },
        );
        await batches.reload();
        setReviewPackageId(result.package.id);
        setOpen(false);
        return;
      }
      const result = await request<SpatialMlApplyResponse>(
        `/spatial-ml/items/${active.id}/apply`,
        payload,
      );
      await onUpdated(result.package);
      await batches.reload();
    });
  }
  return (
    <section className="spatial-ml-panel">
      <h3>Spatial extraction</h3>
      <p>
        Suggest room, wall or building boundaries from retained plans and
        imagery.
      </p>
      <Button variant={buildingId ? "secondary" : "primary"} onClick={() => setOpen(true)} disabled={disabled}>
        {buildingId ? "Extract plans or imagery" : "Extract or review imagery"}
      </Button>
      <Dialog
        open={open}
        title="Spatial extraction"
        onClose={() => setOpen(false)}
      >
        <p className="ml-intro">
          Local model suggestions · Originals and previous attempts are
          retained. Select sources, inspect the results, then send supported
          boundaries to review.
        </p>
        {(error || status.error || batches.error) && (
          <div className="ml-error" role="alert">
            {error || status.error || batches.error}
            <Button
              variant="ghost"
              onClick={() => {
                void status.reload();
                void batches.reload();
              }}
            >
              Refresh
            </Button>
          </div>
        )}
        <div className="ml-batch-setup">
          <div>
            <label>
              Extraction task
              <select
                value={task}
                onChange={(e) => setTask(e.target.value as SpatialMlTask)}
              >
                <option value="floor-plan">Floor plan · rooms and walls</option>
                <option value="building">Overhead imagery · buildings</option>
              </select>
            </label>
            {status.loading ? (
              <p>Checking local models…</p>
            ) : model ? (
              <details>
                <summary>{model.ready ? "Local model ready · processing details" : "Local assistance unavailable · details"}</summary>
                <strong>{model.name || model.id}</strong>
                <br />
                {model.ready
                  ? "Available locally"
                  : model.reason || "Model unavailable"}{" "}
                · {model.license}
                {model.evaluation && (
                  <>
                    <br />
                    {model.evaluation}
                  </>
                )}
              </details>
            ) : (
              <p>No model configured for this task.</p>
            )}
          </div>
          <div>
            <div className="ml-source-options">
              {eligible.map((part) => {
                const source = sources.find(
                  (s) => s.id === part.sourceRevisionId,
                )!;
                return (
                  <div key={part.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={parts.includes(part.id)}
                        disabled={
                          !parts.includes(part.id) &&
                          parts.length >= (status.data?.maxBatchItems || 12)
                        }
                        onChange={(e) =>
                          setParts((old) =>
                            e.target.checked
                              ? [...old, part.id]
                              : old.filter((id) => id !== part.id),
                          )
                        }
                      />
                      <span>
                        {source.name}
                        <small>{part.locator}</small>
                      </span>
                    </label>
                    <label className="ml-page-number">
                      Page
                      <input
                        type="number"
                        min="1"
                        max="100"
                        aria-label={`Page for ${source.name} ${part.locator}`}
                        value={
                          pages[part.id] ||
                          Number(
                            part.locator.match(/page\s*[:#]?\s*(\d+)/i)?.[1],
                          ) ||
                          1
                        }
                        onChange={(e) =>
                          setPages({
                            ...pages,
                            [part.id]: Number(e.target.value),
                          })
                        }
                        disabled={
                          (source.originalKind || source.kind) !== "pdf" ||
                          /\bpage\s+(\d+)\b/i.test(part.locator)
                        }
                      />
                    </label>
                  </div>
                );
              })}
              {!eligible.length && (
                <p>
                  Add a plan image or PDF to this workspace first.
                </p>
              )}
            </div>
            <Button
              variant="primary"
              disabled={busy || !model?.ready || !parts.length}
              onClick={() => void queue()}
            >
              Queue {parts.length || "selected"} source
              {parts.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
        <div className="ml-results-heading">
          <h3>Retained attempts</h3>
          <Button
            variant="ghost"
            onClick={() => void batches.reload()}
            disabled={busy}
          >
            Refresh status
          </Button>
        </div>
        <div className="ml-attempts">
          {items.map((item) => (
            <article
              key={item.id}
              className={activeId === item.id ? "active" : ""}
            >
              <button onClick={() => setActiveId(item.id)}>
                <strong>
                  {sources.find((s) => s.id === item.sourceRevisionId)?.name ||
                    item.sourceRevisionId}
                </strong>
                <small>
                  Page {item.page} ·{" "}
                  {item.task === "floor-plan" ? "Floor plan" : "Buildings"} ·{" "}
                  {item.attempts.length} attempt
                  {item.attempts.length === 1 ? "" : "s"}
                </small>
                <Badge
                  tone={
                    item.state === "succeeded"
                      ? "success"
                      : item.state === "failed" || item.state === "blocked"
                        ? "warning"
                        : "neutral"
                  }
                >
                  {item.state}
                </Badge>
              </button>
              {running(item) ? (
                <Button
                  variant="ghost"
                  onClick={() =>
                    void operate(async () => {
                      await request(`/spatial-ml/items/${item.id}/cancel`, {});
                      await batches.reload();
                    })
                  }
                  disabled={busy}
                >
                  Cancel
                </Button>
              ) : (
                ["failed", "blocked", "cancelled"].includes(item.state) && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void operate(async () => {
                        await request(`/spatial-ml/items/${item.id}/retry`, {
                          requestKey: retryKeys.current[`${item.id}:${item.attempts.length}`] ||= crypto.randomUUID(),
                        });
                        await batches.reload();
                      })
                    }
                    disabled={busy}
                  >
                    Retry
                  </Button>
                )
              )}
            </article>
          ))}
          {!items.length && !batches.loading && (
            <p>
              No extraction batches yet. Each selected page gets its own
              retained result or failure.
            </p>
          )}
        </div>
        {active && (
          <div className="ml-active-item">
            {active.attempts.at(-1)?.error && (
              <p className="ml-error" role="status">
                {active.attempts.at(-1)?.error}
              </p>
            )}
            {running(active) && (
              <p role="status">
                {active.state === "queued"
                  ? "Waiting for the local worker. You can close this window and return later."
                  : "Extracting regions from this source. Results will appear here."}
              </p>
            )}
            {active.state === "empty" && (
              <p>
                No regions passed the model's output rules. This is not evidence
                that the source has no rooms or buildings.
              </p>
            )}
            {active.footprintDrafts?.map((draft) => (
              <Button
                key={draft.packageId}
                onClick={() => {
                  setReviewPackageId(draft.packageId);
                  setOpen(false);
                }}
              >
                Review retained footprint draft
              </Button>
            ))}
            {active.result && (
              <ExtractionReview
                key={`${active.id}:${active.result.raster.sha256}:${JSON.stringify(active.retainedFootprintCalibration)}:${pkg.sourceWorkspace?.frame.id || preparation?.placement.targetFrame}`}
                item={active}
                preparation={preparation}
                sourceFrame={pkg.sourceWorkspace?.frame.id}
                buildingId={buildingId}
                revision={pkg.revision}
                busy={busy}
                onApply={apply}
              />
            )}
          </div>
        )}
      </Dialog>
      <DataTools
        open={!!reviewPackageId}
        initialPackageId={reviewPackageId}
        onClose={() => setReviewPackageId(undefined)}
      />
    </section>
  );
}
