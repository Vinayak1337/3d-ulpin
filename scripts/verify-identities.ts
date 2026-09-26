import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import type {
  CaseDetail,
} from "../packages/contracts/src/index";
import { migrate, pool } from "@ulpin/server/infrastructure/db";

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

try {
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
  assert.equal(realDetail.identity.rootId.length, 30);
  assert.equal(realDetail.identity.spaces.length, 1);
  const identity = realDetail.identity;
  await migrate();
  await migrate();
  assert.deepEqual((await api(`/cases/${real.id}`)).identity, identity);
  results.push("Repeated schema migration preserves the real source identity allocation.");
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
