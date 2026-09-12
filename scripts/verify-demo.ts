import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type {
  CaseDetail,
  CaseRecord,
  ProcessingJob,
  SourceRevision,
} from "../packages/contracts/src/index";

const base = process.env.DEMO_BASE_URL || "http://127.0.0.1:3000/api/v1";
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert(
    response.headers.get("content-type")?.includes("application/json"),
    `${method} ${path}: expected JSON, received HTTP ${response.status}. Check the dev server for compilation errors.`,
  );
  const data = await response.json();
  assert(response.ok, `${method} ${path}: ${JSON.stringify(data)}`);
  return data as T;
}
async function settled(caseId: string): Promise<CaseDetail> {
  const start = Date.now();
  while (Date.now() - start < 40000) {
    const detail = await request<CaseDetail>(`/cases/${caseId}`);
    if (
      !detail.jobs.some(
        (job) => job.status === "queued" || job.status === "running",
      )
    ) {
      assert(
        !detail.jobs.some((job) => job.status === "failed"),
        JSON.stringify(detail.jobs.filter((job) => job.status === "failed")),
      );
      return detail;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${caseId}`);
}
function near(actual: number, expected: number, label: string) {
  assert(
    Math.abs(actual - expected) < 1e-8,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

const evidence: {
  dataset: string;
  caseId: string;
  draftJobId: string;
  draftSnapshotId: string;
  revisedSourceId: string;
  correctedSnapshotId: string;
  overlapBefore: number;
  overlapAfter: number;
  elapsedMs: number;
}[] = [];
for (const dataset of ["c001", "c002"] as const) {
  const start = Date.now();
  const record = await request<CaseRecord>("/cases", "POST", {
    name: `Verification — ${dataset.toUpperCase()}`,
    description:
      "Created by the repeatable input-to-model verification script.",
  });
  let detail = await request<CaseDetail>(`/cases/${record.id}`);
  assert.equal(detail.model, null, "A new case must have no prebuilt model.");
  assert.equal(detail.units.length, 0);
  await request(`/cases/${record.id}/demo-inputs`, "POST", { dataset });
  detail = await settled(record.id);
  assert.equal(detail.sources.length, 5);
  assert.equal(
    detail.units.length,
    0,
    "Source receipt must not automatically prepare units.",
  );
  assert.equal(detail.model, null);
  for (const source of detail.sources) {
    const response = await fetch(`${base}/sources/${source.id}/file`);
    assert.equal(response.status, 200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(bytes.length, source.bytes);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      source.sha256,
    );
  }
  const source = (profile: string) =>
    detail.sources.find((item) => item.profile === profile)!;
  detail = await request<CaseDetail>(`/cases/${record.id}/prepare`, "POST", {
    spatialSourceId: source("parcel-local-json-v1").id,
    levelSourceId: source("levels-csv-v1").id,
    controlSourceId: source("control-csv-v1").id,
  });
  const draftJob = await request<ProcessingJob>(
    `/cases/${record.id}/build`,
    "POST",
    { expectedRevision: detail.case.revision },
  );
  const sameJob = await request<ProcessingJob>(
    `/cases/${record.id}/build`,
    "POST",
    { expectedRevision: detail.case.revision },
  );
  assert.equal(
    sameJob.id,
    draftJob.id,
    "A duplicate build must resolve the same operation.",
  );
  detail = await settled(record.id);
  const draft = detail.model!;
  assert(draft, "Real build must publish a persisted snapshot.");
  assert.equal(draft.units.length, dataset === "c001" ? 7 : 5);
  const overlapBefore = draft.findings.reduce(
    (sum, finding) => sum + (finding.overlap?.volume || 0),
    0,
  );
  near(
    overlapBefore,
    dataset === "c001" ? 6.4 : 14.4,
    `${dataset} draft overlap`,
  );
  if (dataset === "c001") {
    near(
      draft.units.find((unit) => unit.alias === "U01")!.area,
      32,
      "Apartment area",
    );
    near(
      draft.units.find((unit) => unit.alias === "U03")!.volume,
      102.4,
      "Draft upper volume",
    );
    near(
      draft.units.find((unit) => unit.alias === "BSM-01")!.volume,
      240,
      "Basement volume",
    );
    assert.equal(
      draft.units.find((unit) => unit.alias === "U04")!.lowerVerified,
      false,
    );
  }
  const unchangedRevision = detail.case.revision;
  const sourceR2 = await request<SourceRevision>(
    `/cases/${record.id}/demo-levels`,
    "POST",
    { dataset },
  );
  detail = await settled(record.id);
  assert.equal(
    detail.case.revision,
    unchangedRevision,
    "New evidence receipt must not mutate candidate revisions.",
  );
  assert.equal(
    detail.model!.id,
    draft.id,
    "New evidence receipt must not replace a model.",
  );
  const oldUnitRevisions = new Map(
    detail.units.map((unit) => [unit.id, unit.revision]),
  );
  detail = await request<CaseDetail>(
    `/cases/${record.id}/apply-levels`,
    "POST",
    { sourceId: sourceR2.id, expectedRevision: detail.case.revision },
  );
  assert(
    detail.case.revision > draft.revision,
    "Applying new evidence makes old results stale.",
  );
  assert.equal(
    detail.model!.id,
    draft.id,
    "The former model remains available until a fresh computation.",
  );
  if (dataset === "c001") {
    const u04 = detail.units.find((unit) => unit.alias === "U04")!;
    assert(
      u04.revision > oldUnitRevisions.get(u04.id)!,
      "Evidence-only update creates a new U04 revision.",
    );
    assert.equal(u04.lower, 3);
    assert.equal(u04.bindings.lower!.sourceId, sourceR2.id);
  }
  await request<ProcessingJob>(`/cases/${record.id}/build`, "POST", {
    expectedRevision: detail.case.revision,
  });
  detail = await settled(record.id);
  const corrected = detail.model!;
  assert.notEqual(corrected.id, draft.id);
  assert.equal(corrected.revision, detail.case.revision);
  const overlapAfter = corrected.findings.reduce(
    (sum, finding) => sum + (finding.overlap?.volume || 0),
    0,
  );
  near(overlapAfter, 0, `${dataset} corrected overlap`);
  const reopened = await request<CaseDetail>(`/cases/${record.id}`);
  assert.equal(reopened.model!.id, corrected.id);
  evidence.push({
    dataset,
    caseId: record.id,
    draftJobId: draftJob.id,
    draftSnapshotId: draft.id,
    revisedSourceId: sourceR2.id,
    correctedSnapshotId: corrected.id,
    overlapBefore,
    overlapAfter,
    elapsedMs: Date.now() - start,
  });
  console.log(
    `PASS ${dataset}: ${draft.units.length} spaces, overlap ${overlapBefore} → ${overlapAfter} m³; uploaded bytes and revisions preserved.`,
  );
}
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/demo-verification.json",
  JSON.stringify(
    { executedAt: new Date().toISOString(), base, evidence },
    null,
    2,
  ),
);
console.log(
  "Both full source-to-model correction journeys passed. Evidence: test-results/demo-verification.json",
);
