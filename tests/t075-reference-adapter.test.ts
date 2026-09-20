import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { coreRefKey, measureCoreCatalog } from "../packages/contracts/src/index";
import { adaptReferenceScene, projectReferenceScene, toReferenceRenderScene } from "../apps/web/features/spatial/reference-import/index";
import { compileSpatialSnapshot } from "../apps/web/features/spatial/compiler/compile";

const anchor = { longitude: 77.1, latitude: 28.6, ellipsoidHeight: 120, provenance: "Explicit synthetic fixture placement; not surveyed" };
const rectangle = (x: number, y: number, w: number, h: number) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
function fixture() {
  const transform = ([x,y]: number[]) => [x * Math.cos(.37) - y * Math.sin(.37) + 17, x * Math.sin(.37) + y * Math.cos(.37) - 31];
  const items = [
    { id: "renamed-building", kind: "building", base: 100, height: 12, type: "Polygon", coordinates: [[[0,0],[8,0],[8,4],[4,4],[4,9],[0,9],[0,0]].map(transform)] },
    { id: "two-wing-campus", kind: "building", base: 2, height: 8, type: "MultiPolygon", coordinates: [[rectangle(45,0,8,9)], [rectangle(57,0,6,8)]] },
    { id: "courtyard-block", kind: "building", base: -6, height: 3, type: "Polygon", coordinates: [rectangle(0,30,18,18), rectangle(4,34,5,5)] },
    { id: "bent-road", kind: "road", base: 0, height: 0, type: "Polygon", coordinates: [[[0,-8],[30,-8],[30,20],[27,20],[27,-5],[0,-5],[0,-8]].map(transform)] },
    { id: "unknown-roof", kind: "building", base: 100, height: null, type: "Polygon", coordinates: [rectangle(-20,0,7,9)] },
  ];
  return {
    schemaVersion: "1.0.0", metadata: { id: "INDEPENDENT-ROTATED-AREA", title: "Independent arrangements", classification: "synthetic" },
    frames: [{ id: "independent-frame", name: "Named fixture frame", kind: "local_cartesian", horizontalUnit: "metre", verticalUnit: "metre", axisOrder: ["east","north","up"], verticalDatum: "Authored local benchmark" }],
    objects: [...items.map(i => ({ id: i.id, type: i.kind, label: i.id, geometryId: `geometry/${i.id}`, sourceRecordIds: [], attributes: { floorCount: 2 } })),
      { id: "schedule-only", type: "space", label: "Missing measured geometry", geometryId: null, sourceRecordIds: [], attributes: {} }],
    geometries: items.map(i => ({ id: `geometry/${i.id}`, objectId: i.id, version: 7, frameId: "independent-frame", type: i.type, coordinates: i.coordinates,
      baseElevationM: i.base, heightM: i.height, verticalDatum: "Authored local benchmark", sourceRecordIds: [] })),
    relations: [], sources: [], sourceRecords: [],
  };
}
const receipt = () => JSON.stringify(fixture(), null, 2) + "\n";

test("v2 candidate keeps exact receipt bytes, source IDs, revisions and independent shapes", async () => {
  const text = receipt(), result = await adaptReferenceScene(text);
  assert.equal(result.originalText, text);
  assert.equal(result.originalSha256, createHash("sha256").update(text).digest("hex"));
  assert.equal(result.input.schemaVersion, "ulpin-spatial/2");
  assert.equal(result.snapshot.manifest.state, "candidate");
  assert.equal(result.input.identity.entities.length, 6);
  const multi = result.snapshot.geometry.representations.find(r => r.entity.id === "two-wing-campus")!;
  assert.equal(multi.ref.id, "geometry/two-wing-campus"); assert.equal(multi.revision, 7);
  assert.equal(multi.geometry.profile, "prism");
  if (multi.geometry.profile === "prism") assert.deepEqual(multi.geometry.footprint.coordinates, fixture().geometries[1].coordinates);
  assert.ok(result.diagnostics.some(d => d.code === "MISSING_GEOMETRY" && d.objectId === "schedule-only"));
  assert.equal(result.input.geometry.representations.some(r => r.entity.id === "schedule-only"), false);
});

