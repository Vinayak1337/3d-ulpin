import test from "node:test";
import assert from "node:assert/strict";
import { permitsReferenceRightSource } from "../apps/web/lib/server/registry-reference-policy";
const native = { status: "inspected", profile: "text-reference-v2", inspection: { status: "reference_only", partCount: 4 } };
test("native document part can support a reviewed non-geometric right", () => {
  assert.equal(permitsReferenceRightSource(native, "right"), true);
});
test("a reference document cannot be used as geometric or level evidence", () => {
  assert.equal(permitsReferenceRightSource(native, "geometry"), false);
});
test("empty, uninspected, binary and unsupported references remain rejected", () => {
  for (const source of [{}, { ...native, status: "received" }, { ...native, profile: "png-reference-v2" }, { ...native, inspection: { status: "reference_only", partCount: 0 } }]) {
    assert.equal(permitsReferenceRightSource(source, "right"), false);
  }
});
