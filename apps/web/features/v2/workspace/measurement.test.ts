import assert from "node:assert/strict";
import test from "node:test";
import {
  angle,
  currentCalibration,
  makeCalibration,
  makeMeasurement,
  metricPoints,
  polygonArea,
} from "./measurement";
import type { CanvasSource } from "./types";
const source: CanvasSource = {
  id: "synthetic-plan",
  hash: "synthetic-original-hash",
  name: "Synthetic math fixture",
  kind: "image",
  parts: [],
};
test("pixel scale produces metric length, area and closed perimeter without changing original points", () => {
  const calibration = makeCalibration(
    source,
    1,
    [
      [0, 0],
      [100, 0],
    ],
    { metres: 5, reason: "Authored software fixture dimension 5 m" },
  );
  const points: [number, number][] = [
    [0, 0],
    [100, 0],
    [100, 60],
    [0, 60],
  ];
  assert.equal(
    makeMeasurement(source, 1, "distance", points.slice(0, 2), calibration)
      .value,
    5,
  );
  assert.equal(
    makeMeasurement(source, 1, "area", points, calibration).value,
    15,
  );
  assert.equal(
    makeMeasurement(source, 1, "perimeter", points, calibration).value,
    16,
  );
  assert.deepEqual(points, [
    [0, 0],
    [100, 0],
    [100, 60],
    [0, 60],
  ]);
});
test("two actual controls rotate, scale and translate pixel geometry into a named metre frame", () => {
  const calibration = makeCalibration(
    source,
    2,
    [
      [10, 20],
      [110, 20],
    ],
    {
      world: [
        [30, 40],
        [30, 45],
      ],
      frame: "SYNTHETIC-METRE-FRAME",
      reason: "Two authored synthetic controls",
    },
  );
  const points = metricPoints(
    source,
    [
      [10, 20],
      [110, 20],
      [10, 120],
    ],
    calibration,
  );
  assert.deepEqual(points, [
    [30, 40],
    [30, 45],
    [35, 40],
  ]);
  assert.equal(calibration.frame, "SYNTHETIC-METRE-FRAME");
});
test("calibration validity is bound to original bytes and page", () => {
  const calibration = makeCalibration(
    source,
    1,
    [
      [0, 0],
      [100, 0],
    ],
    { metres: 5, reason: "Synthetic dimension" },
  );
  assert.equal(currentCalibration(source, 1, calibration), calibration);
  assert.equal(currentCalibration(source, 2, calibration), undefined);
  assert.equal(
    currentCalibration({ ...source, hash: "changed-original" }, 1, calibration),
    undefined,
  );
  assert.throws(
    () =>
      makeMeasurement(source, 1, "distance", [
        [0, 0],
        [5, 0],
      ]),
    /Calibrate/,
  );
  assert.throws(
    () =>
      makeCalibration(
        source,
        1,
        [
          [0, 0],
          [0, 0],
        ],
        { metres: 5, reason: "Synthetic" },
      ),
    /different/,
  );
});
test("invalid crossing boundaries are rejected and angle corner is the middle point", () => {
  assert.throws(
    () =>
      polygonArea([
        [0, 0],
        [4, 3],
        [0, 4],
        [4, 0],
      ]),
    /cross/,
  );
  assert.throws(
    () =>
      polygonArea([
        [0, 0],
        [1, 0],
        [1, 0],
      ]),
    /distinct/,
  );
  assert.equal(
    angle([
      [0, 1],
      [0, 0],
      [1, 0],
    ]),
    90,
  );
  assert.throws(
    () =>
      angle([
        [0, 0],
        [0, 0],
        [1, 1],
      ]),
    /distinct/,
  );
});
test("native geometry retains declared metric coordinates while display Y is inverted", () => {
  const geometry: CanvasSource = {
    ...source,
    kind: "geometry",
    frame: "SYNTHETIC-METRES",
  };
  assert.deepEqual(
    metricPoints(geometry, [
      [10, -20],
      [15, -20],
    ]),
    [
      [10, 20],
      [15, 20],
    ],
  );
  assert.equal(
    makeMeasurement(geometry, 1, "distance", [
      [10, -20],
      [15, -20],
    ]).value,
    5,
  );
});
