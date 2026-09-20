import test from "node:test";
import assert from "node:assert/strict";
import type { SpatialMlCalibration, SpatialMlItem } from "@ulpin/contracts";
import { deriveSpatialMlGeometry, spatialMlBatchSchema, validateSpatialMlPixels } from "../apps/web/lib/server/spatial-ml";

const calibration: SpatialMlCalibration = { rasterSha256: "a".repeat(64), imagePoints: [[0, 0], [100, 0]], worldPoints: [[10, 20], [20, 20]], frame: "test-drawing-metres", reason: "Synthetic documented control pair" };
const item = {
  state: "succeeded", result: {
    raster: { sha256: "a".repeat(64), width: 100, height: 100 },
    components: [{ id: "room-1", className: "room", score: .8, geometry: { type: "Polygon", coordinates: [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]], [[20, 20], [20, 40], [40, 40], [40, 20], [20, 20]]] } }],
  },
} as SpatialMlItem;

test("model pixel calibration retains holes and flips image Y exactly once", () => {
  const before = JSON.stringify(item);
  const output = deriveSpatialMlGeometry(item, calibration)[0];
  assert.equal(output.geometry.type, "Polygon");
  assert.deepEqual(output.geometry.coordinates[0], [[10, 20], [20, 20], [20, 10], [10, 10], [10, 20]]);
  assert.deepEqual(output.geometry.coordinates[1], [[12, 18], [12, 16], [14, 16], [14, 18], [12, 18]]);
  assert.equal(JSON.stringify(item), before);
});
test("rotated controls preserve multipart model components", () => {
  const multi = structuredClone(item);
  const polygon = multi.result!.components[0].geometry;
  assert.equal(polygon.type, "Polygon");
  multi.result!.components[0].geometry = { type: "MultiPolygon", coordinates: [polygon.coordinates, [[[50, 50], [70, 50], [70, 70], [50, 70], [50, 50]]]] };
  const output = deriveSpatialMlGeometry(multi, { ...calibration, worldPoints: [[10, 20], [10, 30]] })[0];
  assert.equal(output.geometry.type, "MultiPolygon");
  assert.deepEqual(output.geometry.coordinates[0][0][1], [10, 30]);
  assert.deepEqual(output.geometry.coordinates[1][0][0], [15, 25]);
});
test("different raster, impossible controls and nonready result cannot produce metric proposals", () => {
  assert.throws(() => deriveSpatialMlGeometry(item, { ...calibration, rasterSha256: "b".repeat(64) }), /different raster/);
  assert.throws(() => deriveSpatialMlGeometry(item, { ...calibration, imagePoints: [[0, 0], [101, 0]] }), /retained inference raster/);
  assert.throws(() => deriveSpatialMlGeometry(item, { ...calibration, imagePoints: [[0, 0], [0, 0]] }), /distinct/);
  assert.throws(() => deriveSpatialMlGeometry(item, { ...calibration, worldPoints: [[1, 1], [1, 1]] }), /distinct/);
  assert.throws(() => deriveSpatialMlGeometry({ ...item, state: "empty" }, calibration), /nonempty/);
  assert.throws(() => deriveSpatialMlGeometry(item, { ...calibration, frame: "" }));
});
test("pixel rings cannot escape the retained raster or silently lose closure", () => {
  const components = structuredClone(item.result!.components);
  components[0].geometry.coordinates[0][0] = [-1, 0];
  assert.throws(() => validateSpatialMlPixels(components, 100, 100), /raster grid/);
  assert.throws(() => validateSpatialMlPixels([item.result!.components[0], item.result!.components[0]], 100, 100), /not unique/);
});
test("batch selection is bounded and rejects arbitrary processor input", () => {
  const id = "10000000-0000-4000-8000-000000000000";
  const source = { sourceRevisionId: id, partId: id, task: "floor-plan", page: 1 };
  assert(spatialMlBatchSchema.safeParse({ packageId: id, expectedRevision: 1, requestKey: id, items: [source] }).success);
  assert(!spatialMlBatchSchema.safeParse({ packageId: id, expectedRevision: 1, requestKey: id, items: Array(13).fill(source) }).success);
  assert(!spatialMlBatchSchema.safeParse({ packageId: id, expectedRevision: 1, requestKey: id, items: [{ ...source, objectKey: "unselected-original" }] }).success);
  assert(!spatialMlBatchSchema.safeParse({ packageId: id, expectedRevision: 1, requestKey: id, items: [{ ...source, region: { x: .9, y: 0, width: .2, height: 1 } }] }).success);
});
