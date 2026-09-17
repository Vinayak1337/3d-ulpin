import test from "node:test";
import assert from "node:assert/strict";
import { usesGeographicNeighbours, automaticNeighbourAllowed } from "../apps/web/lib/server/neighbour-scenario-policy";

test("real reference checks never automatically consume invented neighbouring scenarios", () => {
  const real = [{ worldStatus: "observed" as const }];
  assert.equal(automaticNeighbourAllowed(real, "synthetic"), false);
  assert.equal(automaticNeighbourAllowed(real, "hypothetical"), false);
  assert.equal(automaticNeighbourAllowed(real, "observed"), true);
  assert.equal(automaticNeighbourAllowed(real, "planned"), true);
});
test("standalone fictional copies remain isolated despite overlapping real coordinates", () => {
  const demo = [{ worldStatus: "synthetic" as const }];
  assert.equal(usesGeographicNeighbours(demo), false);
  for (const status of ["observed", "planned", "hypothetical", "synthetic"] as const)
    assert.equal(automaticNeighbourAllowed(demo, status), false);
  assert.equal(usesGeographicNeighbours([]), false);
});
test("explicit mixed real/scenario blocks retain real geographic context", () => {
  assert.equal(usesGeographicNeighbours([{ worldStatus: "observed" }, { worldStatus: "synthetic" }]), true);
});
