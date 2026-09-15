import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { areaGeo } from "../apps/web/lib/server/areas";
import { pool } from "../apps/web/lib/server/db";

// Authored software fixture only. It never enters the user's area or storage.
const source = "synthetic-horizontal-performance-r1";
const evidence = [
  { sourceRevisionId: source, featureId: "authored-150-feature-fixture" },
];
function feature(
  id: string,
  kind: string,
  role: string,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  return {
    id,
    kind,
    revision: 1,
    sourceRevisionId: source,
    evidence,
    worldStatus: "synthetic",
    semantics: { geometryRole: role, evidenceState: "source_supported" },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
          [x, y],
        ],
      ],
    },
  };
}
const features = [],
  associations = [];
for (let index = 0; index < 50; index++) {
  const x = (index % 10) * 30,
    y = Math.floor(index / 10) * 30;
  features.push(
    feature(
      `B${index}`,
      "building",
      "observed_ground_occupation",
      x,
      y,
      12,
      10,
    ),
    feature(`P${index}`, "parcel", "recorded_parcel", x, y, 10, 10),
    feature(`R${index}`, "road", "public_road_land", x + 10, y - 5, 6, 20),
  );
  associations.push({
    id: `A${index}`,
    buildingId: `B${index}`,
    parcelId: `P${index}`,
    revision: 1,
    status: "confirmed",
    evidence,
  });
}
const payload = {
  reference: {
    sourceCrs: "EPSG:32643",
    analysisCrs: "EPSG:32643",
    origin: [500000, 3100000],
  },
  features,
  associations,
};
try {
  const samplesMs = [];
  for (let sample = 0; sample < 10; sample++) {
    const started = performance.now();
    const result = await areaGeo<{
      findings: { code: string; areaM2?: number }[];
      coverage: unknown;
    }>("check", payload);
    samplesMs.push(Math.round((performance.now() - started) * 100) / 100);
    const outside = result.findings.filter(
      (f) => f.code === "OUTSIDE_CONFIRMED_PARCEL",
    );
    assert.equal(outside.length, 50);
    assert(outside.every((f) => Math.abs(f.areaM2! - 20) < 1e-8));
  }
  const warm = samplesMs.slice(1).sort((a, b) => a - b);
  const p95Ms = warm[Math.ceil(warm.length * 0.95) - 1];
  const report = {
    at: new Date().toISOString(),
    hardware: {
      cpu: os.cpus()[0].model,
      architecture: os.arch(),
      ramGiB: os.totalmem() / 1024 ** 3,
      node: process.version,
    },
    dataClass: "authored synthetic software fixture; no real survey inference",
    features: features.length,
    vertices: 750,
    confirmedAssociations: 50,
    inputSha256: createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex"),
    method:
      "Local authenticated HTTP request to running Python /internal/area/check, including JSON serialization/transport/parsing; no database or browser rendering time. Services were already warm. First request reported separately, not a machine cold start.",
    samplesMs,
    firstRequestMs: samplesMs[0],
    warmSamples: warm.length,
    warmP95Ms: p95Ms,
    targetMs: 5000,
    targetMet: p95Ms <= 5000,
    expected:
      "50 independently specified exact20m² outside strips, all verified on every run.",
  };
  await mkdir("docs/evidence", { recursive: true });
  await writeFile(
    "docs/evidence/horizontal-performance.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      features: 150,
      samples: 10,
      firstMs: samplesMs[0],
      warmP95Ms: p95Ms,
      targetMet: report.targetMet,
    }),
  );
} finally {
  await pool().end();
}
