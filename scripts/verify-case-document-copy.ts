/** Synthetic, isolated integration of the actual route handler, database, storage and native parser. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ImportPackage } from "@ulpin/contracts";
import { ingestArea, reviewPackage, commitPackage, getPackage, attachDocument } from "../apps/web/lib/server/areas";
import { areaRoutes } from "../apps/web/lib/server/area-routes";
import { createCase } from "../apps/web/lib/server/domain";
import { openPreparation } from "../apps/web/lib/server/officer";
import { pool, query, transaction } from "../apps/web/lib/server/db";
import { putOriginal, readObject, removeOrphan, sha256 } from "../apps/web/lib/server/storage";
import { AppError } from "../apps/web/lib/server/errors";

const run = randomUUID(), areas: string[] = [], looseCases: string[] = [];
const sourceKeys: string[] = [];
async function source(caseId: string, name: string, profile: string, bytes: Uint8Array) {
  const id = randomUUID(), hash = sha256(bytes), key = `verification/case-document-copy/${run}/${id}/${hash}`;
  sourceKeys.push(key);
  await putOriginal(key, bytes, profile === "plan-png-v1" ? "image/png" : profile === "plan-pdf-v1" ? "application/pdf" : "text/csv");
  await query("INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,status) VALUES($1,$2,$1,1,$3,$4,$5,$6,$7,$8,'ready')", [id,caseId,name,profile,profile === "plan-png-v1" ? "image/png" : profile === "plan-pdf-v1" ? "application/pdf" : "text/csv",bytes.length,hash,key]);
  return {id,hash,key,bytes};
}
async function copy(packageId: string, input: {expectedRevision:number;caseId:string;sourceIds:string[];buildingId:string;reason:string}) {
  const response = await areaRoutes(new Request(`http://local/api/v1/import-packages/${packageId}/copy-case-documents`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)}), ["import-packages",packageId,"copy-case-documents"]);
  assert(response);
  assert.equal(response.status,200);
  return response.json() as Promise<ImportPackage>;
}
const rejected = (action: Promise<unknown>, code: string) => assert.rejects(action, error => error instanceof AppError && error.code === code);
try {
  let pkg = await ingestArea({bytes:Buffer.from(JSON.stringify({spatialReference:{wkid:32643},features:[0,30].map((x,index)=>({attributes:{id:`B${index+1}`,height:9},geometry:{rings:[[[500000+x,3100000],[500010+x,3100000],[500010+x,3100010],[500000+x,3100010],[500000+x,3100000]]]}}))})),filename:"synthetic-copy-properties.json",format:"arcgis",namespace:`synthetic-copy:${run}`,name:`Synthetic document assignment ${run}`,worldStatus:"synthetic",mapping:{idField:"id",kind:"building",heightField:"height",heightUnit:"m",geometryRole:"observed_ground_occupation"}});
  areas.push(pkg.areaId);
  pkg = await reviewPackage(pkg.id,pkg.revision);
  pkg = await commitPackage(pkg.id,pkg.revision,"Synthetic document-assignment regression; no real property evidence.");
  const [buildingA,buildingB] = pkg.features;
  const prepA = await openPreparation(buildingA.id,buildingA.revision), prepB = await openPreparation(buildingB.id,buildingB.revision);
  const original = await createCase(`Synthetic unassigned documents ${run}`);
  looseCases.push(original.id);
  const csv = await source(original.id,"synthetic-levels.csv","levels-csv-v1",Buffer.from("alias,lower,upper,unit,benchmark,method\nB1,-3,0,m,SYNTHETIC-BM,authored regression only\n"));
  const png = await source(original.id,"synthetic-plan.png","plan-png-v1",await readFile(new URL("../fixtures/c001/plan.png",import.meta.url)));
  const pdf = await source(original.id,"synthetic-plan.pdf","plan-pdf-v1",await readFile(new URL("../fixtures/c001/plan.pdf",import.meta.url)));
  const controls = await source(original.id,"synthetic-controls.csv","control-csv-v1",Buffer.from("id,x,y\nC1,0,0\n"));
  const badCsv = await source(original.id,"invalid-levels.csv","levels-csv-v1",Buffer.from("alias,lower,upper,unit,benchmark\nB1,NaN,0,m,SYNTHETIC-BM\n"));
  const owned = await source(prepB.caseId,"other-property.png","plan-png-v1",png.bytes);
  const corrupt = await source(original.id,"intentional-hash-mismatch.csv","levels-csv-v1",csv.bytes);
  await query("UPDATE sources SET sha256=$2 WHERE id=$1",[corrupt.id,"0".repeat(64)]);
  const initial = await getPackage(prepA.packageId);
  const input = {expectedRevision:initial.revision,caseId:original.id,sourceIds:[csv.id,png.id,pdf.id],buildingId:buildingA.id,reason:"Operator explicitly assigns these authored test documents to synthetic property A."};
  await rejected(copy(prepA.packageId,{...input,expectedRevision:initial.revision+1}),"STALE_REVISION");
  await rejected(copy(prepA.packageId,{...input,buildingId:buildingB.id}),"PREPARATION_BUILDING");
  await rejected(copy(prepA.packageId,{...input,sourceIds:[csv.id,owned.id]}),"SOURCE_OWNERSHIP");
  await rejected(copy(prepA.packageId,{...input,caseId:prepB.caseId,sourceIds:[owned.id]}),"CASE_ALREADY_ASSIGNED");
  await rejected(copy(prepA.packageId,{...input,sourceIds:[csv.id,controls.id]}),"COPY_PROFILE");
  await rejected(copy(prepA.packageId,{...input,sourceIds:[csv.id,corrupt.id]}),"COPY_SOURCE_INTEGRITY");
  await rejected(copy(prepA.packageId,{...input,sourceIds:[png.id,badCsv.id]}),"AREA_PROCESSING");
  assert.deepEqual(await getPackage(prepA.packageId),initial,"Every invalid batch leaves the whole package and prior history unchanged.");
  assert.equal((await query("SELECT count(*)::int count FROM sources WHERE case_id=$1",[prepA.caseId])).rows[0].count,0);
  console.log("PASS Destination, case/source ownership, unsupported profile, original hash and malformed native input gates are atomic.");
  const originalRows = (await query("SELECT * FROM sources WHERE case_id=$1 ORDER BY id",[original.id])).rows;
  const [assigned,retried] = await Promise.all([copy(prepA.packageId,input),copy(prepA.packageId,input)]);
  assert.deepEqual(assigned,retried,"Concurrent identical assignment retries resolve to the same package and source IDs.");
  assert.equal(assigned.revision,initial.revision+1);
  assert.equal(assigned.sourceRevisionIds.length,initial.sourceRevisionIds.length+3);
  assert.equal(assigned.factCandidates.length,2);
  assert(assigned.factCandidates.every(f=>f.entityId===buildingA.id && f.method==="native_parse" && f.worldStatus==="synthetic"));
  assert(assigned.parts.some(part=>part.text.includes("method: authored regression only")));
  assert(assigned.parts.every(part=>part.entityIds.length===1 && part.entityIds[0]===buildingA.id));
  for (const originalSource of [csv,png,pdf]) {
    const parts = assigned.parts.filter(part=>part.copiedFrom?.sourceRevisionId===originalSource.id);
    assert(parts.length);
    for (const part of parts) {
      assert.equal(part.copiedFrom!.sourceHash,originalSource.hash);
      assert.equal(part.copiedFrom!.caseId,original.id);
      assert.equal(part.copiedFrom!.sourceRevision,1);
      assert.equal(part.copiedFrom!.locator,part.locator);
      assert.equal(part.copiedFrom!.reason,input.reason);
      const row = (await query("SELECT * FROM sources WHERE id=$1",[part.sourceRevisionId])).rows[0];
      assert.equal(row.case_id,prepA.caseId);
      assert.equal(row.sha256,originalSource.hash);
      assert.equal(row.inspection.copiedFrom.sourceRevisionId,originalSource.id);
      assert.equal(sha256(await readObject(row.object_key)),originalSource.hash);
    }
    assert.equal(sha256(await readObject(originalSource.key)),originalSource.hash);
  }
  assert.deepEqual((await query("SELECT * FROM sources WHERE case_id=$1 ORDER BY id",[original.id])).rows,originalRows);
  assert.equal((await query("SELECT revision FROM cases WHERE id=$1",[original.id])).rows[0].revision,original.revision);
  assert.equal((await query("SELECT count(*)::int count FROM sources WHERE case_id=$1",[prepA.caseId])).rows[0].count,3);
  assert.equal((await query("SELECT count(*)::int count FROM import_package_revisions WHERE package_id=$1",[prepA.packageId])).rows[0].count,2);
  assert.deepEqual(await copy(prepA.packageId,input),assigned,"Reload/retry retains exact source IDs and provenance.");
  await rejected(copy(prepA.packageId,{...input,sourceIds:[csv.id],expectedRevision:assigned.revision}),"DOCUMENT_ALREADY_COPIED");
  const direct = await attachDocument(prepA.packageId,assigned.revision,{bytes:Buffer.from("Direct manual reference remains supported."),name:"direct.txt",format:"text",entityIds:[buildingA.id]});
  assert.equal(direct.revision,assigned.revision+1);
  assert.equal(direct.parts.at(-1)!.copiedFrom,undefined);
  assert.equal(direct.factCandidates.length,2);
  console.log("PASS Native PDF/PNG/levels CSV preserve bytes, per-part lineage, typed candidates, original case/history, concurrent idempotency and existing direct uploads.");
} finally {
  const caseIds = [...looseCases,...(areas.length ? (await query("SELECT id FROM cases WHERE site_id=ANY($1::uuid[])",[areas])).rows.map(row=>row.id) : [])];
  const keys = caseIds.length ? (await query("SELECT object_key FROM sources WHERE case_id=ANY($1::uuid[])",[caseIds])).rows.map(row=>row.object_key) : [];
  await transaction(async client=>{
    if (areas.length) for (const statement of [
      "DELETE FROM building_preparation_revisions WHERE preparation_id IN (SELECT id FROM building_preparations WHERE package_id IN (SELECT id FROM import_packages WHERE area_id=ANY($1::uuid[])))",
      "DELETE FROM building_preparations WHERE package_id IN (SELECT id FROM import_packages WHERE area_id=ANY($1::uuid[]))",
      "DELETE FROM area_check_runs WHERE area_id=ANY($1::uuid[])",
      "DELETE FROM external_identifiers WHERE feature_id IN (SELECT id FROM physical_features WHERE area_id=ANY($1::uuid[])) OR record_id IN (SELECT id FROM registry_records WHERE site_id=ANY($1::uuid[]))",
      "DELETE FROM physical_feature_revisions WHERE feature_id IN (SELECT id FROM physical_features WHERE area_id=ANY($1::uuid[]))",
      "DELETE FROM source_feature_links WHERE area_id=ANY($1::uuid[])",
      "DELETE FROM physical_features WHERE area_id=ANY($1::uuid[])",
      "DELETE FROM import_package_revisions WHERE package_id IN (SELECT id FROM import_packages WHERE area_id=ANY($1::uuid[]))",
      "DELETE FROM import_packages WHERE area_id=ANY($1::uuid[])",
      "DELETE FROM registry_records WHERE site_id=ANY($1::uuid[])",
    ]) await client.query(statement,[areas]);
    if (caseIds.length) for (const table of ["jobs","events","operations","sources","cases"])
      await client.query(`DELETE FROM ${table} WHERE ${table==="cases"?"id":"case_id"}=ANY($1::uuid[])`,[caseIds]);
    if (areas.length) for (const table of ["area_memberships","map_areas","registry_sites"])
      await client.query(`DELETE FROM ${table} WHERE ${table==="area_memberships"?"area_id":"id"}=ANY($1::uuid[])`,[areas]);
  });
  for (const key of new Set([...sourceKeys,...keys])) await removeOrphan(key);
  await pool().end();
}
