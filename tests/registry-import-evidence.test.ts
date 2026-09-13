import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ComputedUnit,
  ContextFeature,
  SourceRevision,
} from "../packages/contracts/src";
import {
  assertRegistrySourceFrame,
  contextImportEvidence,
  unitImportEvidence,
} from "../apps/web/lib/server/registry-import-evidence";

const context: ContextFeature = {
  alias: "A",
  kind: "building",
  footprint: [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
  ],
};
const source = (id: string) =>
  ({
    id,
    status: "ready",
    inspection: { features: [context] },
  }) as SourceRevision;
const unit = (bindings: ComputedUnit["bindings"]) =>
  ({ alias: "101", bindings }) as ComputedUnit;
test("import preserves the source actually bound by the built unit instead of first upload", () => {
  const bound = { sourceId: "revision-2", locator: "feature 101" };
  assert.deepEqual(unitImportEvidence(unit({ footprint: bound })), [bound]);
  assert.equal(
    contextImportEvidence(
      context,
      [source("revision-1"), source("revision-2")],
      [unit({ footprint: bound })],
    ).sourceId,
    "revision-2",
  );
});
test("explicit context evidence wins and old ambiguous provenance fails clearly", () => {
  const evidence = { sourceId: "revision-2", locator: "feature A" };
  assert.deepEqual(
    contextImportEvidence({ ...context, evidence }, [], []),
    evidence,
  );
  assert.throws(
    () => contextImportEvidence(context, [source("r1"), source("r2")], []),
    /ambiguous/,
  );
});
test("a calibrated plan unit imports without any JSON source", () => {
  const u = {
    ...unit({}),
    calibration: {
      sourceId: "plan-pdf",
      page: 2,
      imagePoints: [
        [0, 0],
        [1, 0],
      ],
      worldPoints: [
        [0, 0],
        [2, 0],
      ],
    },
  } as ComputedUnit;
  assert.deepEqual(unitImportEvidence(u), [
    { sourceId: "plan-pdf", locator: "page 2, calibrated plan" },
  ]);
  assert.throws(() => unitImportEvidence(unit({})), /no bound source/);
});

test("registry evidence rejects a different declared frame or benchmark", () => {
  const frame = { id: "local", benchmark: "zero", horizontalUnit: "m", verticalUnit: "m" } as import("../packages/contracts/src").CoordinateFrame;
  const matching = { ...source("r1"), inspection: { frame } } as SourceRevision;
  assert.doesNotThrow(() => assertRegistrySourceFrame(frame, matching));
  assert.doesNotThrow(() => assertRegistrySourceFrame(frame, source("pdf")));
  for (const changed of [{ id: "other" }, { benchmark: "other" }]) {
    assert.throws(() => assertRegistrySourceFrame(frame, { ...matching, inspection: { frame: { ...frame, ...changed } } } as SourceRevision), /different frame or benchmark/);
  }
});
