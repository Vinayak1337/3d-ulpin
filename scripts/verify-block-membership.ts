/** Allocated synthetic integration test; never edits presentation properties. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { areaContext, commitPackage, currentAreaCheckFingerprint, getArea, ingestArea, reviewPackage, runAreaCheck } from "../apps/web/lib/server/areas";
import { createBlockGroup } from "../apps/web/lib/server/officer";
import { pool, query, transaction } from "../apps/web/lib/server/db";
import { removeOrphan } from "../apps/web/lib/server/storage";

const run = randomUUID(), areas: string[] = [];
const baseX = 530000, baseY = 3130000;
const ring = (x: number, y: number, size = 10) => [[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]];
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const utilityRaw = (offset: number, level: number) => ({ spatialReference: { wkid: 32643 }, features: [{ attributes: { id: "U", start: level, end: level, width: 1, height: 1 }, geometry: { paths: [[[baseX+offset,baseY+5],[baseX+offset+10,baseY+5]]] } }] });
const utilityMapping = { idField: "id", kind: "utility" as const, geometryRole: "physical_utility" as const, utility: { startLevelField: "start", endLevelField: "end", levelUnit: "m", levelMeaning: "centre", verticalReference: "SYNTHETIC-BM-MEMBERSHIP", interpolation: "linear_endpoints", crossSection: "rectangular", widthField: "width", heightField: "height", dimensionUnit: "m" } };
async function record(pkg: Awaited<ReturnType<typeof ingestArea>>) {
  if (!areas.includes(pkg.areaId)) areas.push(pkg.areaId);
  pkg = await reviewPackage(pkg.id, pkg.revision);
  return commitPackage(pkg.id, pkg.revision, "Authored synthetic membership regression only; no real utility, parcel, title or survey claim.");
}
async function utility(offset: number, level: number, areaId?: string) {
  return record(await ingestArea({ bytes: encode(utilityRaw(offset,level)), filename: "synthetic-utility.json", format: "arcgis", namespace: `membership:${run}:utility:${offset}`, name: `Synthetic membership utility ${run} ${offset}`, worldStatus: "synthetic", mapping: utilityMapping, areaId, expectedAreaRevision: areaId ? (await getArea(areaId)).revision : undefined }));
}
try {
  const owner = await utility(1000,-2);
  const target = await record(await ingestArea({ bytes: encode({ spatialReference:{wkid:32643}, features:[{attributes:{id:"B",height:9},geometry:{rings:[ring(baseX,baseY)]}}] }), filename:"synthetic-building.json",format:"arcgis",namespace:`membership:${run}:building`,name:`Synthetic membership target ${run}`,worldStatus:"synthetic",mapping:{idField:"id",kind:"building",heightField:"height",heightUnit:"m",geometryRole:"observed_ground_occupation"} }));
  const unrelated = await utility(0,-4);
  const shared = owner.features[0], building = target.features[0];
  const originalBody = (await query("SELECT body FROM physical_features WHERE id=$1", [shared.id])).rows[0].body;
  assert.deepEqual((await areaContext(target.areaId)).features.map(f=>f.id), [building.id], "An overlapping unrelated test area is not ordinary block membership.");
  const area = await getArea(target.areaId);
  assert(area.reference);
  const boundary = { type:"Polygon" as const, coordinates:[ring(-20,-20,1100)] };
  const groupInput = {areaId:target.areaId,name:`Synthetic member group ${run}`,kind:"analysis_extent" as const,boundary,evidence:[...shared.evidence,...building.evidence],featureIds:[building.id,shared.id],expectedRevision:area.revision};
  await createBlockGroup(groupInput);
  await createBlockGroup({...groupInput,name:`Synthetic second group ${run}`});
  await createBlockGroup({areaId:owner.areaId,name:`Synthetic owning group ${run}`,kind:"analysis_extent",boundary:{type:"Polygon",coordinates:[ring(-20,-20,50)]},evidence:shared.evidence,featureIds:[shared.id],expectedRevision:(await getArea(owner.areaId)).revision});
  const context = await areaContext(target.areaId);
  assert.deepEqual(context.features.map(f=>f.id).sort(), [building.id,shared.id].sort());
  assert(!context.features.some(f=>f.id===unrelated.features[0].id));
  const placed = context.features.find(f=>f.id===shared.id)!;
  assert.equal(placed.areaId, owner.areaId);
  assert.deepEqual(placed.geographicGeometry, shared.geographicGeometry);
  assert.deepEqual(placed.sourceGeometry, shared.sourceGeometry);
  assert.deepEqual(placed.evidence, shared.evidence);
  const positions = (placed.geometry as {type:"LineString";coordinates:number[][]}).coordinates;
  assert(Math.abs(positions[0][0]-(baseX+1000-area.reference.origin[0]))<0.0001);
  assert(Math.abs(positions[0][1]-(baseY+5-area.reference.origin[1]))<0.0001);
  const placedProfile = placed.utilityProfile!.resolved as {positions:number[][]};
  assert.deepEqual(placedProfile.positions.map(p=>p.slice(0,2)),positions);
  assert(placedProfile.positions.every(p=>p[2]===-2));
  assert.deepEqual((await query("SELECT body FROM physical_features WHERE id=$1",[shared.id])).rows[0].body,originalBody,"Read-time placement never changes the owner/source record.");
  assert.equal((await query("SELECT count(*)::int count FROM physical_features WHERE id=$1",[shared.id])).rows[0].count,1);
  const check = await runAreaCheck(target.areaId,area.revision);
  assert.equal(check.status,"completed");
  assert.equal(check.stale,false,"Check completion uses the same member set/frame without duplicate IDs.");
  assert.equal((await areaContext(target.areaId)).latestCheck!.stale,false);
  assert.equal(await currentAreaCheckFingerprint(target.areaId),check.inputFingerprint);
  const changed = await utility(1000,-3,owner.areaId);
  assert.equal(changed.features[0].id,shared.id);
  assert.notEqual(await currentAreaCheckFingerprint(target.areaId),check.inputFingerprint);
  const refreshed = await areaContext(target.areaId);
  assert.equal(refreshed.latestCheck!.stale,true,"Changed source/profile in the owning block invalidates the other block's check.");
  assert((refreshed.features.find(f=>f.id===shared.id)!.utilityProfile!.resolved as {positions:number[][]}).positions.every(p=>p[2]===-3));
  console.log("PASS Explicit multi-block membership keeps one identity, excludes unrelated overlap, projects utility alignment/profile consistently, and invalidates checks on owning-source changes.");
  await query(`INSERT INTO physical_features(id,area_id,identifier,revision,body,geometry,geographic_geometry)
    SELECT x.id,$1,'membership-cap-'||$2||'-'||x.n,1,p.body||jsonb_build_object('id',x.id,'identifier','membership-cap-'||$2||'-'||x.n),p.geometry,p.geographic_geometry
    FROM physical_features p CROSS JOIN (SELECT gen_random_uuid() id,n FROM generate_series(1,1999) n) x WHERE p.id=$3`,[target.areaId,run,building.id]);
  await assert.rejects(areaContext(target.areaId), /exceed 2,000 features/);
  console.log("PASS 2,001 owned/member features fail with an explicit area limit.");
} finally {
  const keys = areas.length ? (await query("SELECT s.object_key FROM sources s JOIN cases c ON c.id=s.case_id WHERE c.site_id=ANY($1::uuid[])",[areas])).rows.map(r=>r.object_key) : [];
  if (areas.length) await transaction(async client=>{
    for (const statement of [
      "DELETE FROM block_group_memberships WHERE group_id IN (SELECT id FROM block_groups WHERE area_id=ANY($1::uuid[]))",
      "DELETE FROM block_group_revisions WHERE group_id IN (SELECT id FROM block_groups WHERE area_id=ANY($1::uuid[]))",
      "DELETE FROM block_groups WHERE area_id=ANY($1::uuid[])",
      "DELETE FROM area_check_runs WHERE area_id=ANY($1::uuid[])",
      "DELETE FROM external_identifiers WHERE feature_id IN (SELECT id FROM physical_features WHERE area_id=ANY($1::uuid[])) OR record_id IN (SELECT id FROM registry_records WHERE site_id=ANY($1::uuid[]))",
      "DELETE FROM physical_feature_revisions WHERE feature_id IN (SELECT id FROM physical_features WHERE area_id=ANY($1::uuid[]))",
      "DELETE FROM source_feature_links WHERE area_id=ANY($1::uuid[])",
      "DELETE FROM physical_features WHERE area_id=ANY($1::uuid[])",
      "DELETE FROM import_package_revisions WHERE package_id IN (SELECT id FROM import_packages WHERE area_id=ANY($1::uuid[]))",
      "DELETE FROM import_packages WHERE area_id=ANY($1::uuid[])",
      "DELETE FROM registry_records WHERE site_id=ANY($1::uuid[])",
      "DELETE FROM sources WHERE case_id IN (SELECT id FROM cases WHERE site_id=ANY($1::uuid[]))",
      "DELETE FROM cases WHERE site_id=ANY($1::uuid[])",
      "DELETE FROM area_memberships WHERE area_id=ANY($1::uuid[])",
      "DELETE FROM map_areas WHERE id=ANY($1::uuid[])",
      "DELETE FROM registry_sites WHERE id=ANY($1::uuid[])",
    ]) await client.query(statement,[areas]);
  });
  for (const key of keys) await removeOrphan(key);
  await pool().end();
}
