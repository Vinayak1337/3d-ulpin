"use client";
import { useEffect, useRef, useState } from "react";
import type {
  CaseDetail,
  ImportPackage,
  PreparationCase,
  ProcessingJob,
  RegistryReview,
} from "@ulpin/contracts";
import { registryRequest as request } from "@/lib/registry-client";

export default function PreparationBuild({
  preparation,
  pkg,
  onPackage,
  onRecorded,
  disabled = false,
  onBusy,
}: {
  preparation: PreparationCase;
  pkg: ImportPackage;
  onPackage: (pkg: ImportPackage) => Promise<void>;
  onRecorded: () => void;
  disabled?: boolean;
  onBusy?: (label: string) => void;
}) {
  const [detail, setDetail] = useState<CaseDetail | null>(null),
    [review, setReview] = useState<RegistryReview | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [recorded, setRecorded] = useState(false),
    [builtRevision, setBuiltRevision] = useState<number | null>(null);
  useEffect(() => {
    setReview(null);
    setRecorded(false);
  }, [pkg.revision, preparation.revision]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    void request<CaseDetail>(`/cases/${preparation.caseId}`)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [preparation.caseId]);
  useEffect(() => {
    const job = detail?.jobs.find((value) => value.operation === "build");
    if (!job || !["queued", "running"].includes(job.status)) return;
    const timeout = setTimeout(() => {
      void request<CaseDetail>(`/cases/${preparation.caseId}`)
        .then((value) => {
          if (alive.current) setDetail(value);
        })
        .catch((cause) => {
          if (alive.current) setError(cause.message);
        });
    }, 1200);
    return () => clearTimeout(timeout);
  }, [detail, preparation.caseId]);
  const run = async (label: string, action: () => Promise<void>) => {
    if (disabled || busy) return;
    setBusy(label);
    onBusy?.(label);
    setError("");
    try {
      await action();
    } catch (cause) {
      if (alive.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "The detailed model could not be updated.",
        );
    } finally {
      if (alive.current) setBusy("");
      onBusy?.("");
    }
  };
  const job = detail?.jobs.find((value) => value.operation === "build"),
    processing = job && ["queued", "running"].includes(job.status);
  const ready =
    builtRevision === pkg.revision &&
    !!detail?.model &&
    detail.model.revision === detail.case.revision &&
    !processing &&
    job?.status === "succeeded";
  const errors =
    review?.findings.filter((finding) => finding.severity === "error") || [];
  return (
    <div className="preparation-build">
      <h3>Build and review details</h3>
      <p className="area-note">
        Reviewed source facts create a proposed model. The current property
        register changes only after recording.
      </p>
      {error && (
        <p role="alert" className="area-warning">
          {error}
        </p>
      )}
      {busy && <p role="status">{busy}</p>}
      <button
        className="area-primary"
        disabled={disabled || !!busy || !!processing}
        onClick={() =>
          void run("Preparing the detailed model…", async () => {
            const result = await request<{
              package: ImportPackage;
              job: ProcessingJob;
            }>(`/import-packages/${pkg.id}/prepare-details`, {
              expectedRevision: pkg.revision,
            });
            await onPackage(result.package);
            const current = await request<CaseDetail>(
              `/cases/${preparation.caseId}`,
            );
            if (alive.current) {
              setDetail(current);
              setBuiltRevision(result.package.revision);
              setReview(null);
              setRecorded(false);
            }
          })
        }
      >
        Build proposed 3D details
      </button>
      {processing && (
        <p role="status" className="property-progress">
          Processing source geometry… {job?.status}
        </p>
      )}
      {job?.status === "failed" && (
        <p className="area-warning">
          {job.error || "Geometry processing failed. Review the source inputs."}
        </p>
      )}
      {job?.status === "stale" && (
        <p className="area-warning">
          Inputs changed during processing. Build the revised facts again.
        </p>
      )}
      {ready && (
        <>
          <p className="property-progress">
            Model ready · {detail?.model?.units.length || 0} supported spaces
          </p>
          <button
            disabled={disabled || !!busy}
            onClick={() =>
              void run(
                "Checking this property against the current register…",
                async () => {
                  const value = await request<RegistryReview>(
                    `/buildings/${preparation.buildingId}/detail-review`,
                    { expectedRevision: detail!.case.revision },
                  );
                  if (alive.current) setReview(value);
                },
              )
            }
          >
            Review proposed records
          </button>
        </>
      )}
      {review && (
        <div className="preparation-review">
          <h4>
            {review.records.length} proposed records · {review.findings.length}{" "}
            findings
          </h4>
          {review.findings.map((finding) => (
            <p
              key={finding.id}
              className={
                finding.severity === "error" ? "area-warning" : "area-note"
              }
            >
              {finding.title}: {finding.description}
            </p>
          ))}
          {!review.findings.length && (
            <p className="area-note">
              No conflicts found by this technical check.
            </p>
          )}
          {recorded ? (
            <p role="status" className="property-progress">
              Details recorded for this building. Open Register to inspect them
              in the block.
            </p>
          ) : (
            <form
              className="officer-form"
              onSubmit={(event) => {
                event.preventDefault();
                const acknowledgement = String(
                  new FormData(event.currentTarget).get("acknowledgement"),
                );
                void run("Recording this reviewed model…", async () => {
                  await request(`/registry-reviews/${review.id}/commit`, {
                    acknowledgement,
                  });
                  if (alive.current) {
                    setRecorded(true);
                    onRecorded();
                  }
                });
              }}
            >
              <label>
                Review note
                <input
                  name="acknowledgement"
                  required
                  placeholder="Source checks and any finding acknowledged"
                />
              </label>
              <button
                className="area-primary"
                disabled={disabled || !!busy || !!errors.length}
              >
                Record reviewed details
              </button>
            </form>
          )}
        </div>
      )}
      <details>
        <summary>Advanced geometry editing</summary>
        <a
          className="property-link-button"
          href={`/workbench?case=${preparation.caseId}&building=${preparation.buildingId}&area=${preparation.areaId}`}
        >
          Open linked geometry editor ↗
        </a>
        <p className="area-note">
          The editor has a direct return link to this property in the block.
        </p>
      </details>
    </div>
  );
}