test("independent multipart, courtyard and rotated polygons compile through existing tile compiler", async () => {
  const result = await adaptReferenceScene(receipt()), display = projectReferenceScene(result, { anchor });
  const publication = compileSpatialSnapshot(display.snapshot, "/synthetic-tests");
  assert.equal(publication.summary.renderedEntities, 5);
  assert.ok(publication.summary.bytes > 1000);
  const building = display.snapshot.representations.find(r => r.entityId === coreRefKey({namespace:"physical",id:"renamed-building"}))!;
  assert.deepEqual(building.vertical && [building.vertical.lower,building.vertical.upper], [100,112]);
  assert.deepEqual(building.geometry.coordinates, fixture().geometries[0].coordinates);
  const bounds = (publication.manifest.root as { boundingVolume: {box:number[]} }).boundingVolume.box;
  assert.ok(bounds[2]+bounds[11] >= 112, "complete XYZ bounds include nonzero base");
});

test("courtyard measurement excludes hole, multipart measurement sums parts and unknown height has no volume", async () => {
  const r = await adaptReferenceScene(receipt());
  const measures = measureCoreCatalog(r.snapshot.geometry, r.input.identity, r.input.sources, r.input.frames);
  assert.equal(measures.find(m => m.entity.id === "courtyard-block")!.horizontalArea.value, 18*18-25);
  assert.equal(measures.find(m => m.entity.id === "two-wing-campus")!.horizontalArea.value, 8*9+6*8);
  assert.equal(measures.find(m => m.entity.id === "unknown-roof")!.prismVolume.value, null);
  const projected = projectReferenceScene(r).snapshot.representations.find(m => m.entityId.endsWith("unknown-roof"))!;
  assert.equal(projected.role, "ground_footprint");
  assert.equal(projected.vertical!.upper, projected.vertical!.lower);
});

test("pure Three compatibility DTO takes coordinates and vertical intervals from canonical catalog", async () => {
  const r = await adaptReferenceScene(receipt()), view = toReferenceRenderScene(r);
  assert.equal(view.scene.projectionVersion, "ulpin-reference-render/1");
  assert.equal(view.scene.canonicalSnapshotDigest, r.snapshot.manifest.inputDigest);
  const g = view.scene.geometries.find(g => g.objectId === "renamed-building")!;
  assert.equal(g.baseElevationM, 100); assert.equal(g.heightM, 12);
  assert.deepEqual(g.coordinates, fixture().geometries[0].coordinates);
  assert.equal(view.scene.objects.find(o => o.id === "schedule-only")!.geometryId, null);
  const unknown = view.scene.geometries.find(g => g.objectId === "unknown-roof")!;
  assert.equal(unknown.baseElevationM, 100); assert.equal(unknown.heightM, null);
  assert.ok(view.diagnostics.some(d => d.code === "DISPLAY_BASE_ONLY"));
});

test("schema version and non-synthetic classification cannot be relabelled as supported", async () => {
  const f = fixture(); f.schemaVersion = "1.0.1";
  await assert.rejects(adaptReferenceScene(JSON.stringify(f)));
  f.schemaVersion = "1.0.0"; f.metadata.classification = "observed";
  await assert.rejects(adaptReferenceScene(JSON.stringify(f)));
});

test("invalid hole topology is rejected by shared canonical validator", async () => {
  const f = fixture(); f.geometries[2].coordinates = [rectangle(0,30,18,18),rectangle(17,34,5,5)];
  await assert.rejects(adaptReferenceScene(JSON.stringify(f)), /hole|topolog|intersect|outside/i);
});

test("duplicate identities and foreign active geometry are rejected", async () => {
  const f = fixture(); f.objects.push({...f.objects[0]});
  await assert.rejects(adaptReferenceScene(JSON.stringify(f)), /Duplicate object/);
  const other = fixture(); other.objects[0].geometryId = other.objects[1].geometryId;
  await assert.rejects(adaptReferenceScene(JSON.stringify(other)), /foreign active geometry/);
});

test("historical geometry revisions remain in the input but only active representation compiles", async () => {
  const f = fixture(); f.geometries.push({...f.geometries[0],id:"geometry/previous-building",version:6,heightM:9});
  const r = await adaptReferenceScene(JSON.stringify(f));
  assert.equal(r.input.geometry.representations.length, 6);
  assert.equal(r.input.observations.length, 6);
  assert.equal(r.snapshot.geometry.representations.length, 5);
  assert.equal(r.snapshot.geometry.representations.some(g => g.ref.id === "geometry/previous-building"), false);
});

