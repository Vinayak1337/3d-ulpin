import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { query, pool, transaction } from '../../apps/web/lib/server/db';
import { preparationContinuation, readPreparationBuild } from '../../apps/web/lib/server/preparation-continuation';
async function main() {
 const caseId='b5b9b4e8-c06a-4aca-afec-c8d443b708e1';
 const prep=(await query('SELECT package_id FROM building_preparations WHERE case_id=$1',[caseId])).rows[0];
 assert(prep,'Expected persisted private-PC T061 case');
 const snapshot=async()=> (await query(`SELECT c.revision,c.current_snapshot_id,
 (SELECT revision FROM import_packages WHERE id=$2) AS package_revision,
 (SELECT count(*) FROM sources WHERE case_id=$1) AS sources,
 (SELECT count(*) FROM jobs WHERE case_id=$1) AS jobs,
 (SELECT count(*) FROM registry_drafts WHERE case_id=$1) AS drafts,
 (SELECT count(*) FROM registry_reviews r JOIN registry_drafts d ON d.id=r.draft_id WHERE d.case_id=$1) AS reviews
 FROM cases c WHERE c.id=$1`,[caseId,prep.package_id])).rows[0];
 const before=await snapshot();
 // Simulate the general CaseDetail response containing only 30 later unrelated
 // jobs. All real database reads remain read-only; no fixture rows are changed.
 await transaction(async client => {
   await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const matching=(await client.query("SELECT * FROM jobs WHERE case_id=$1 AND operation='build' ORDER BY created_at DESC LIMIT 1",[caseId])).rows[0];
   assert(matching);
   const boundedHistory=new Proxy(client, { get(target,key) {
     if(key!=='query')return Reflect.get(target,key);
     return async (sql:string,values?:unknown[]) => {
       if(sql==='SELECT * FROM jobs WHERE case_id=$1 ORDER BY created_at DESC LIMIT 30')
         return {rows:Array.from({length:30},(_,i)=>({...matching,id:`unrelated-${i}`,operation:'inspect',input_fingerprint:`other-${i}`}))};
       return target.query(sql,values);
     };
   }});
   assert.equal((await readPreparationBuild(boundedHistory,prep.package_id)).state.status,'ready');
 });
 const first=await preparationContinuation(prep.package_id);
 const second=await preparationContinuation(prep.package_id);
 assert.deepEqual(first,second); assert.deepEqual(await snapshot(),before);
 assert.equal(first.status,'recorded');
 assert.equal(first.review?.committed,true);
 const evidence={checkedAt:new Date().toISOString(),context:'Private-PC linked T061 case; read-only, not hosted-fixture acceptance',caseId,packageId:prep.package_id,status:first.status,packageRevision:first.packageRevision,caseRevision:first.caseRevision,spaceCount:first.spaceCount,reviewId:first.review?.id,committed:first.review?.committed,matchingBuildBeyondHistoryWindow:true,before,after:await snapshot(),unchanged:true};
 await mkdir('docs/evidence/t065',{recursive:true});
 await writeFile('docs/evidence/t065/worker-state.json',JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({status:first.status,spaceCount:first.spaceCount,unchanged:true,evidence:'docs/evidence/t065/worker-state.json'}));
}
main().finally(()=>pool().end()).catch(e=>{console.error(e.message);process.exitCode=1});
