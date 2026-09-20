import type { CaseDetail, ImportPackage, PreparationCase, PreparationContinuation } from "@ulpin/contracts";

export interface PreparationReceipt {
  payloadHash: string;
  result: { caseId: string; caseRevision: number; sourceId: string; packageRevision: number };
}

/** A model alone says nothing about the current source facts or placement. */
export function preparationBuildState(
  pkg: ImportPackage,
  preparation: PreparationCase,
  detail: CaseDetail,
  receipt: PreparationReceipt | undefined,
  currentFingerprint: string,
  buildingRevision: number,
): PreparationContinuation {
  const base = {
    packageRevision: pkg.revision,
    preparationRevision: preparation.revision,
    caseRevision: detail.case.revision,
    spaceCount: 0,
    job: null,
    review: null,
  };
  const source = detail.sources.find((source) => source.id === receipt?.result.sourceId);
  if (!receipt || receipt.result.packageRevision !== pkg.revision ||
      receipt.result.caseId !== preparation.caseId || detail.case.id !== preparation.caseId ||
      receipt.result.caseRevision !== detail.case.revision ||
      preparation.packageId !== pkg.id || preparation.placement.status !== "reviewed" ||
      preparation.buildingRevision !== buildingRevision || !source ||
      !pkg.sourceRevisionIds.includes(source.id) || source.sha256 !== receipt.payloadHash ||
      source.status !== "ready") {
    return { ...base, status: "needs_build" };
  }
  // Jobs returned by getCase are newest first. Ignore unrelated historical builds.
  const job = detail.jobs.find((job) => job.operation === "build" &&
    job.caseId === preparation.caseId && job.inputFingerprint === currentFingerprint) ?? null;
  if (job?.status === "queued" || job?.status === "running")
    return { ...base, job, status: "processing" };
  if (!job || job.status !== "succeeded")
    return { ...base, job, status: "retry_build" };
  if (!detail.model || detail.model.caseId !== preparation.caseId ||
      detail.model.revision !== detail.case.revision ||
      detail.model.inputFingerprint !== currentFingerprint)
    return { ...base, job, status: "needs_build" };
  return { ...base, job, status: "ready", spaceCount: detail.model.units.length };
}
