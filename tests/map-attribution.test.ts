import test from "node:test";
import assert from "node:assert/strict";
import { hasGoogleAttribution, hasOsmAttribution } from "../apps/web/lib/map-attribution";
test("OSM source and synthetic derivatives retain visible attribution", () => {
  assert.equal(hasOsmAttribution([{ properties: { attribution: "© OpenStreetMap contributors", provenance: "Synthetic copy" } }]), true);
});
test("Unrelated or absent sources are not falsely credited to OSM", () => {
  assert.equal(hasOsmAttribution([{ properties: {} }]), false);
  assert.equal(hasOsmAttribution([]), false);
});
test("Google outlines and their synthetic copies retain Google and OSM selection credits", () => {
  const data = [{ properties: { attribution: "Google Research Open Buildings V3; OpenStreetMap contributors (boundary/roads)" } }];
  assert.equal(hasGoogleAttribution(data), true);
  assert.equal(hasOsmAttribution(data), true);
  assert.equal(hasGoogleAttribution([{ properties: { attribution: "OpenStreetMap contributors" } }]), false);
  assert.equal(hasGoogleAttribution([{ properties: {} }]), false);
});
