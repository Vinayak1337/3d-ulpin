import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ComputedUnit,
  ModelSnapshot,
  Point2,
} from "../packages/contracts/src/index";
import {
  buildBuildingScene,
  exteriorEdges,
} from "../apps/web/lib/ui/building-scene";

function unit(
  id: string,
  footprint: Point2[],
  lower = 0,
  upper = 3,
): ComputedUnit {
  const area =
    Math.abs(
      footprint.reduce((sum, point, index) => {
        const next = footprint[(index + 1) % footprint.length];
        return sum + point[0] * next[1] - next[0] * point[1];
      }, 0),
    ) / 2;
  return {
    id,
    alias: id,
    name: id,
    footprint,
    lower,
    upper,
    area,
    height: upper - lower,
    volume: area * (upper - lower),
    kind: "unit",
    lowerVerified: true,
    upperVerified: true,
    bindings: {},
    revision: 1,
    levelLabel: lower === 0 ? "Ground" : "Upper",
  };
}

const west = unit("west", [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]);
const east = unit("east", [
  [4, 0],
  [8, 0],
  [8, 4],
  [4, 4],
]);
const perimeter = (units: ComputedUnit[]) =>
  exteriorEdges(units).reduce((sum, edge) => sum + edge.length, 0);

test("adjacent properties do not receive façade windows on their shared wall", () => {
  const edges = exteriorEdges([west, east]);
  assert.equal(perimeter([west, east]), 24);
  assert.ok(!edges.some((edge) => edge.a[0] === 4 && edge.b[0] === 4));
});

test("clockwise and anticlockwise source rings have the same exterior", () => {
  assert.equal(
    perimeter([west, { ...east, footprint: [...east.footprint].reverse() }]),
    24,
  );
});

test("partially shared walls preserve only their exposed spans", () => {
  const partial = unit("partial", [
    [4, 1],
    [8, 1],
    [8, 3],
    [4, 3],
  ]);
  const exposed = exteriorEdges([west, partial]).filter(
    (edge) => edge.ownerId === "west" && edge.a[0] === 4 && edge.b[0] === 4,
  );
  assert.equal(
    exposed.reduce((sum, edge) => sum + edge.length, 0),
    2,
  );
  assert.ok(
    exposed.every(
      (edge) =>
        Math.max(edge.a[1], edge.b[1]) <= 1 ||
        Math.min(edge.a[1], edge.b[1]) >= 3,
    ),
  );
});

test("different storeys do not hide each other's exterior walls", () => {
  const upper = {
    ...east,
    id: "upper",
    lower: 3,
    upper: 6,
    levelLabel: "Upper",
  };
  assert.equal(perimeter([west, upper]), 32);
});

test("concave footprints retain their re-entrant edges", () => {
  const concave = unit("L", [
    [0, 0],
    [4, 0],
    [4, 2],
    [2, 2],
    [2, 4],
    [0, 4],
  ]);
  assert.equal(perimeter([concave]), 16);
  assert.equal(exteriorEdges([concave]).length, 6);
});

test("scene generation and explosion never mutate measured model data", () => {
  const model: ModelSnapshot = {
    id: "snapshot",
    caseId: "case",
    revision: 1,
    frame: {
      id: "LOCAL",
      horizontalUnit: "m",
      verticalUnit: "m",
      benchmark: "BM",
    },
    units: [west, east],
    context: [],
    findings: [],
    inputFingerprint: "fixture",
    createdAt: "2026-09-12T00:00:00Z",
    method: "polygon-prism",
  };
  const before = JSON.stringify(model);
  const scene = buildBuildingScene(
    model,
    model.units,
    new Map([[west.id, 2]]),
    false,
  );
  assert.equal(JSON.stringify(model), before);
  assert.ok(scene.meshes.some((mesh) => mesh.material === "glass"));
  assert.ok(scene.entrance);
  for (const mesh of scene.meshes) {
    assert.ok(mesh.positions.every(Number.isFinite));
    assert.ok(mesh.normals.every(Number.isFinite));
    assert.equal(mesh.positions.length, mesh.normals.length);
    assert.ok(
      mesh.indices.every(
        (index) => index >= 0 && index < mesh.positions.length / 3,
      ),
    );
    assert.ok(
      [west.id, east.id].includes(mesh.ownerId) ||
        mesh.ownerId.startsWith("context:"),
    );
  }
});

test("a vertical benchmark offset moves the entire architectural presentation together", () => {
  const model: ModelSnapshot = {
    id: "datum",
    caseId: "case",
    revision: 1,
    frame: {
      id: "LOCAL",
      horizontalUnit: "m",
      verticalUnit: "m",
      benchmark: "BM",
    },
    units: [west, east],
    context: [],
    findings: [],
    inputFingerprint: "fixture",
    createdAt: "2026-09-12T00:00:00Z",
    method: "polygon-prism",
  };
  const shifted: ModelSnapshot = {
    ...model,
    units: model.units.map((item) => ({
      ...item,
      lower: item.lower + 100,
      upper: item.upper + 100,
    })),
  };
  for (const reveal of [false, true]) {
    const original = buildBuildingScene(model, model.units, new Map(), reveal);
    const translated = buildBuildingScene(
      shifted,
      shifted.units,
      new Map(),
      reveal,
    );
    assert.ok(Math.abs(translated.grade - original.grade - 100) < 1e-9);
    assert.equal(translated.meshes.length, original.meshes.length);
    for (let i = 0; i < original.meshes.length; i++) {
      const a = original.meshes[i],
        b = translated.meshes[i];
      assert.equal(a.ownerId, b.ownerId);
      assert.equal(a.positions.length, b.positions.length);
      for (let k = 0; k < a.positions.length; k++) {
        const expected = a.positions[k] + (k % 3 === 2 ? 100 : 0);
        assert.ok(
          Math.abs(b.positions[k] - expected) < 1e-8,
          `${a.material} coordinate ${k}`,
        );
      }
    }
  }
});
