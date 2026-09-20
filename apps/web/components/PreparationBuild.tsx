"use client";
import { useCallback, useEffect, useState } from "react";
import type { ImportPackage, PreparationCase, PreparationContinuation, RegistryReview } from "@ulpin/contracts";
import { registryRequest as request } from "@/lib/registry-client";
import { legacyUrl } from "@/lib/legacy-url";

export default function PreparationBuild({ preparation, pkg, onPackage, onRecorded,
  disabled = false, onBusy, editorUrl, recordUrl, missing = [],
}: {
  preparation: PreparationCase;
  pkg: ImportPackage;
  onPackage: (pkg: ImportPackage) => Promise<void>;
  onRecorded: () => void;
  disabled?: boolean;
  onBusy?: (label: string) => void;
  editorUrl?: string;
  recordUrl?: string;
  missing?: string[];
}) {
  const [saved, setSaved] = useState<PreparationContinuation | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const load = useCallback(() => request<PreparationContinuation>(`/import-packages/${pkg.id}/continuation`), [pkg.id]);
  useEffect(() => {
    let active = true;
    setSaved(null);
    setError("");
    void load().then((value) => { if (active) setSaved(value); })
      .catch((cause) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [load, pkg.revision, preparation.revision, refreshKey]);
  const current = saved?.packageRevision === pkg.revision &&
    saved.preparationRevision === preparation.revision ? saved : null;
  useEffect(() => {
    if (current?.status !== "processing") return;
    let active = true;
    const timer = setTimeout(() => {
      void load().then((value) => { if (active) setSaved(value); })
        .catch((cause) => { if (active) setError(cause.message); });
    }, 1200);
    return () => { active = false; clearTimeout(timer); };
  }, [current, load]);
  const run = async (label: string, action: () => Promise<void>) => {
    if (disabled || busy) return;
    setBusy(label);
    onBusy?.(label);
    setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The detailed model could not be updated."); }
    finally { setBusy(""); onBusy?.(""); }
  };
  const review = current?.review;
  const ready = current?.status === "ready";
  const recorded = current?.status === "recorded";
  const processing = current?.status === "processing";
  const blocked = review?.findings.some((finding) => finding.severity === "error");
  const build = () => void run("Preparing the detailed model…", async () => {
    const result = await request<{ package: ImportPackage }>(`/import-packages/${pkg.id}/prepare-details`, { expectedRevision: pkg.revision });
    setSaved(null);
    await onPackage(result.package);
    setRefreshKey((value) => value + 1);
  });
  return (
    <div className="preparation-build">
      <h3>{recorded ? "Details recorded" : review ? "Check & record" : "Next step"}</h3>
      {error && <p role="alert" className="area-warning">{error}</p>}
      {busy && <p role="status">{busy}</p>}
      {!current && !error && <p role="status">Checking saved progress…</p>}
      {!current && error && <button disabled={!!busy} onClick={() => setRefreshKey((value) => value + 1)}>Retry saved progress</button>}
      {current && !review && !ready && !processing && (
        <>
          <p className="area-note">{missing[0] || "Source facts and placement are ready. Build the proposed details to run the spatial checks."}</p>
          {current.job?.error && <p className="area-warning">{current.job.error}</p>}
          {current.status === "retry_build" && <p className="area-note">Retry processing the saved inputs. Your reviewed facts are retained.</p>}
          <button className="area-primary" disabled={disabled || !!busy || missing.length > 0} onClick={build}>
            {current.status === "retry_build" ? "Retry proposed 3D details" : "Build proposed 3D details"}
          </button>
        </>
      )}
      {processing && <p role="status" className="property-progress">Processing source geometry… You can leave and resume this workspace.</p>}
      {ready && (
        <>
          <p className="property-progress">Model ready · {current.spaceCount} supported spaces</p>
          <button className="area-primary" disabled={disabled || !!busy} onClick={() => void run("Checking against the current register…", async () => {
            await request<RegistryReview>(`/buildings/${preparation.buildingId}/detail-review`, { expectedRevision: current.caseRevision });
            setSaved(await load());
          })}>Review proposed records</button>
        </>
      )}
      {review && (
        <div className="preparation-review">
          <p className="area-note">{review.records.length} {recorded ? "recorded" : "proposed"} records · {review.findings.length} findings</p>
          <details>
            <summary>Proposed changes and level references</summary>
            {review.records.map((record) => {
              const previous = review.before.find((value) => value.id === record.id);
              return <p key={record.id} className="area-note">
                <strong>{record.name}</strong> · {previous ? "Update retained record" : "New record"}
                {record.geometry && <> · {record.geometry.lower}–{record.geometry.upper} m · {preparation.placement.verticalReference}</>}
              </p>;
            })}
          </details>
          {review.findings.map((finding) => <p key={finding.id} className={finding.severity === "error" ? "area-warning" : "area-note"}>{finding.title}: {finding.description}</p>)}
          {!review.findings.length && <p className="property-progress">No conflicts found by this technical check.</p>}
          {recorded ? (
            <>
              <p role="status" className="property-progress">This proposal is recorded. Originals and earlier revisions are retained.</p>
              <a className="property-link-button" href={recordUrl ?? legacyUrl(`/properties/${preparation.buildingId}/register?area=${preparation.areaId}`)}>Open recorded details ↗</a>
            </>
          ) : (
            <form className="officer-form" onSubmit={(event) => {
              event.preventDefault();
              const acknowledgement = String(new FormData(event.currentTarget).get("acknowledgement"));
              if (!acknowledgement.trim()) return;
              void run("Recording this reviewed model…", async () => {
                await request(`/registry-reviews/${review.id}/commit`, { acknowledgement });
                setSaved(await load());
                onRecorded();
              });
            }}>
              <p className="area-note">Recording creates a technical revision. Original files and earlier records are kept.</p>
              <label>Review note<input name="acknowledgement" required minLength={1} maxLength={2000} pattern={".*\\S.*"} placeholder="Source checks and any finding acknowledged" /></label>
              <button className="area-primary" disabled={disabled || !!busy || blocked}>Record reviewed details</button>
            </form>
          )}
        </div>
      )}
      <details>
        <summary>Advanced geometry editing</summary>
        <a className="property-link-button" href={editorUrl ?? legacyUrl(`/workbench?case=${preparation.caseId}&building=${preparation.buildingId}&area=${preparation.areaId}`)}>Open linked geometry editor ↗</a>
      </details>
    </div>
  );
}
