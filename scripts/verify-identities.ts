import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import type {
  CaseDetail,
  SourceRevision,
} from "../packages/contracts/src/index";
import { migrate, pool } from "../apps/web/lib/server/db";

const base = "http://127.0.0.1:3000/api/v1";
const results: string[] = [];
async function api(path: string, method = "GET", body?: unknown): Promise<any> {
  const response = await fetch(base + path, {
    method,
    headers:
      body instanceof FormData
        ? undefined
        : { "Content-Type": "application/json" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  assert.ok(response.ok, `${path}: ${JSON.stringify(data)}`);
  return data;
}
async function settled(id: string): Promise<CaseDetail> {
  for (let i = 0; i < 160; i++) {
    const detail: CaseDetail = await api(`/cases/${id}`);
    if (
      !detail.jobs.some((j) => j.status === "running" || j.status === "queued")
    ) {
      assert.ok(
        !detail.jobs.some((j) => j.status === "failed"),
        JSON.stringify(detail.jobs.filter((j) => j.status === "failed")),
      );
      return detail;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Processing timeout");
}
async function build(id: string) {
  const detail: CaseDetail = await api(`/cases/${id}`);
  await api(`/cases/${id}/build`, "POST", {
    expectedRevision: detail.case.revision,
  });
  return settled(id);
}
async function uploadSpatial(id: string, spatial: unknown) {
  const form = new FormData();
  form.set("profile", "parcel-local-json-v1");
  form.set(
    "file",
    new Blob([JSON.stringify(spatial)], { type: "application/json" }),
    "identity-reassignment.json",
  );
  const source: SourceRevision = await api(
    `/cases/${id}/sources`,
    "POST",
    form,
  );
  await settled(id);
  return source;
}

try {
  const record = await api("/cases", "POST", {
    name: "Identity verification · C-001",
  });
  const empty: CaseDetail = await api(`/cases/${record.id}`);
  assert.equal(empty.identity.rootId.length, 30);
  assert.equal(empty.identity.spaces.length, 0);
  await api(`/cases/${record.id}/demo-inputs`, "POST", { dataset: "c001" });
  let detail = await settled(record.id);
  const prepare = {
    spatialSourceId: detail.sources.find(
      (s) => s.profile === "parcel-local-json-v1",
    )!.id,
    levelSourceId: detail.sources.find((s) => s.profile === "levels-csv-v1")!
      .id,
    controlSourceId: detail.sources.find((s) => s.profile === "control-csv-v1")!
      .id,
  };
  detail = await api(`/cases/${record.id}/prepare`, "POST", prepare);
  const originalIdentity = detail.identity;
  assert.equal(originalIdentity.rootId, empty.identity.rootId);
  assert.equal(originalIdentity.floors.length, 3);
  assert.equal(originalIdentity.spaces.length, 7);
  assert.equal(new Set(originalIdentity.spaces.map((s) => s.id)).size, 7);
  detail = await build(record.id);
  assert.deepEqual(detail.identity, originalIdentity);
  assert.ok(
    detail.model?.findings.some(
      (f) => Math.abs((f.overlap?.volume ?? 0) - 6.4) < 1e-8,
    ),
  );
  const revised = await api(`/cases/${record.id}/demo-levels`, "POST", {
    dataset: "c001",
  });
  detail = await settled(record.id);
  await api(`/cases/${record.id}/apply-levels`, "POST", {
    sourceId: revised.id,
    expectedRevision: detail.case.revision,
  });
  detail = await build(record.id);
  assert.deepEqual(detail.identity, originalIdentity);
  assert.ok(!detail.model?.findings.some((f) => f.overlap));
  results.push(
    "Parent, floor and space IDs survive r2 evidence correction, rebuild and reload; overlap changes 6.4 to 0.",
  );
  detail = await api(`/cases/${record.id}/prepare`, "POST", prepare);
  assert.deepEqual(detail.identity, originalIdentity);
  const spatial = JSON.parse(
    await readFile(
      new URL("../fixtures/c001/spatial.json", import.meta.url),
      "utf8",
    ),
  );
  const moved = structuredClone(spatial);
  moved.features.find((f: any) => f.alias === "U03").levelLabel =
    "Reassigned level";
  const source = await uploadSpatial(record.id, moved);
  const unitId = detail.units.find((u) => u.alias === "U03")!.id;
  const beforeSpace = originalIdentity.spaces.find((s) => s.unitId === unitId)!;
  detail = await api(`/cases/${record.id}/prepare`, "POST", {
    ...prepare,
    spatialSourceId: source.id,
  });
  const afterSpace = detail.identity.spaces.find((s) => s.unitId === unitId)!;
  assert.equal(afterSpace.id, beforeSpace.id);
  assert.notEqual(afterSpace.path, beforeSpace.path);
  assert.notEqual(afterSpace.parentId, beforeSpace.parentId);
  results.push(
    "Reassigning a unit to another named level changes its parent/path but preserves the permanent space ID.",
  );
  const removed = structuredClone(spatial);
  removed.features = removed.features.filter((f: any) => f.alias !== "U03");
  const removedSource = await uploadSpatial(record.id, removed);
  detail = await api(`/cases/${record.id}/prepare`, "POST", {
    ...prepare,
    spatialSourceId: removedSource.id,
  });
  assert.ok(!detail.identity.spaces.some((s) => s.unitId === unitId));
  detail = await api(`/cases/${record.id}/prepare`, "POST", prepare);
  assert.deepEqual(detail.identity, originalIdentity);
  results.push(
    "Repeated prepare and remove/reintroduce keep IDs; retired suffixes remain reserved.",
  );
  const stable = detail.identity;
  await migrate();
  await migrate();
  assert.deepEqual((await api(`/cases/${record.id}`)).identity, stable);
  results.push(
    "Two idempotent migration reruns preserve all allocated identities.",
  );
  const other = await api("/cases", "POST", {
    name: "Identity allocation concurrency",
  });
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      api(`/cases/${other.id}/units`, "POST", {
        alias: `U${i + 1}`,
        name: `Concurrent space ${i + 1}`,
        kind: "unit",
        levelLabel: i % 2 ? "Upper" : "Ground",
        lower: 0,
        upper: 3,
        footprint: [
          [i * 3, 0],
          [i * 3 + 2, 0],
          [i * 3 + 2, 2],
          [i * 3, 2],
        ],
      }),
    ),
  );
  const concurrent: CaseDetail = await api(`/cases/${other.id}`);
  assert.equal(concurrent.identity.floors.length, 2);
  assert.equal(new Set(concurrent.identity.spaces.map((s) => s.id)).size, 12);
  assert.notEqual(concurrent.identity.rootId, stable.rootId);
  results.push(
    "12 concurrent allocations create unique space suffixes and two shared floor records; another case has a different root.",
  );
  const real = await api("/cases", "POST", {
    name: "NYC public building · DOITT 353927",
    description:
      "Public NYC OTI footprint and reported roof height. Derived envelope only; interior floors and rooms unknown.",
  });
  await api(`/cases/${real.id}/demo-inputs`, "POST", { dataset: "real-nyc" });
  let realDetail = await settled(real.id);
  await api(`/cases/${real.id}/prepare`, "POST", {
    spatialSourceId: realDetail.sources.find(
      (s) => s.profile === "parcel-local-json-v1",
    )!.id,
    levelSourceId: realDetail.sources.find(
      (s) => s.profile === "levels-csv-v1",
    )!.id,
  });
  realDetail = await build(real.id);
  const provenance = JSON.parse(
    await readFile(
      new URL("../fixtures/real-nyc/provenance.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(realDetail.model!.units.length, 1);
  assert.equal(realDetail.identity.spaces.length, 1);
  assert.equal(realDetail.identity.floors[0].label, "Unassigned");
  const envelope = realDetail.model!.units[0];
  assert.ok(
    Math.abs(envelope.area - provenance.checks.projectedFootprintAreaM2) < 1e-5,
  );
  assert.ok(
    Math.abs(envelope.volume - provenance.checks.expectedEnvelopeVolumeM3) <
      1e-4,
  );
  assert.equal(envelope.height, provenance.conversion.roofHeightMetres);
  const originalResponse = await fetch(
    base + "/demo-assets/real-nyc/original.geojson",
  );
  assert.ok(originalResponse.ok);
  assert.equal(
    createHash("sha256")
      .update(Buffer.from(await originalResponse.arrayBuffer()))
      .digest("hex"),
    provenance.originalSha256,
  );
  results.push(
    "Actual NYC sample imports through the worker; projected footprint/height/volume match independent PostGIS quantities and original download hash.",
  );
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/identities-report.json",
    JSON.stringify(
      {
        results,
        syntheticCaseId: record.id,
        realCaseId: real.id,
        rootId: realDetail.identity.rootId,
        realQuantities: {
          area: envelope.area,
          height: envelope.height,
          volume: envelope.volume,
        },
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        passed: results.length,
        syntheticCaseId: record.id,
        realCaseId: real.id,
        rootId: realDetail.identity.rootId,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await pool().end();
}
