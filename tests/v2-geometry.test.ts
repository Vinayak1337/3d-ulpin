import assert from "node:assert/strict";
import { test } from "node:test";
import type { PhysicalFeature } from "../packages/contracts/src/index";
import { featureBounds } from "../apps/web/features/officer/block/geometry";

test("shared block bounds support 200,000 vertices without argument-count overflow", () => {
  // Each feature remains within the native 10,000-vertex limit. Several valid source blocks can share membership.
  const features = Array.from({ length: 20 }, (_, featureIndex) => ({
    geometry: {
      type: "LineString",
      coordinates: Array.from({ length: 10_000 }, (_, vertexIndex) => [
        featureIndex * 100 + (vertexIndex % 100),
        Math.floor(vertexIndex / 100),
      ]),
    },
  })) as PhysicalFeature[];
  const bounds = featureBounds(features);
  // Authored coordinate extremes are x=[0,1999], y=[0,99]; SVG flips y and adds 12% of the larger span.
  const expected = [-239.88, -338.88, 2478.76, 578.76];
  assert(bounds.every(Number.isFinite));
  bounds.forEach((value, index) => {
    assert(Math.abs(value - expected[index]) < 1e-9);
  });
  assert.deepEqual(
    features[19].geometry.type === "LineString"
      ? features[19].geometry.coordinates.at(-1)
      : null,
    [1999, 99],
    "Display bounds never mutate source coordinates.",
  );
});

test("empty, extent-only and degenerate selections retain usable display bounds", () => {
  assert.deepEqual(featureBounds([]), [0, 0, 100, 100]);
  assert.deepEqual(
    featureBounds([], [10, 20, 30, 50]),
    [6.4, -53.6, 27.2, 37.2],
  );
  assert.deepEqual(
    featureBounds([
      { geometry: { type: "Point", coordinates: [5, 10] } } as PhysicalFeature,
    ]),
    [3.8, -11.2, 12.4, 12.4],
  );
});
