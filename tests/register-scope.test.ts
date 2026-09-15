import test from "node:test";
import assert from "node:assert/strict";
import type {
  BuildingDossier,
  RegistryRecord,
} from "../packages/contracts/src";
import { selectRegisterScope } from "../apps/web/lib/register-scope";
const record = (
  id: string,
  kind: RegistryRecord["kind"],
  links: RegistryRecord["links"] = [],
) =>
  ({
    id,
    kind,
    links,
    identifier: "3DU-TEST:" + id,
    name: id,
  }) as RegistryRecord;
const records = [
  record("F1", "floor"),
  record("F2", "floor"),
  record("S1", "space", [{ type: "floor", targetId: "F1" }]),
  record("S2", "space", [{ type: "floor", targetId: "F2" }]),
  record("C1", "space", [{ type: "floor", targetId: "F1" }]),
];
const d = {
  building: { id: "B", identifier: "3DU-TEST:B", name: "Building" },
  records,
  detailedScene: records.map((record) => ({ record })),
  sources: [{ id: "original" }],
} as BuildingDossier;
test("floor scope excludes other floors while retaining original objects", () => {
  const selected = selectRegisterScope(d, "F1")!;
  assert.deepEqual(
    selected.dossier.records.map((r) => r.id),
    ["F1", "S1", "C1"],
  );
  assert.equal(selected.selection.ulpin3d, "3DU-TEST:F1");
  assert.equal(selected.dossier.sources, d.sources);
  assert.equal(d.records.length, 5);
  assert.equal(selected.dossier.records[0], d.records[0]);
});
test("unit scope returns only that unit; foreign record is rejected", () => {
  assert.deepEqual(
    selectRegisterScope(d, "S2")!.dossier.records.map((r) => r.id),
    ["S2"],
  );
  assert.equal(selectRegisterScope(d, "foreign"), null);
});
test("whole building remains unchanged", () => {
  assert.equal(selectRegisterScope(d)!.dossier, d);
  assert.equal(selectRegisterScope(d, "B")!.dossier, d);
});
