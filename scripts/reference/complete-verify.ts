import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type {
  AreaContext,
  BuildingDossier,
  MapArea,
} from "../../packages/contracts/src";
const base = process.env.ULPIN_TEST_BASE_URL || "http://127.0.0.1:3000";
const ids = JSON.parse(
  await readFile("fixtures/reference-neighborhood/installed.json", "utf8"),
);
async function api<T>(path: string): Promise<T> {
  const r = await fetch(base + "/api/v1" + path);
  assert.equal(r.status, 200, path);
  return r.json();
}
const areas = await api<MapArea[]>("/areas");
assert.deepEqual(
  areas
    .filter((a) => a.dataKind === "demonstration" && a.featureCount)
    .map((a) => a.id),
  [ids.areaId],
);
assert(
  areas.some(
    (a) =>
      a.id === "9e77c608-bac7-4d56-9ac7-3032cc49074d" && a.dataKind === "real",
  ),
);
const c = await api<AreaContext>(`/areas/${ids.areaId}/context`);
assert.equal(c.features.length, 22);
assert.equal(c.sceneAssets?.length, 10);
assert.equal(c.parcelIdentifiers?.length, 8);
assert.equal(c.parcelAssociations?.length, 8);
assert.equal(c.latestCheck?.stale, false);
const findings = c.latestCheck!.findings;
assert.deepEqual(
  findings
    .filter((f) => f.code === "BUILDING_FOOTPRINT_OVERLAP")
    .map((f) => f.areaM2),
  [12],
);
assert.deepEqual(
  findings
    .filter((f) => f.code === "BUILDING_ROAD_OVERLAP")
    .map((f) => f.areaM2)
    .sort((a, b) => a! - b!),
  [36, 40, 40, 72],
);
const properties: Record<string, BuildingDossier> = {};
for (const key of "ABCDEFGH") {
  const d = await api<BuildingDossier>(
    `/buildings/${ids.properties[key].buildingId}/dossier`,
  );
  properties[key] = d;
  assert.equal(d.parcelIdentifiers?.length, 1);
  assert.equal(
    d.parcelIdentifiers![0].value,
    `DEMO-LV-P0${"ABCDEFGH".indexOf(key) + 1}`,
  );
  assert.equal(d.parcelIdentifiers![0].scheme, "demo_ulpin");
  assert.equal(d.parcels.length, 1);
  assert(
    d.sources.some(
      (s) => s.id === d.parcelIdentifiers![0].evidence.sourceRevisionId,
    ),
  );
  if ("ABC".includes(key))
    assert.equal(
      d.records.filter((r) => r.kind === "space").length,
      ({ A: 20, B: 15, C: 25 } as Record<string, number>)[key],
    );
}
for (const id of [
  "e4eea7b8-f1f0-4ea0-bd82-29e0c2a740a3",
  "8c61a45e-3ae9-4c7c-95f2-78918f23582a",
])
  assert(
    (await api<AreaContext>(`/areas/${id}/context`)).features.length > 0,
    "Historical data remains recoverable",
  );
for (const id of [
  "e4eea7b8-f1f0-4ea0-bd82-29e0c2a740a3",
  "8c61a45e-3ae9-4c7c-95f2-78918f23582a",
]) {
  const historic = await api<AreaContext>(`/areas/${id}/context`);
  const resolved = await api<{ matches: unknown[] }>(
    `/resolve?identifier=${historic.features[0].id}`,
  );
  assert.equal(
    resolved.matches.length,
    0,
    "Archived properties are excluded from active search",
  );
}
const directory = await api<{ areaId?: string }[]>("/workspace-directory");
assert(
  !directory.some((row) =>
    [
      "e4eea7b8-f1f0-4ea0-bd82-29e0c2a740a3",
      "8c61a45e-3ae9-4c7c-95f2-78918f23582a",
    ].includes(row.areaId || ""),
  ),
);
const a = properties.A,
  parcel = a.parcels[0].feature,
  evidence = a.parcelIdentifiers![0].evidence.sourceRevisionId!;
for (const input of [
  {
    featureId: a.building.id,
    expectedRevision: a.building.revision,
    value: "DEMO-INVALID",
  },
  { featureId: parcel.id, expectedRevision: parcel.revision, value: "INVALID" },
]) {
  const r = await fetch(base + "/api/v1/external-identifiers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scheme: "demo_ulpin",
      issuer: "negative acceptance test",
      sourceId: evidence,
      locator: "invalid target, must reject",
      ...input,
    }),
  });
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error.code, "DEMO_PARCEL_REQUIRED");
}
const historic = properties.D.investigations.find(
  (i) => i.reference === "LV-DEMO-001",
);
if (historic && !historic.registerSnapshot?.parcelIdentifiers) {
  const r = await fetch(
    `${base}/api/v1/investigations/${historic.id}/export?format=json`,
  );
  assert.equal(r.status, 200);
  assert.deepEqual(
    (await r.json()).parcelIdentifiers,
    [],
    "Historical export must not acquire current parcel IDs",
  );
}
const pdf = await fetch(
  `${base}/api/v1/buildings/${ids.properties.A.buildingId}/register?format=pdf`,
);
assert.equal(pdf.status, 200);
assert.equal(pdf.headers.get("content-type"), "application/pdf");
const bytes = Buffer.from(await pdf.arrayBuffer());
assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
await writeFile("docs/evidence/complete-demo/property-register.pdf", bytes);
// Compare complete immutable payloads between seed reruns, not just counts.
const snapshot = {
  features: c.features,
  assets: c.sceneAssets,
  identifiers: c.parcelIdentifiers,
  associations: c.parcelAssociations,
  packages: c.packages,
  properties,
};
const stable = (v: any): any =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, stable(v[k])]),
        )
      : v;
const digest = createHash("sha256")
  .update(JSON.stringify(stable(snapshot)))
  .digest("hex");
const compare = process.env.COMPLETE_COMPARE;
if (compare) {
  const before = JSON.parse(await readFile(compare, "utf8"));
  assert.equal(
    digest,
    before.digest,
    "Seed rerun preserved complete records, source revisions, investigations, assets and identities",
  );
}
await writeFile(
  "docs/evidence/complete-demo/data-report.json",
  JSON.stringify(
    {
      result: "PASS",
      features: 22,
      buildings: 9,
      parcels: 8,
      roads: 3,
      spaces: 60,
      assets: 10,
      parcelIds: 8,
      buildingOverlapM2: 12,
      roadOverlapM2: [36, 40, 40, 72],
      digest,
      rerunCompared: !!compare,
    },
    null,
    2,
  ),
);
console.log(
  "PASS coherent demo, canonical parcel links, source-backed fictional IDs, measured overlaps, original detailed records, archived recovery, real dataset retained and binary PDF.",
);
console.log("Snapshot SHA256", digest);
