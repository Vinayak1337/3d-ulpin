import assert from "node:assert/strict";
import { test } from "node:test";
import {
  openRegistryRing,
  recordBodySchema,
  querySchema,
} from "../apps/web/lib/server/registry";
import { buildResultSchema } from "../apps/web/lib/server/validation";

const footprint = [
  [0, 0],
  [2, 0],
  [2, 2],
  [0, 2],
];
const geometry = {
  id: "00000000-0000-4000-8000-000000000001",
  alias: "101",
  name: "Apartment",
  kind: "unit",
  footprint,
  lower: 0,
  upper: 3,
  lowerVerified: false,
  upperVerified: false,
  bindings: {},
  revision: 1,
  levelLabel: "Ground",
};
const body = {
  alias: "101",
  name: "Apartment",
  kind: "space",
  use: "apartment",
  footprint,
  geometry,
  links: [],
  rights: [],
  evidence: [],
  synthetic: true,
};
test("unsupported geometry is rejected rather than silently removed", () => {
  assert(recordBodySchema.safeParse(body).success);
  for (const extra of [
    { holes: [footprint] },
    { frame: { id: "OTHER" } },
    { geometry: { type: "MultiPolygon" } },
  ]) {
    assert(
      !recordBodySchema.safeParse({
        ...body,
        geometry: { ...geometry, ...extra },
      }).success,
    );
  }
});
test("query frames reject unsupported coordinate declarations", () => {
  const frame = {
    id: "LOCAL",
    horizontalUnit: "m",
    verticalUnit: "m",
    benchmark: "BM",
  };
  assert(
    querySchema.safeParse({ mode: "point", frame, point: [1, 1] }).success,
  );
  assert(
    !querySchema.safeParse({
      mode: "point",
      frame: { ...frame, crs: "EPSG:4326" },
      point: [1, 1],
    }).success,
  );
});
test("processor result validation preserves bound context provenance", () => {
  const context = {
    alias: "B",
    kind: "building",
    footprint,
    evidence: { sourceId: geometry.id, locator: "feature B" },
  };
  assert.deepEqual(buildResultSchema.shape.context.parse([context]), [context]);
});

test("closed rings keep one canonical record and prism footprint", () => {
  const ring = footprint as [number, number][];
  assert.deepEqual(openRegistryRing([...ring, ring[0]]), ring);
  assert.deepEqual(openRegistryRing(ring), ring);
  // Interior repeated vertices are not silently repaired.
  const invalid = [...ring, ring[1]];
  assert.deepEqual(openRegistryRing(invalid), invalid);
});
