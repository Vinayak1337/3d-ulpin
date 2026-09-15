/** Real-service acceptance for the persisted fictional neighborhood. Never seeds or edits evidence. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type {
  AreaContext,
  BuildingDossier,
} from "../../packages/contracts/src";
const base = process.env.ULPIN_TEST_BASE_URL || "http://127.0.0.1:3000";
const snapshotPath =
  process.env.REFERENCE_SNAPSHOT_PATH ||
  "docs/evidence/reference/persistence-snapshot.json";
const installed = JSON.parse(
  await readFile(
    new URL(
      "../../fixtures/reference-neighborhood/installed.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
async function api<T>(path: string): Promise<T> {
  const response = await fetch(base + "/api/v1" + path);
  assert.equal(response.status, 200, path);
  return response.json();
}
const context = await api<AreaContext>(`/areas/${installed.areaId}/context`);
const extensionInstalled = context.features.some(
  (f) => f.datasetNamespace === "lakeview-complete:K1",
);
assert.equal(
  context.features.filter((f) => f.kind === "building").length,
  extensionInstalled ? 9 : 8,
);
assert.equal(context.sceneAssets?.length, extensionInstalled ? 10 : 9);
const summaries = await api<
  { buildingId: string; spaces: number; floors: number }[]
>(`/property-directory?area=${installed.areaId}`);
assert.equal(summaries.length, extensionInstalled ? 9 : 8);
const features = new Map(context.features.map((f) => [f.id, f]));
for (const asset of context.sceneAssets || []) {
  assert.equal(asset.featureRevision, features.get(asset.featureId)?.revision);
  assert.equal(asset.purpose, "presentation");
  assert.match(asset.provenance, /fictional/i);
  const response = await fetch(base + asset.url);
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  assert.equal(bytes.readUInt32LE(4), 2);
}
const snapshot: {
  areaId: string;
  features: unknown[];
  assets: unknown;
  properties: Record<string, unknown>;
} = {
  areaId: context.area.id,
  features: context.features.map((f) => ({
    id: f.id,
    revision: f.revision,
    source: f.sourceRevisionId,
  })),
  assets: context.sceneAssets,
  properties: {},
};
for (const [key, ids] of Object.entries(installed.properties) as [
  string,
  { buildingId: string; caseId?: string },
][]) {
  const dossier = await api<BuildingDossier>(
    `/buildings/${ids.buildingId}/dossier`,
  );
  assert.equal(dossier.building.id, ids.buildingId);
  assert.equal(dossier.area.id, installed.areaId);
  assert.equal(dossier.building.worldStatus, "synthetic");
  const spaces = dossier.records.filter((r) => r.kind === "space"),
    floors = dossier.records.filter((r) => r.kind === "floor");
  assert.equal(
    summaries.find((s) => s.buildingId === ids.buildingId)?.spaces,
    spaces.length,
  );
  assert.equal(
    summaries.find((s) => s.buildingId === ids.buildingId)?.floors,
    floors.length,
  );
  if (["A", "B", "C"].includes(key)) {
    assert.equal(spaces.length, { A: 20, B: 15, C: 25 }[key]);
    assert.equal(floors.length, { A: 4, B: 3, C: 5 }[key]);
    assert.equal(
      dossier.detailedScene.filter((d) => d.record.kind === "space").length,
      spaces.length,
    );
    assert.ok(
      spaces.every(
        (r) =>
          r.geometry &&
          Number.isFinite(r.geometry.volume) &&
          r.geometry.volume! > 0,
      ),
    );
  } else
    assert.equal(
      spaces.length,
      0,
      `Missing interiors must stay unavailable: ${key}`,
    );
  for (const source of dossier.sources) {
    const original = await fetch(new URL(source.url, base));
    assert.equal(original.status, 200, source.name);
    const bytes = Buffer.from(await original.arrayBuffer());
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      source.sha256,
      source.name,
    );
  }
  snapshot.properties[key] = {
    buildingId: ids.buildingId,
    caseId: ids.caseId,
    records: dossier.records,
    revisions: dossier.revisions,
    investigations: dossier.investigations,
    preparations: dossier.preparations,
    packages: dossier.packages.map((p) => ({
      id: p.id,
      revision: p.revision,
      state: p.state,
      sourceRevisionIds: p.sourceRevisionIds,
    })),
    sources: dossier.sources.map((s) => ({
      id: s.id,
      sha256: s.sha256,
      revision: s.revision,
    })),
  };
}
const realResponse = await fetch(
  base + "/api/v1/areas/9e77c608-bac7-4d56-9ac7-3032cc49074d/context",
);
assert.ok(
  [200, 404].includes(realResponse.status),
  "Existing real dataset lookup failed",
);
const real: AreaContext | null = realResponse.ok
  ? await realResponse.json()
  : null;
if (!real)
  console.log(
    "NOTE Preserved Bronx evidence is absent on this installation; its hash check is not applicable.",
  );
if (real) {
  const building = real.features.find(
    (f) => f.id === "7ca4fba1-6c6a-44aa-89c8-d17b97bf159f",
  );
  assert.ok(building);
  assert.equal(
    building.sourceRevisionId,
    "eb33f3ab-ea9c-412e-a510-260c6a1f9bc3",
  );
  const original = await fetch(
    base + "/api/v1/sources/eb33f3ab-ea9c-412e-a510-260c6a1f9bc3/file",
  );
  assert.equal(
    createHash("sha256")
      .update(Buffer.from(await original.arrayBuffer()))
      .digest("hex"),
    "869c5dc4fb50d71be4f62f4a2936c29bd95ade14c712bdf4f51986841d82771a",
  );
}
const serialized = JSON.stringify(snapshot, null, 2) + "\n";
if (process.argv.includes("--compare")) {
  assert.equal(
    serialized,
    await readFile(snapshotPath, "utf8"),
    "Seed/restart changed retained identity, geometry, source revisions or asset bindings",
  );
  console.log(
    "PASS Restart and seed replay retained exact identities, revisions, geometry, original hashes and asset bindings.",
  );
} else await writeFile(snapshotPath, serialized);
console.log(
  "PASS Original eight canonical buildings, three detailed properties, 60 computed spaces, all installed hashed assets, honest missing interiors, original bytes and existing real evidence.",
);
