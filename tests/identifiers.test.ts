import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  propertyIdentifier,
  childCode,
  identityLevel,
} from "../apps/web/lib/identifiers";

test("parent encoding retains UUID differences at both ends with fixed length", () => {
  const zero = "00000000-0000-0000-0000-000000000000";
  assert.equal(propertyIdentifier(zero), "3DU-00000000000000000000000000");
  assert.notEqual(
    propertyIdentifier(zero),
    propertyIdentifier("00000000-0000-0000-0000-000000000001"),
  );
  assert.notEqual(
    propertyIdentifier(zero),
    propertyIdentifier("80000000-0000-0000-0000-000000000000"),
  );
  assert.equal(
    propertyIdentifier("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF").length,
    30,
  );
  assert.throws(() => propertyIdentifier("123"));
});
test("independent properties and arbitrarily many suffixes do not enlarge the parent", () => {
  const ids = Array.from({ length: 10000 }, () =>
    propertyIdentifier(randomUUID()),
  );
  assert.equal(new Set(ids).size, 10000);
  assert.ok(ids.every((id) => id.length === 30));
  assert.equal(childCode("F", 1), "F001");
  assert.equal(childCode("S", 1000000), "S1000000");
  assert.notEqual(childCode("F", 1), childCode("S", 1));
  assert.throws(() => childCode("S", 0));
  assert.throws(() => childCode("S", 1.1));
});
test("level labels normalize whitespace without guessing elevations", () => {
  assert.equal(identityLevel("  "), "Unassigned");
  assert.equal(identityLevel(" Level 1 "), "Level 1");
  assert.notEqual(identityLevel("Level 1"), identityLevel("Level 2"));
});