test("unrelated frames require explicit render selection, never assumed co-location", async () => {
  const f = fixture(); f.frames.push({...f.frames[0],id:"offset-frame",name:"Different local zero"}); f.geometries[0].frameId = "offset-frame";
  const r = await adaptReferenceScene(JSON.stringify(f));
  assert.throws(() => projectReferenceScene(r), /Choose one named frame/);
  assert.throws(() => toReferenceRenderScene(r), /Choose one named frame/);
  const view = projectReferenceScene(r, { frameId:"independent-frame" });
  assert.ok(view.diagnostics.some(d => d.code === "OTHER_RENDER_FRAME"));
  assert.equal(view.snapshot.representations.length, 4);
});

test("world compilation requires an explicit anchor and rejects vertical benchmark mismatch", async () => {
  const r = await adaptReferenceScene(receipt());
  assert.throws(() => compileSpatialSnapshot(projectReferenceScene(r).snapshot,"/test"), /anchor|placement/i);
  const f=fixture(); f.geometries[0].verticalDatum="Different benchmark";
  await assert.rejects(adaptReferenceScene(JSON.stringify(f)), /benchmark mismatch/);
});

test("native XYZ alignment remains unavailable analytically, without flattening coordinates", async () => {
  const f: any=fixture(); const coords=[[1,2,-6],[5,3,-4]];
  f.objects[0].type="utility"; f.geometries[0].type="LineString"; f.geometries[0].coordinates=coords;
  const r=await adaptReferenceScene(JSON.stringify(f)), rep=r.input.geometry.representations[0];
  assert.equal(rep.geometry.profile,"unavailable");
  assert.ok(r.diagnostics.some(d=>d.code==="UNSUPPORTED_3D_ALIGNMENT"));
  assert.deepEqual(r.source.geometries[0].coordinates,coords);
  assert.equal(toReferenceRenderScene(r).scene.objects[0].geometryId,null);
});

test("dense reference scene compiles through canonical adapter while raw sources remain metadata-only", async () => {
  const text=readFileSync("design/reference-map-v5/data/reference-scene.json","utf8"), r=await adaptReferenceScene(text);
  const display=projectReferenceScene(r,{anchor}), result=compileSpatialSnapshot(display.snapshot,"/test");
  assert.equal(r.input.identity.entities.length,196);
  assert.equal(result.summary.renderedEntities,172);
  assert.equal(r.diagnostics.filter(d=>d.code==="UNSUPPORTED_3D_ALIGNMENT").length,2);
  assert.ok(r.input.sources.assets.every(a=>a.integrity==="metadata_only"&&a.storage.state==="unavailable"));
  assert.ok(r.bindings.every(b=>b.sourceRevision==="fictional-dense-v2"));
  assert.equal(r.input.identity.relations.find(r=>r.id==="REL-001")!.kind,"associated_parcel");
});

test("stale source records reject; revision token changes receive different immutable source bindings", async () => {
  const f=JSON.parse(readFileSync("design/reference-map-v5/data/reference-scene.json","utf8"));
  const r=await adaptReferenceScene(JSON.stringify(f));
  f.sources[0].revision="new-source-token";
  await assert.rejects(adaptReferenceScene(JSON.stringify(f)), /stale source revision/);
  f.sourceRecords.filter((s:any)=>s.sourceId===f.sources[0].id).forEach((s:any)=>s.sourceRevision="new-source-token");
  const changed=await adaptReferenceScene(JSON.stringify(f));
  assert.notEqual(changed.bindings[0].canonicalSource.ref.id,r.bindings[0].canonicalSource.ref.id);
  assert.equal(changed.bindings[0].sourceId,r.bindings[0].sourceId);
});


test("unqualified presentation cannot inject camera values or fabricated map extents", async () => {
  const f:any=fixture(); f.metadata.extent=[-1e30,-1e30,1e30,1e30];
  f.sceneDecoration={camera:{position:[1e30,1e30,1e30]},trees:[{position:[1e30,1e30]}]};
  const r=await adaptReferenceScene(JSON.stringify(f)), view=toReferenceRenderScene(r);
  assert.equal("sceneDecoration" in view.scene,false);
  assert.ok(view.scene.metadata.extent!.every((v:number)=>Math.abs(v)<1000));
  assert.deepEqual((r.source as any).sceneDecoration,f.sceneDecoration);
});
