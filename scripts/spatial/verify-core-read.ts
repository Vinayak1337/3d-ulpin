/** Read-only live bridge proof. Never imports migrations, seeds, or area helpers. */
import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {spawn,type ChildProcess} from "node:child_process";
import {pool} from "../../apps/web/lib/server/db";
import {readLegacySpatialSlice} from "../../apps/web/lib/server/spatial-core-read";
import {normalizeLegacySpatialSlice} from "../../apps/web/features/spatial/data/core-legacy-adapter";
import type {WorldState} from "../../packages/contracts/src";

const selections:readonly [string,WorldState][]=[
  ["0ded05d3-b596-46a8-9918-ab1bc0a433be","synthetic"],
  ["276dc595-97c4-4253-bf47-db4a12fd542b","observed"],
  ["457bac4c-1c6c-4157-a12a-1d44ba3c1bcf","synthetic"],
];
assert.equal(process.env.REPO_DATA,"true","This local read profile must explicitly select the existing repository database");
const report:{kind:string;startedAt:string;tests:unknown[];before?:unknown;after?:unknown;result?:string;error?:string}={kind:"read-only-persisted-normalization",startedAt:new Date().toISOString(),tests:[]};
const base=process.env.SPATIAL_BASE_URL;
if(base){const url=new URL(base);assert(["localhost","127.0.0.1"].includes(url.hostname)&&url.protocol==="http:"&&!url.username&&!url.password);}
let ownedServer:ChildProcess|undefined;
async function startOwnedServer(){
  assert.equal(base,"http://127.0.0.1:3000","Owned verification server has one explicit loopback address");
  let occupied=false;try{await fetch(`${base}/api/v1/spatial/calibration/garden/summary.json`,{signal:AbortSignal.timeout(1000)});occupied=true;}catch{}
  assert(!occupied,"An existing server owns the verification port; do not replace it");
  ownedServer=spawn(process.execPath,["apps/web/node_modules/next/dist/bin/next","start","apps/web","--hostname","127.0.0.1","--port","3000"],{env:{...process.env,NEXT_TELEMETRY_DISABLED:"1"},stdio:["ignore","ignore","pipe"],windowsHide:true});
  let startupError:Error|undefined;ownedServer.on("error",e=>{startupError=e;});
  for(let i=0;i<60;i++){if(startupError)throw startupError;assert(ownedServer.exitCode===null,"Owned server stopped before readiness");try{if((await fetch(`${base}/api/v1/spatial/calibration/garden/summary.json`,{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}await new Promise(r=>setTimeout(r,500));}
  throw new Error("Owned verification server did not become ready");
}
async function fingerprint(){
  const c=await pool().connect();
  try{
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await c.query("SET LOCAL statement_timeout='20s'");
    assert.equal((await c.query("SELECT current_database() AS name")).rows[0].name,"ulpin_repo");
    const values=[];
    for(const name of ["map_areas","physical_features","physical_feature_revisions","registry_records","registry_revisions","sources"]){
      const r=await c.query(`SELECT count(*)::int AS rows,md5(COALESCE(string_agg(h,'' ORDER BY h),'')) AS digest FROM (SELECT md5(row_to_json(t)::text) AS h FROM ${name} t) q`);
      values.push({table:name,...r.rows[0]});
    }
    await c.query("COMMIT");return values;
  }catch(error){await c.query("ROLLBACK").catch(()=>{});throw error;}finally{c.release();}
}
try{
  if(process.env.SPATIAL_START_SERVER==="1")await startOwnedServer();
  report.before=await fingerprint();
  for(const [areaId,world] of selections){
    const start=Date.now(),slice=await readLegacySpatialSlice(areaId,world),normalized=await normalizeLegacySpatialSlice(slice,world);
    assert(normalized.input.identity.entities.length>0);
    assert.equal(normalized.legacy.features.length,slice.features.length);
    for(const source of slice.sources){const saved=normalized.input.sources.assets.find(a=>a.ref.id===source.id);assert(saved&&saved.sha256===source.sha256&&saved.bytes===source.bytes);}
    const second=await normalizeLegacySpatialSlice(await readLegacySpatialSlice(areaId,world),world);
    assert.equal(second.readDigest,normalized.readDigest,"Concurrent changes or unstable read signature detected");
    if(base){
      const endpoint=`${base}/api/v1/spatial/core/areas/${areaId}?world=${world}`;
      const response=await fetch(endpoint);assert.equal(response.status,200);const body=await response.json();
      assert.equal(body.readDigest,normalized.readDigest);assert.equal(response.headers.get("cache-control"),"no-store");
      assert.equal((await fetch(`${endpoint}&expectedDigest=${"0".repeat(64)}`)).status,409);
    }
    const entry={areaId,world,physicalFeatures:slice.features.length,registryRecords:slice.records.length,sources:slice.sources.length,representations:normalized.snapshot.geometry.representations.length,diagnostics:[...new Set(normalized.diagnostics.map(d=>d.code))],readDigest:normalized.readDigest,durationMs:Date.now()-start,httpVerified:!!base};
    report.tests.push(entry);console.log(JSON.stringify(entry));
  }
  report.after=await fingerprint();assert.deepEqual(report.after,report.before,"Protected database rows changed during the read-only run; investigate concurrent writers");report.result="PASS";
}catch(error){report.result="FAIL";report.error=error instanceof Error?`${error.name}: ${error.message}`:"Verification failed";console.error(report.error);process.exitCode=1;}
finally{ownedServer?.kill();await mkdir(".runtime/engineering",{recursive:true});await writeFile(".runtime/engineering/T009-live-read.json",JSON.stringify(report,null,2));await pool().end();}
