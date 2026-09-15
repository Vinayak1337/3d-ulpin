/** Real-service scope and original-source integrity checks. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
const { unzipSync } = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
)("fflate") as typeof import("../../apps/web/node_modules/fflate");
const base = process.env.ULPIN_TEST_BASE_URL || "http://127.0.0.1:3000";
const ids = JSON.parse(
  await readFile("fixtures/reference-neighborhood/installed.json", "utf8"),
);
const dir = "docs/evidence/register-controls";
async function json(path: string) {
  const r = await fetch(base + "/api/v1" + path);
  assert.equal(r.status, 200, path);
  return r.json();
}
const d = await json(`/buildings/${ids.properties.A.buildingId}/dossier`);
const floors = d.records.filter((r: any) => r.kind === "floor");
const floor = floors[0];
const unit = d.records.find(
  (r: any) =>
    r.kind === "space" &&
    r.links.some((l: any) => l.type === "floor" && l.targetId === floor.id),
);
const checks: string[] = [];
for (const f of floors) {
  const data = await json(
    `/buildings/${d.building.id}/register?format=json&record=${f.id}`,
  );
  const expected = d.records
    .filter(
      (r: any) =>
        r.id === f.id ||
        (r.kind === "space" &&
          r.links.some(
            (l: any) =>
              (l.type === "floor" || l.type === "within") &&
              l.targetId === f.id,
          )),
    )
    .map((r: any) => r.id)
    .sort();
  assert.deepEqual(data.register.map((r: any) => r.id).sort(), expected);
  assert.equal(data.ulpin3d, f.identifier);
  assert.equal(data.buildingUlpin3d, d.building.identifier);
  assert.equal(data.parcelIdentifiers[0].value, "DEMO-LV-P01");
  assert(data.register.every((r: any) => r.ulpin3d === r.identifier));
}
checks.push(
  "Every floor exports only its own records, canonical 3D ULPIN, parent building and parcel 2D ULPIN",
);
const u = await json(
  `/buildings/${d.building.id}/register?format=json&record=${unit.id}`,
);
assert.deepEqual(
  u.register.map((r: any) => r.id),
  [unit.id],
);
assert.equal(u.ulpin3d, unit.identifier);
checks.push("Unit scope exports exactly one recorded unit");
const foreign = (
  await json(`/buildings/${ids.properties.B.buildingId}/dossier`)
).records.find((r: any) => r.kind === "floor");
const bad = await fetch(
  `${base}/api/v1/buildings/${d.building.id}/register?format=json&record=${foreign.id}`,
);
assert.equal(bad.status, 404);
checks.push("Foreign floor ID rejected");
for (const [name, path] of [
  ["floor", `/buildings/${d.building.id}/register?record=${floor.id}`],
  ["unit", `/buildings/${d.building.id}/register?record=${unit.id}`],
  ["building", `/buildings/${d.building.id}/register?`],
  ["block", `/areas/${ids.areaId}/register?`],
]) {
  const r = await fetch(`${base}/api/v1${path}&format=zip`);
  assert.equal(r.status, 200, `${name} bundle`);
  assert.equal(r.headers.get("content-type"), "application/zip");
  const bytes = new Uint8Array(await r.arrayBuffer());
  const files = unzipSync(bytes);
  const manifest = JSON.parse(Buffer.from(files["sources.json"]).toString());
  const data = JSON.parse(Buffer.from(files["register.json"]).toString());
  assert.equal(
    Buffer.from(files["register.pdf"]).subarray(0, 5).toString(),
    "%PDF-",
  );
  assert(manifest.sources.length > 0);
  for (const source of manifest.sources) {
    assert(files[source.path]);
    assert.equal(
      createHash("sha256").update(files[source.path]).digest("hex"),
      source.sha256,
    );
    assert.equal(files[source.path].length, source.bytes);
  }
  if (name === "block") {
    assert.equal(data.features.length, 22);
    assert.equal(data.properties.length, 9);
    assert.equal(data.parcelIdentifiers.length, 8);
    assert(data.ulpin3d);
    assert.equal(
      data.properties
        .flatMap((p: any) => p.register)
        .filter((r: any) => r.kind === "space").length,
      60,
    );
  }
  if (name === "floor") assert.equal(data.selection.id, floor.id);
  if (name === "unit") assert.equal(data.selection.id, unit.id);
  await writeFile(`${dir}/${name}-register.pdf`, files["register.pdf"]);
  if (name === "floor" || name === "block")
    await writeFile(`${dir}/${name}-with-sources.zip`, bytes);
  checks.push(
    `${name}: PDF + scoped JSON + ${manifest.sources.length} byte-identical original attachments, verified against SHA-256`,
  );
  console.log("PASS", checks.at(-1));
}
const csv = await fetch(
  `${base}/api/v1/buildings/${d.building.id}/register?format=csv&record=${floor.id}`,
);
assert.equal(csv.status, 200);
const text = await csv.text();
assert(text.includes(floor.identifier) && text.includes("DEMO-LV-P01"));
assert(!text.includes(floors[1].identifier));
checks.push(
  "Floor CSV includes both identifier types and excludes other floors",
);
await writeFile(
  `${dir}/export-report.json`,
  JSON.stringify(
    {
      result: "PASS",
      checks,
      buildingId: d.building.id,
      floorId: floor.id,
      unitId: unit.id,
      buildingUlpin: d.building.identifier,
      floorUlpin: floor.identifier,
      unitUlpin: unit.identifier,
      parcelUlpin: "DEMO-LV-P01",
    },
    null,
    2,
  ),
);
console.log("PASS", checks.length, "export checks");
