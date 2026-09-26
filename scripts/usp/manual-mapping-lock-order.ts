/** Official source setup via API; DB transactions below hold locks only, never alter records. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool, closePool } from '../../packages/server/src/infrastructure/db';
import { fingerprint } from '../../packages/server/src/modules/cases/domain';
import { assertUspIsolation, assertLocalOperatorProcess } from './local-isolation.mjs';

const scope=assertUspIsolation(process.env);assert.equal(process.env.ULPIN_ISOLATION_PROFILE,'local-nest');
const dir=process.argv[2],ownership=JSON.parse(readFileSync(join(dir,'ownership.json'),'utf8'));
assert.equal(ownership.project,scope.project);assert.deepEqual(ownership.operatorProvenance,assertLocalOperatorProcess(process.env));
const hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const original=readFileSync('fixtures/real-nyc/original.geojson'),provenance=JSON.parse(readFileSync('fixtures/real-nyc/provenance.json','utf8'));
assert.equal(hash(original),provenance.originalSha256);
const base=process.env.ULPIN_TEST_URL+'api/v1',name=`NYC OTI building footprint ${provenance.sourceKey.doitt_id}`,namespace='nyc-oti-5zhs-2jue';
const result:any={version:'manual-lock-order/1',status:'running',codeCommit:ownership.baseCommit,project:scope.project,nonce:ownership.nonce,
  sourceSha256:hash(original),sourcePath:'fixtures/real-nyc/original.geojson',schedules:[],notQualified:['Other lock paths','Model/provider behavior','Source revision reconciliation','Full GF-AGENT/INGEST-03 qualification']};
let phase='official-area';
async function call(path:string,body?:unknown){
  const response=await fetch(base+path,{...(body?{method:'POST',body:body instanceof FormData?body:JSON.stringify(body)}:{}),
    headers:body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{},signal:AbortSignal.timeout(30000)});
  return {status:response.status,value:await response.json()};
}
function status(response:{status:number;value:any},expected:number){assert.equal(response.status,expected,response.value.error?.code);return response.value;}
function file(fields:Record<string,string|number>){const form=new FormData();form.set('file',new Blob([original],{type:'application/geo+json'}),'original.geojson');for(const [key,value]of Object.entries(fields))form.set(key,String(value));return form;}
async function waitLocked(query:string){
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){
    const row=(await pool().query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query=$1",[query])).rows[0];
    if(row)return Number(row.pid);
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw new Error('The expected bounded lock wait did not occur.');
}
async function recipe(area:any){
  const caseId=status(await call('/source-cases',{requestKey:randomUUID(),name}),201).caseId;
  const path=`/ingestion/cases/${caseId}`;
  const profile=status(await call(`${path}/sources`,file({requestKey:randomUUID(),expectedWorkspaceRevision:0,format:'geojson'})),201);
  const plan={version:profile.version,mode:'manual_mapping',source:profile.source,caseId,workspaceRevision:profile.workspaceRevision,workspaceFingerprint:profile.workspaceFingerprint,
    operations:[{target:'building.sourceKey',sourcePath:'/features/*/properties/doitt_id',conversionId:'literal_identifier@1'},
      {target:'building.geometry',sourcePath:'/features/*/geometry',conversionId:'geojson_polygon@1'}]};
  const authored=status(await call(`${path}/sources/${profile.source.sourceId}/recipes`,{requestKey:randomUUID(),expectedRecipeRevision:0,plan,
    destination:{kind:'existing_area',areaId:area.id,expectedAreaRevision:area.revision,referenceFingerprint:fingerprint(area.reference||null),name,namespace}}),201);
  const recipePath=`${path}/recipes/${authored.id}`;
  const approved=status(await call(`${recipePath}/approve`,{requestKey:randomUUID(),expectedRecipeRevision:authored.revision}),200);
  return {caseId,sourceId:profile.source.sourceId,recipeId:authored.id,recipePath,approved,
    executeInput:{requestKey:randomUUID(),expectedRecipeRevision:approved.revision},
    assignInput:{requestKey:randomUUID(),caseId,areaId:area.id,expectedAreaRevision:area.revision,name,worldStatus:'observed'}};
}
try {
  const seed=status(await call('/import-packages',file({format:'geojson',namespace,name,mapping:JSON.stringify({idField:'doitt_id',kind:'building',geometryRole:'unknown'})})),201);
  const area=status(await call(`/areas/${seed.areaId}/context`),200).area;
  result.seed={packageId:seed.id,areaId:area.id,areaRevision:area.revision};

  phase='execute-first';
  const first=await recipe(area),blocker=await pool().connect();
  let execute:ReturnType<typeof call>|undefined,assign:ReturnType<typeof call>|undefined;
  try{
    await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${namespace}:${name}`]);
    execute=call(`${first.recipePath}/execute`,first.executeInput);
    await waitLocked('SELECT pg_advisory_xact_lock(hashtextextended($1,0))');
    assign=call('/source-workspaces',first.assignInput);
    const assignmentPid=await waitLocked('SELECT id FROM cases WHERE id=$1 FOR UPDATE');
    const heldAreaLocks=(await pool().query("SELECT count(*)::int n FROM pg_locks WHERE pid=$1 AND relation='map_areas'::regclass AND granted",[assignmentPid])).rows[0].n;
    assert.equal(heldAreaLocks,0,'Source-workspace assignment must wait on the case before acquiring any destination area lock.');
    await blocker.query('ROLLBACK');
    const executed=status(await execute,200),assigned=status(await assign,201);
    assert.equal(executed.state,'executed');assert.equal(executed.execution.sourceRevisionId,first.sourceId);
    assert.equal(assigned.sourceWorkspace.caseId,first.caseId);assert.deepEqual(assigned.sourceRevisionIds,[first.sourceId]);
    assert.deepEqual(status(await call('/source-workspaces',first.assignInput),201),assigned);
    status(await call(`${first.recipePath}/execute`,{requestKey:randomUUID(),expectedRecipeRevision:executed.revision}),409);
    const history=status(await call(first.recipePath),200);assert.deepEqual(history.map((r:any)=>r.state),['proposed','approved','executed']);
    result.schedules.push({order:'execute_then_assignment',...first,executeStatus:200,assignmentStatus:201,assignmentPid,heldAreaLocksWhileWaiting:heldAreaLocks,packageId:executed.execution.packageId,sourceWorkspaceId:assigned.id,currentContextRetryStatus:409,history:history.map((r:any)=>r.state)});
  }finally{
    await blocker.query('ROLLBACK').catch(()=>{});blocker.release();await Promise.allSettled([execute,assign].filter(Boolean));
  }

  phase='assignment-first';
  const second=await recipe(area),caseBlocker=await pool().connect();let assignment:ReturnType<typeof call>|undefined,execution:ReturnType<typeof call>|undefined;
  try{
    await caseBlocker.query('BEGIN');await caseBlocker.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE',[second.caseId]);
    assignment=call('/source-workspaces',second.assignInput);await waitLocked('SELECT id FROM cases WHERE id=$1 FOR UPDATE');
    execution=call(`${second.recipePath}/execute`,second.executeInput);await waitLocked('SELECT id,revision FROM cases WHERE id=$1 FOR UPDATE');
    await caseBlocker.query('ROLLBACK');
    const assigned=status(await assignment,201),denied=status(await execution,409);assert.equal(denied.error.code,'STALE_REVISION');
    const history=status(await call(second.recipePath),200);assert.deepEqual(history.map((r:any)=>r.state),['proposed','approved']);
    assert.deepEqual(status(await call('/source-workspaces',second.assignInput),201),assigned);
    result.schedules.push({order:'assignment_then_execute',...second,assignmentStatus:201,executeStatus:409,errorCode:denied.error.code,sourceWorkspaceId:assigned.id,history:history.map((r:any)=>r.state)});
  }finally{await caseBlocker.query('ROLLBACK').catch(()=>{});caseBlocker.release();await Promise.allSettled([assignment,execution].filter(Boolean));}

  phase='preserved-state';
  result.counts=(await pool().query(`SELECT (SELECT count(*)::int FROM sources) sources,(SELECT count(*)::int FROM usp_mapping_recipes) recipes,
    (SELECT count(*)::int FROM usp_mapping_recipe_revisions) history,(SELECT count(*)::int FROM import_packages) packages,
    (SELECT count(*)::int FROM jobs) jobs,(SELECT count(*)::int FROM usp_model_calls) "modelCalls"`)).rows[0];
  assert.deepEqual(result.counts,{sources:3,recipes:2,history:5,packages:4,jobs:0,modelCalls:0});
  for(const schedule of result.schedules){const response=await fetch(base+`/sources/${schedule.sourceId}/file`);assert.equal(response.status,200);assert.equal(hash(new Uint8Array(await response.arrayBuffer())),provenance.originalSha256);}
  assert.equal(hash(readFileSync('fixtures/real-nyc/original.geojson')),provenance.originalSha256);
  result.status='passed';console.log(JSON.stringify({status:result.status,codeCommit:result.codeCommit,project:result.project,schedules:result.schedules.map((r:any)=>({order:r.order,executeStatus:r.executeStatus,assignmentStatus:r.assignmentStatus})),counts:result.counts}));
}catch(error:any){result.status='failed';result.failure={phase,name:error.name,message:error.message};throw error;}
finally{result.completedAt=new Date().toISOString();writeFileSync(join(dir,'manual-lock-order.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});await closePool();}
