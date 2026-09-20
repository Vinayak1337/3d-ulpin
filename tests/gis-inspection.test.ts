import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  inspectGisUpload,
  validateUnmappedGisIdentity,
} from "../apps/web/lib/server/gis-inspection";
const bytes = new Uint8Array([0, 255, 80, 75, 128, 7]);
const digest = createHash("sha256").update(bytes).digest("hex");
const metadata = {
  format: "gpkg" as const,
  bytes: bytes.length,
  sourceSha256: digest,
  layers: ["parcels"],
  layer: "parcels",
  sourceCrs: "EPSG:32643",
  crsEvidence: "GeoPackage spatial reference",
  featureCount: 2,
  geometryTypes: ["Polygon"],
  fields: [{ name: "id", complete: true, unique: true, idEligible: true }],
  featureIdEligible: false,
  suggestedIdField: "id",
  suggestedNameField: null,
};
function request(file?: File, layer?: string) {
  const form = new FormData();
  if (file) form.set("file", file);
  if (layer) form.set("layer", layer);
  return new Request("http://localhost/api/v1/import-packages/inspect", {
    method: "POST",
    body: form,
  });
}
test("multipart inspection preserves arbitrary original bytes, declared CRS and selected layer", async () => {
  const result = await inspectGisUpload(
    request(new File([bytes], "Lake_View-parcels.gpkg"), "parcels"),
    async (input) => {
      assert.deepEqual(Buffer.from(input.base64, "base64"), Buffer.from(bytes));
      assert.equal(input.layer, "parcels");
      return metadata;
    },
  );
  assert.equal(result.sourceCrs, "EPSG:32643");
  assert.equal(result.suggestedTitle, "Lake View parcels");
  assert.equal(
    result.suggestedNamespace,
    `file:${createHash("sha256").update(`${digest}\0parcels`).digest("hex")}`,
  );
});
test("same original bytes retain generated namespace through retries and renamed selections", async () => {
  const first = await inspectGisUpload(
    request(new File([bytes], "one.gpkg")),
    async () => metadata,
  );
  const retry = await inspectGisUpload(
    request(new File([bytes], "renamed.gpkg")),
    async () => metadata,
  );
  assert.equal(first.suggestedNamespace, retry.suggestedNamespace);
});
for (const [name, file, status] of [
  ["missing", undefined, 400],
  ["empty", new File([], "empty.gpkg"), 413],
  [
    "oversized",
    new File([new Uint8Array(16 * 1024 * 1024 + 1)], "large.gpkg"),
    413,
  ],
] as const) {
  test(`${name} file rejected before private parsing`, async () => {
    let called = false;
    await assert.rejects(
      inspectGisUpload(request(file), async () => {
        called = true;
        return metadata;
      }),
      (error: any) => error.status === status,
    );
    assert.equal(called, false);
  });
}
test("declared oversized HTTP body is rejected before multipart allocation", async () => {
  const req = new Request("http://localhost/inspect", {
    method: "POST",
    headers: { "content-length": String(18 * 1024 * 1024) },
    body: "invalid multipart",
  });
  await assert.rejects(
    inspectGisUpload(req, async () => metadata),
    (error: any) => error.status === 413,
  );
});
test("processor errors remain actionable and never become successful metadata", async () => {
  await assert.rejects(
    inspectGisUpload(request(new File([bytes], "bad.gpkg")), async () => {
      throw new Error("Conflicting CRS");
    }),
    /Conflicting CRS/,
  );
});

test("layers with reused source IDs have distinct stable dataset namespaces", async () => {
  const parcels = await inspectGisUpload(
    request(new File([bytes], "survey.gpkg"), "parcels"),
    async () => metadata,
  );
  const buildings = await inspectGisUpload(
    request(new File([bytes], "survey.gpkg"), "buildings"),
    async () => ({ ...metadata, layer: "buildings" }),
  );
  assert.notEqual(parcels.suggestedNamespace, buildings.suggestedNamespace);
  const repeated = await inspectGisUpload(
    request(new File([bytes], "survey.gpkg"), "parcels"),
    async () => metadata,
  );
  assert.equal(parcels.suggestedNamespace, repeated.suggestedNamespace);
});

test("undeclared oversized body is stopped before multipart parsing or inspection", async () => {
  let count = 0;
  const req = new Request("http://localhost/inspect", {
    method: "POST",
    body: new ReadableStream({
      pull(controller) {
        if (count++ < 18) controller.enqueue(new Uint8Array(1024 * 1024));
        else controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit);
  assert.equal(req.headers.has("content-length"), false);
  let called = false;
  await assert.rejects(
    inspectGisUpload(req, async () => {
      called = true;
      return metadata;
    }),
    (error: any) => error.status === 413,
  );
  assert.equal(called, false);
});
test("malformed multipart returns an actionable public input error", async () => {
  const req = new Request("http://localhost/inspect", {
    method: "POST",
    body: "malformed",
  });
  await assert.rejects(
    inspectGisUpload(req, async () => metadata),
    (error: any) => error.status === 400 && error.code === "INVALID_FORM",
  );
});

test("missing ID mapping requires validated retained Feature IDs and never row fallback", async () => {
  await validateUnmappedGisIdentity("geojson", bytes, async () => ({
    featureIdEligible: true,
  }));
  await assert.rejects(
    validateUnmappedGisIdentity("geojson", bytes, async () => ({
      featureIdEligible: false,
    })),
    (error: any) => error.code === "SOURCE_ID_REQUIRED",
  );
  let called = false;
  await assert.rejects(
    validateUnmappedGisIdentity("gpkg", bytes, async () => {
      called = true;
      return { featureIdEligible: true };
    }),
    (error: any) => error.code === "SOURCE_ID_REQUIRED",
  );
  assert.equal(called, false);
});
