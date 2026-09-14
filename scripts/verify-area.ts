import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AreaGeometry, AreaReference, ImportPackage, PhysicalFeature } from "../packages/contracts/src";
import { acquireSource } from "../apps/web/lib/server/area-acquisitions";
import { migrateAreas } from "../apps/web/lib/server/area-db";
import { addFact, answerQuestion, areaContext, areaGeo, attachDocument, commitPackage, getArea, getPackage, ingestArea, reviewPackage, runAreaCheck } from "../apps/web/lib/server/areas";
import { pool, query, transaction } from "../apps/web/lib/server/db";
import { originalAttempt } from "../apps/web/lib/server/original-attempt";
import { putOriginal, readObject, removeOrphan, sha256 } from "../apps/web/lib/server/storage";
import { getSourceCatalogEntry } from "../apps/web/lib/source-catalog";

process.env.ULPIN_FIXTURE_ROOT ||= path.resolve(process.cwd(), "fixtures");
const runId = randomUUID();
const areaIds = new Set<string>();
const acquisitionIds = new Set<string>();
const acquisitionKeys = new Set<string>();
const encode = (data: unknown) => new TextEncoder().encode(JSON.stringify(data));
const close = (x: number, y: number, width: number, height: number): number[][] => [[x,y],[x+width,y],[x+width,y+height],[x,y+height],[x,y]];
const shiftedRing = (ring: number[][], x = 500000, y = 3100000) => ring.map(([a,b]) => [a+x,b+y]);
const feature = (id: string, rings: number[][][], height: number | null, name = id) => ({ attributes: {id,name,height}, geometry: {rings:rings.map(ring => shiftedRing(ring))} });
const nativeSource = (revision: number) => ({ spatialReference: {wkid:32643}, features: [
  feature("A1", [close(revision===1 ? 0 : 1,0,10,10),close(revision===1 ? 2 : 3,2,2,2)], revision===1 ? 10 : 11, `Synthetic building revision ${revision}`),
  ...(revision===1 ? [feature("A2", [close(20,0,2,2),close(24,0,2,2)], 6, "Synthetic multipart building")] : []),
  feature("A3", [close(40,0,4,4)], null, "Synthetic footprint kept in 2D"),
  feature("A4", [close(50,0,4,4)], null, "Synthetic display estimate"),
] });
const baseMapping = { idField:"id",nameField:"name",kind:"building" as const,heightField:"height",heightUnit:"m" as const };
const acknowledge = "Integration verification only: physical observations, explicit synthetic test geometry, unresolved relative Z and source limitations retained. No rights or safety conclusion.";
const near = (actual: number, expected: number, tolerance = 1e-5) => assert(Math.abs(actual-expected)<tolerance, `${actual} differs from ${expected}`);
const remember = (pkg: ImportPackage) => { areaIds.add(pkg.areaId); return pkg; };
async function api<T>(route: string, body?: unknown, status = 200): Promise<T> {
  const response = await fetch(`http://127.0.0.1:3000/api/v1${route}`, {
    method:body ? "POST" : "GET",headers:body ? {"Content-Type":"application/json"} : undefined,
    body:body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  assert.equal(response.status,status,`API ${route}: ${result.error?.message || response.statusText}`);
  return result;
}
async function record(pkg: ImportPackage) {
  const reviewed = await api<ImportPackage>(`/import-packages/${pkg.id}/review`,{expectedRevision:pkg.revision});
  assert(reviewed.review?.inputFingerprint);
  return api<ImportPackage>(`/import-packages/${reviewed.id}/commit`,{expectedRevision:reviewed.revision,acknowledgement:acknowledge});
}
function geometryBounds(geometry: AreaGeometry): [number,number,number,number] {
  const points: number[][] = [];
  const visit = (coordinates: unknown) => {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === "number") points.push(coordinates as number[]);
    else for (const item of coordinates) visit(item);
  };
  visit(geometry.coordinates);
  return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
}

try {
  await migrateAreas();
  const abandonedSourceId = randomUUID();
  const abandonedKey = `verification/${runId}/abandoned-original`;
  acquisitionKeys.add(abandonedKey);
  await assert.rejects(originalAttempt("sources",abandonedSourceId,async rememberKey=>{
    rememberKey(abandonedKey);
    await putOriginal(abandonedKey,encode({synthetic:true,testRun:runId}),"application/json");
    throw new Error("Intentional fixture failure before source persistence");
  }),/Intentional fixture failure/);
  await assert.rejects(readObject(abandonedKey),(error:unknown)=>
    (error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404,
    "A failed attempt must remove only its unreferenced original object",
  );
  console.log("PASS A failed source attempt removes its own unreferenced original without leaving a stored object.");
  const catalog = getSourceCatalogEntry("nyc-building-footprints")!;
  const acquisitionKey = randomUUID();
  const acquisition = await api<Awaited<ReturnType<typeof acquireSource>>>("/acquisitions",{sourceId:catalog.id,mode:"saved",requestKey:acquisitionKey},201);
  acquisitionIds.add(acquisition.id); acquisitionKeys.add(acquisition.objectKey);
  assert.equal(acquisition.status,"complete");
  assert.equal((await acquireSource(catalog.id,"saved",acquisitionKey)).id,acquisition.id);
  assert.equal((await api<Awaited<ReturnType<typeof acquireSource>>>(`/acquisitions/${acquisition.id}`)).id,acquisition.id);
  const original = await readObject(acquisition.objectKey);
  assert.equal(sha256(original),catalog.snapshot!.sha256);
  const sourceData = JSON.parse(new TextDecoder().decode(original));
  assert.equal(sourceData.features.length,62);
  const savedMapping = { idField:catalog.adapter.idField,kind:"building" as const,heightField:catalog.adapter.heightField!,heightUnit:"ft" as const,heightMeaning:catalog.adapter.heightMeaning,identifierFields:["bin","base_bbl"] };
  const realInput = {bytes:original,filename:"unchanged-saved-source.geojson",format:"geojson" as const,namespace:`verify-area:${runId}:saved-source`,name:`Verification saved source ${runId}`,mapping:savedMapping,acquisitionId:acquisition.id};
  let real = remember(await ingestArea(realInput));
  assert.equal(real.features.length,62);
  assert.equal((await areaContext(real.areaId)).features.length,0,"Draft import must not publish current physical observations");
  for (const item of real.features) {
    const raw = sourceData.features.find((f: any) => String(f.properties.doitt_id)===item.sourceKey);
    assert(raw);
    assert.equal(item.kind,"building");
    assert.equal(item.representation,"physical_exterior");
    assert.equal(item.worldStatus,"observed");
    assert.equal(item.height.unit,"m");
    assert.equal(item.height.state,"source_supported");
    near(item.height.value!,Number(raw.properties.height_roof)*0.3048,1e-10);
    assert.deepEqual(item.sourceGeometry,raw.geometry);
    assert.equal(item.properties.bin,raw.properties.bin,"Mapped non-personal identifiers must survive normalization");
    assert(item.areaM2!>0);
  }
  const reservedKinds = (await query("SELECT kind,count(*)::int count FROM registry_records WHERE site_id=$1 GROUP BY kind",[real.areaId])).rows;
  assert.deepEqual(reservedKinds,[{kind:"building",count:62}],"Exterior footprints must never fabricate floor/apartment identities");
  const realSource = (await query("SELECT object_key,sha256 FROM sources WHERE id=$1",[real.sourceRevisionIds[0]])).rows[0];
  assert.equal(sha256(await readObject(realSource.object_key)),realSource.sha256);
  real = await record(real);
  assert.equal(real.state,"COMMITTED");
  assert.deepEqual(await getPackage(real.id),real);
  assert.deepEqual(await api<ImportPackage>(`/import-packages/${real.id}`),real);
  const recordedReal = await areaContext(real.areaId);
  assert.equal(recordedReal.features.length,62);
  assert.equal(recordedReal.area.revision,1);
  const resolved = await api<{status:string;matches:{feature?:PhysicalFeature;areaIds:string[];matchEvidence:{scheme:string}[]}[]}>("/resolve?identifier=353927");
  assert(["matched","ambiguous"].includes(resolved.status));
  const ownMatch = resolved.matches.find(match=>match.feature?.areaId===real.areaId&&match.feature.sourceKey==="353927")!;
  assert(ownMatch,"Global source-ID search must find this area without administrative filters");
  assert(ownMatch.areaIds.includes(real.areaId));
  assert(ownMatch.matchEvidence.some(evidence=>evidence.scheme==="source_feature_id"));
  assert(ownMatch.matchEvidence.every(evidence=>evidence.scheme!=="official_ulpin"),"A NYC source ID must never be promoted to official ULPIN");
  assert.equal((await ingestArea({...realInput,expectedAreaRevision:0})).id,real.id,"An exact successful source retry remains idempotent after area revision advances");
  const realCheck = await runAreaCheck(real.areaId,1);
  assert.equal(realCheck.status,"completed");
  assert(realCheck.coverage.some(note=>/No vertical collision volume/.test(note)));
  assert(realCheck.findings.every(finding=>finding.volumeM3===undefined));
  assert.equal((await areaContext(real.areaId)).latestCheck!.id,realCheck.id);
  console.log("PASS Saved acquisition preserves 62 real exterior footprints, original bytes, BIN/source IDs, metre heights and review/commit persistence without invented apartments.");
  for (const kind of ["road","utility"] as const) {
    const areaRevision = (await getArea(real.areaId)).revision;
    let scenario = remember(await api<ImportPackage>(`/areas/${real.areaId}/scenario`,{expectedRevision:areaRevision,kind},201));
    assert(scenario.features.every(f=>f.worldStatus==="synthetic"&&f.kind===kind));
    assert.equal((await areaContext(real.areaId)).features.filter(f=>f.kind===kind).length,0);
    assert.equal((await api<ImportPackage>(`/areas/${real.areaId}/scenario`,{expectedRevision:areaRevision,kind},201)).id,scenario.id);
    scenario = await record(scenario);
  }
  const scenarioContext = await areaContext(real.areaId);
  assert.equal(scenarioContext.features.filter(f=>f.worldStatus==="observed").length,62);
  assert.equal(scenarioContext.features.filter(f=>f.worldStatus==="synthetic").length,2);
  assert.equal(scenarioContext.latestCheck!.stale,true);
  const scenarioCheck = await runAreaCheck(real.areaId,scenarioContext.area.revision);
  assert.equal(scenarioCheck.status,"completed");
  assert(scenarioCheck.findings.some(f=>f.code==="BUILDING_ROAD_OVERLAP"&&f.message.includes("observed")&&f.message.includes("synthetic")));
  assert(scenarioCheck.findings.some(f=>f.code==="UTILITY_HORIZONTAL_INTERSECTION"));
  assert(scenarioCheck.findings.some(f=>f.code==="UTILITY_VERTICAL_UNRESOLVED"));
  assert(scenarioCheck.findings.every(f=>f.volumeM3===undefined));
  console.log("PASS Road and utility scenario APIs prepare separate synthetic drafts over observed context, preserve all 62 buildings, and compute horizontal findings with explicit unknown utility Z.");

  const syntheticInput = {bytes:encode(nativeSource(1)),filename:"synthetic-projected-area.json",format:"arcgis" as const,namespace:`verify-area:${runId}:buildings`,name:`Synthetic verification area ${runId}`,mapping:baseMapping,sourceCrs:"EPSG:32643",worldStatus:"synthetic" as const};
  const retries = await Promise.all(Array.from({length:3},()=>ingestArea(syntheticInput).then(remember)));
  assert.equal(new Set(retries.map(pkg=>pkg.id)).size,1,"Concurrent source retries must allocate one package");
  let synthetic = retries[0];
  const initial = structuredClone(synthetic);
  const courtyard = synthetic.features.find(item=>item.sourceKey==="A1")!;
  const multipart = synthetic.features.find(item=>item.sourceKey==="A2")!;
  assert.equal(courtyard.geometry.type,"Polygon");
  assert.equal((courtyard.geometry as Extract<AreaGeometry,{type:"Polygon"}>).coordinates.length,2);
  near(courtyard.areaM2!,96);
  assert.equal(multipart.geometry.type,"MultiPolygon");
  assert.equal((multipart.geometry as Extract<AreaGeometry,{type:"MultiPolygon"}>).coordinates.length,2);
  near(multipart.areaM2!,8);
  assert.equal(synthetic.questions.length,2);
  const kept = synthetic.features.find(item=>item.sourceKey==="A3")!;
  const estimated = synthetic.features.find(item=>item.sourceKey==="A4")!;
  synthetic = await answerQuestion(synthetic.id,synthetic.revision,synthetic.questions.find(q=>q.entityId===kept.id)!.id,{choice:"keep_2d",reason:"The synthetic fixture intentionally has no vertical observation."});
  synthetic = await answerQuestion(synthetic.id,synthetic.revision,synthetic.questions.find(q=>q.entityId===estimated.id)!.id,{choice:"estimate",value:8,reason:"Eight metres is only a synthetic display estimate."});
  assert.equal(synthetic.features.find(f=>f.id===kept.id)!.height.value,null);
  assert.equal(synthetic.features.find(f=>f.id===estimated.id)!.height.state,"estimated");
  assert.equal(synthetic.features.find(f=>f.id===estimated.id)!.height.value,8);
  assert.equal((await getPackage(synthetic.id)).questions.filter(q=>q.answer).length,2);

  synthetic = await attachDocument(synthetic.id,synthetic.revision,{bytes:new TextEncoder().encode("Synthetic diagram for A1: exterior height claim 12 metres.\nGenerated integration test reference, never survey evidence."),name:"synthetic-height-reference.txt",format:"text",entityIds:[courtyard.id]});
  assert(synthetic.parts.length>=1);
  assert.equal(typeof synthetic.parts[0].locator,"string");
  assert.match(synthetic.parts[0].locator,/line 1/i);
  const part = synthetic.parts[0];
  const claim = {entityId:courtyard.id,property:"building.exteriorHeight",value:12,unit:"m",referenceFrameId:courtyard.height.reference,evidence:[{sourceRevisionId:part.sourceRevisionId,partId:part.id}]};
  await assert.rejects(addFact(synthetic.id,synthetic.revision,{...claim,evidence:[{sourceRevisionId:part.sourceRevisionId}]}),/evidence|part|locator|source/i,"A source-only claim cannot bypass precise entity-associated evidence");
  synthetic = await addFact(synthetic.id,synthetic.revision,claim);
  const discrepancy = synthetic.questions.find(q=>q.entityId===courtyard.id)!;
  assert(discrepancy && !discrepancy.answer);
  const documentClaim = synthetic.factCandidates.find(f=>f.entityId===courtyard.id&&f.value===12)!;
  synthetic = await answerQuestion(synthetic.id,synthetic.revision,discrepancy.id,{choice:"select_claim",claimId:documentClaim.id,reason:"Use the synthetic diagram height of 12 metres in the proposed geometry; recording still requires review."});
  assert.equal(synthetic.features.find(f=>f.id===courtyard.id)!.height.value,12);
  assert.equal((await areaContext(synthetic.areaId)).features.length,0,"Selecting a claim must update only the proposal until review/commit");
  assert.equal(synthetic.factCandidates.filter(f=>f.entityId===courtyard.id&&f.property==="building.exteriorHeight").length,2);
  synthetic = await record(synthetic);
  assert.equal((await areaContext(synthetic.areaId)).features.length,4);
  assert.equal((await ingestArea(syntheticInput)).id,synthetic.id);
  const refusedOfficialId = await api<{error:{code:string}}>("/external-identifiers",{featureId:courtyard.id,scheme:"official_ulpin",value:`TEST-NOT-AN-ULPIN-${runId}`,issuer:"Synthetic negative integration test",sourceId:synthetic.sourceRevisionIds[0],locator:"Generated fixture; this assertion must be rejected",expectedRevision:1},422);
  assert.equal(refusedOfficialId.error.code,"PARCEL_REQUIRED");
  assert.equal((await query("SELECT count(*)::int count FROM external_identifiers WHERE feature_id=$1 AND scheme='official_ulpin'",[courtyard.id])).rows[0].count,0);
  await assert.rejects(ingestArea({...syntheticInput,areaId:synthetic.areaId,mapping:{...baseMapping,kind:"road"}}),/representation kind|source association/i,"A stable feature key cannot silently change its entity kind");
  console.log("PASS Projected normalization preserves exact courtyard/multipart area; unknown heights remain 2D or labeled estimates; document claim selection updates only proposed height and retains both claims.");

  const beforeCorrection = await areaContext(synthetic.areaId);
  let correction = remember(await ingestArea({...syntheticInput,bytes:encode(nativeSource(2)),areaId:synthetic.areaId,expectedAreaRevision:beforeCorrection.area.revision}));
  assert.notEqual(correction.id,synthetic.id);
  assert.equal(correction.features.length,3);
  for (const revised of correction.features) {
    const previous = initial.features.find(item=>item.sourceKey===revised.sourceKey)!;
    assert.equal(revised.id,previous.id);
    assert.equal(revised.identifier,previous.identifier);
    assert.equal(revised.revision,1);
  }
  assert.deepEqual((await areaContext(synthetic.areaId)).features,beforeCorrection.features);
  correction = await reviewPackage(correction.id,correction.revision);
  const roadData = {spatialReference:{wkid:32643},features:[feature("ROAD",[close(5,-1,7,3)],null,"Synthetic road reserve") ]};
  let road = remember(await ingestArea({bytes:encode(roadData),filename:"synthetic-road.json",format:"arcgis",namespace:`verify-area:${runId}:road`,name:syntheticInput.name,mapping:{idField:"id",kind:"road"},areaId:synthetic.areaId,expectedAreaRevision:1,worldStatus:"synthetic",sourceCrs:"EPSG:32643"}));
  road = await record(road);
  await assert.rejects(commitPackage(correction.id,correction.revision,acknowledge),/neighbours changed|review/i,"A changed area invalidates its previous review");
  correction = await record(correction);
  const afterCorrection = await areaContext(synthetic.areaId);
  assert.equal(afterCorrection.features.length,5,"A source omission must not implicitly delete another current observation");
  assert.equal(afterCorrection.features.find(item=>item.id===multipart.id)!.revision,1);
  assert.equal(afterCorrection.features.find(item=>item.id===courtyard.id)!.revision,2);
  assert.equal((await query("SELECT count(*)::int count FROM physical_feature_revisions WHERE feature_id=$1",[courtyard.id])).rows[0].count,2);
  assert.equal((await getPackage(synthetic.id)).features.find(f=>f.id===courtyard.id)!.height.value,12);
  assert.equal((await getPackage(correction.id)).features.find(f=>f.id===courtyard.id)!.height.value,11);
  let proposalA = remember(await ingestArea({...syntheticInput,bytes:encode(nativeSource(3)),areaId:synthetic.areaId,expectedAreaRevision:afterCorrection.area.revision}));
  let proposalB = remember(await ingestArea({...syntheticInput,bytes:encode(nativeSource(4)),areaId:synthetic.areaId,expectedAreaRevision:afterCorrection.area.revision}));
  proposalA = await record(proposalA);
  proposalB = await reviewPackage(proposalB.id,proposalB.revision);
  await assert.rejects(commitPackage(proposalB.id,proposalB.revision,acknowledge),/observation changed|baseline|rebase/i,"A proposal cannot overwrite a newer feature baseline");
  proposalB = await api<ImportPackage>(`/import-packages/${proposalB.id}/rebase`,{expectedRevision:proposalB.revision});
  assert.equal(proposalB.review,undefined);
  assert.equal(proposalB.features.find(f=>f.id===courtyard.id)!.revision,3);
  assert.equal(proposalB.features.find(f=>f.id===courtyard.id)!.name,"Synthetic building revision 4");
  await assert.rejects(commitPackage(proposalB.id,proposalB.revision,acknowledge),/review/i);
  proposalB = await record(proposalB);
  const correctionRequestKey = randomUUID();
  const operatorCorrection = remember(await api<ImportPackage>(`/import-packages/${synthetic.id}/correction`,{requestKey:correctionRequestKey},201));
  assert.notEqual(operatorCorrection.id,synthetic.id);
  assert.equal((await api<ImportPackage>(`/import-packages/${synthetic.id}/correction`,{requestKey:correctionRequestKey},201)).id,operatorCorrection.id);
  assert(operatorCorrection.features.every(f=>operatorCorrection.sourceRevisionIds.includes(f.sourceRevisionId)),"An operator correction must retain evidence for its loaded current feature bodies");
  assert.equal(operatorCorrection.features.find(f=>f.id===courtyard.id)!.revision,4);
  assert.equal((await areaContext(synthetic.areaId)).features.find(f=>f.id===courtyard.id)!.revision,4);
  const utilityData = {spatialReference:{wkid:32643},features:[{attributes:{id:"UTILITY"},geometry:{paths:[shiftedRing([[6,-1],[6,11]])]}}]};
  let utility = remember(await ingestArea({bytes:encode(utilityData),filename:"synthetic-utility.json",format:"arcgis",namespace:`verify-area:${runId}:utility`,name:syntheticInput.name,mapping:{idField:"id",kind:"utility"},areaId:synthetic.areaId,expectedAreaRevision:(await getArea(synthetic.areaId)).revision,worldStatus:"synthetic",sourceCrs:"EPSG:32643"}));
  utility = await record(utility);
  const checked = await runAreaCheck(synthetic.areaId,(await getArea(synthetic.areaId)).revision);
  assert.equal(checked.status,"completed");
  const roadFinding = checked.findings.find(f=>f.code==="BUILDING_ROAD_OVERLAP"&&f.featureIds.includes(courtyard.id))!;
  assert(roadFinding);
  near(roadFinding.areaM2!,12);
  assert(checked.findings.some(f=>f.code==="UTILITY_HORIZONTAL_INTERSECTION"));
  assert(checked.findings.some(f=>f.code==="UTILITY_VERTICAL_UNRESOLVED"));
  assert(checked.findings.every(f=>f.volumeM3===undefined));
  console.log("PASS Source corrections retain IDs/history and current isolation; stale reviews fail; omitted features remain; real geometry checks return the independent 12 m² road overlap and unresolved utility Z.");

  // Generated overlays are explicitly synthetic; the unchanged NYC observation remains observed.
  const observed = recordedReal.features[0];
  const reference = recordedReal.area.reference!;
  const [west,south,east,north] = geometryBounds(observed.geometry);
  const overlayRaw = {spatialReference:{wkid:Number(reference.analysisCrs.slice(5))},features:[{attributes:{id:"SYNTHETIC-ROAD"},geometry:{rings:[shiftedRing(close(west,south,east-west,north-south),...reference.origin)]}}]};
  const overlay = await areaGeo<{features:PhysicalFeature[];reference:AreaReference}>("normalize",{format:"arcgis",data:overlayRaw,mapping:{idField:"id",kind:"road"},worldStatus:"synthetic",reference:{analysisCrs:reference.analysisCrs,origin:reference.origin}});
  const mixed = await areaGeo<{findings: {message:string;code:string;volumeM3?:number}[]}>("check",{reference,features:[observed,{...overlay.features[0],id:randomUUID()}]});
  assert(mixed.findings.some(f=>f.code==="BUILDING_ROAD_OVERLAP"&&f.message.includes("observed")&&f.message.includes("synthetic")));
  assert(mixed.findings.every(f=>f.volumeM3===undefined));
  console.log("PASS Mixed observed/synthetic checks retain both classifications and never present horizontal intersection as measured 3D collision.");
} finally {
  // Only fixtures whose UUID-backed namespaces were allocated by this run are removed.
  const ids = [...areaIds];
  const sourceKeys = ids.length ? (await query("SELECT s.object_key FROM sources s JOIN cases c ON c.id=s.case_id WHERE c.site_id=ANY($1::uuid[])",[ids])).rows.map(row=>row.object_key as string) : [];
  if (ids.length) await transaction(async client=>{
    const units = (await client.query("SELECT unit_id FROM area_memberships WHERE area_id=ANY($1::uuid[])",[ids])).rows.map(row=>row.unit_id);
    await client.query("DELETE FROM external_identifiers WHERE feature_id IN (SELECT id FROM physical_features WHERE area_id=ANY($1::uuid[])) OR record_id IN (SELECT id FROM registry_records WHERE site_id=ANY($1::uuid[]))",[ids]);
    await client.query("DELETE FROM physical_feature_revisions WHERE feature_id IN (SELECT id FROM physical_features WHERE area_id=ANY($1::uuid[]))",[ids]);
    await client.query("DELETE FROM source_feature_links WHERE area_id=ANY($1::uuid[])",[ids]);
    await client.query("DELETE FROM physical_features WHERE area_id=ANY($1::uuid[])",[ids]);
    await client.query("DELETE FROM import_package_revisions WHERE package_id IN (SELECT id FROM import_packages WHERE area_id=ANY($1::uuid[]))",[ids]);
    await client.query("DELETE FROM import_packages WHERE area_id=ANY($1::uuid[])",[ids]);
    await client.query("DELETE FROM area_check_runs WHERE area_id=ANY($1::uuid[])",[ids]);
    await client.query("DELETE FROM area_memberships WHERE area_id=ANY($1::uuid[])",[ids]);
    if(units.length) await client.query("DELETE FROM administrative_units WHERE id=ANY($1::uuid[])",[units]);
    await client.query("DELETE FROM registry_records WHERE site_id=ANY($1::uuid[])",[ids]);
    await client.query("DELETE FROM sources WHERE case_id IN (SELECT id FROM cases WHERE site_id=ANY($1::uuid[]))",[ids]);
    await client.query("DELETE FROM cases WHERE site_id=ANY($1::uuid[])",[ids]);
    await client.query("DELETE FROM map_areas WHERE id=ANY($1::uuid[])",[ids]);
    await client.query("DELETE FROM registry_sites WHERE id=ANY($1::uuid[])",[ids]);
  });
  if(acquisitionIds.size) await query("DELETE FROM area_acquisitions WHERE id=ANY($1::uuid[])",[[...acquisitionIds]]);
  for(const key of [...sourceKeys,...acquisitionKeys]) await removeOrphan(key);
  await pool().end();
}
