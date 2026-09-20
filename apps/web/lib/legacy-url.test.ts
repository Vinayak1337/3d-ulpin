import assert from "node:assert/strict";
import { test } from "node:test";
import { legacyUrl, rootPresentationUrl } from "./legacy-url";
import { redirectLegacyFamily } from "./legacy-redirect-page";

test("historical links preserve identity and repeated context while reaching the replacement interface", async () => {
  for (const [oldPath, destination] of [
    ["/areas", "/studio/datasets"],
    ["/areas/block-1", "/studio/areas/block-1"],
    ["/properties/building-1/prepare", "/studio/properties/building-1/workspace"],
    ["/registry/3DU-A%3AB001", "/studio/registry/records/3DU-A%3AB001"],
    ["/workbench", "/studio/cases/c1/geometry"],
    ["/sites/site-1", "/studio/registry/sites/site-1"],
  ]) {
    const input = new URL(
      oldPath +
        "?case=c1&feature=b1&record=unit%3A1&tag=a&tag=b&name=A%20%26%20B",
      "http://localhost",
    );
    const [, family, ...segments] = input.pathname.split("/");
    const search = Object.fromEntries(
      [...new Set(input.searchParams.keys())].map((key) => [
        key,
        input.searchParams.getAll(key),
      ]),
    );
    await assert.rejects(
      redirectLegacyFamily(
        family as Parameters<typeof redirectLegacyFamily>[0],
        {
          params: Promise.resolve({ path: segments.map(decodeURIComponent) }),
          searchParams: Promise.resolve(search),
        },
      ),
      (error) => {
        const digest = (error as Error & { digest: string }).digest;
        const actual = new URL(digest.split(";")[2], input.origin);
        assert.equal(actual.pathname, destination);
        assert.deepEqual([...actual.searchParams], [...input.searchParams]);
        return digest.startsWith("NEXT_REDIRECT;");
      },
    );
  }
});
test("root opens the work queue and case bookmarks open their saved workspace", () => {
  assert.equal(rootPresentationUrl({}), "/studio/work");
  assert.equal(rootPresentationUrl({ case: "" }), "/studio/work?case=");
  const result = new URL(
    rootPresentationUrl({
      case: "c1",
      building: "b1",
      area: "a1",
      tag: ["first", "second"],
    }),
    "http://local",
  );
  assert.equal(result.pathname, "/studio/cases/c1");
  assert.deepEqual(result.searchParams.getAll("tag"), ["first", "second"]);
  assert.equal(result.searchParams.get("building"), "b1");
});
test("compatibility is idempotent and leaves source/API/external URLs unchanged", () => {
  for (const value of [
    "/legacy/areas/a?feature=b",
    "/v2/properties/b/workspace?area=a",
    "/registry/3DU-A%3AB001",
    "/workbench?case=c&building=b#reference",
  ])
    assert.equal(legacyUrl(legacyUrl(value)), legacyUrl(value));
  for (const value of [
    "/api/v1/sources/s/file#page=2",
    "https://example.com/areas/a",
    "//example.com/registry/a",
    "#reference",
    "/studio/areas/a?feature=b",
    "/areas-other",
  ])
    assert.equal(legacyUrl(value), value);
});
