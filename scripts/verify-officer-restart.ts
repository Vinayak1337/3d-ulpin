import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// Read-only checkpoint around an operator-coordinated service restart.
const base = process.env.ULPIN_TEST_BASE_URL ?? "http://127.0.0.1:3000";
const mode = process.argv[2];
const investigationId = process.argv[3];
assert(
  ["before", "after"].includes(mode) && investigationId,
  "Usage: tsx scripts/verify-officer-restart.ts before|after INVESTIGATION_UUID",
);
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function get(path: string) {
  const response = await fetch(base + "/api/v1" + path);
  assert.equal(response.status, 200, path);
  return response.json();
}
const real = await get("/areas/9e77c608-bac7-4d56-9ac7-3032cc49074d/context");
const investigation = await get(`/investigations/${investigationId}`);
const dossiers = await Promise.all([
  get(`/buildings/${investigation.buildingId}/dossier`),
  get("/buildings/2d5d12c8-1fa5-42a1-a3a9-80f8fad10ff6/dossier"),
]);
assert.equal(real.features.length, 62);
assert.equal(investigation.status, "CLOSED");
assert(investigation.findings.some((f: any) => Math.abs(f.areaM2 - 20) < 1e-6));
const sourceChecks = [];
for (const source of new Map(
  dossiers.flatMap((d: any) => d.sources).map((s: any) => [s.id, s]),
).values() as any) {
  const url = new URL(source.url, base);
  assert.equal(
    url.origin,
    new URL(base).origin,
    "Original evidence must resolve locally.",
  );
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256);
  sourceChecks.push({
    id: source.id,
    sha256: source.sha256,
    bytes: bytes.length,
  });
}
const stable = {
  realCount: real.features.length,
  realIdentities: digest(
    real.features
      .map((f: any) => [
        f.id,
        f.identifier,
        f.revision,
        f.sourceRevisionId,
        f.geometry,
      ])
      .sort(),
  ),
  properties: dossiers.map((d: any) => ({
    id: d.building.id,
    identifier: d.building.identifier,
    records: digest(d.records),
    sources: d.sources.map((s: any) => [s.id, s.sha256]).sort(),
    preparations: d.preparations
      .map((p: any) => [p.id, p.caseId, p.packageId, p.revision])
      .sort(),
  })),
  investigationId,
  investigationDigest: digest(investigation),
  status: investigation.status,
  revision: investigation.revision,
  areaRevision: investigation.inputSnapshot.areaRevision,
  exactAreaM2: 20,
};
await mkdir("test-results", { recursive: true });
const path = "test-results/officer-restart-checkpoint.json";
if (mode === "before") {
  await writeFile(
    path,
    JSON.stringify(
      { at: new Date().toISOString(), stable, sourceChecks },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `PASS Restart checkpoint: 62 real features, two property registers, closed investigation, ${sourceChecks.length} original source hashes.`,
  );
} else {
  const prior = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(
    stable,
    prior.stable,
    "Restart must preserve the exact saved identities, geometry, sources and investigation.",
  );
  const report = {
    before: prior.at,
    after: new Date().toISOString(),
    status: "passed",
    scope:
      "Read-only API/byte checks around full local service + web/dispatcher restart. Browser/offline actions recorded separately.",
    stable,
    sourceChecks,
  };
  await mkdir("docs/evidence", { recursive: true });
  await writeFile(
    "docs/evidence/officer-restart.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `PASS Full restart preserved both detailed registers, exact closed case, 62 real features and ${sourceChecks.length} locally reopened original source hashes.`,
  );
}
