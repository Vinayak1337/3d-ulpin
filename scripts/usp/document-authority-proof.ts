/** Actual retained sources + memory-only snapshot protocol envelopes. No registry
 * association, source fact, geometry, snapshot or packet record is fabricated. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pool,transaction,closePool} from '../../packages/server/src/infrastructure/db';
import {sha256} from '../../packages/server/src/infrastructure/storage';
import {fingerprint,sourceFrom} from '../../packages/server/src/modules/cases/domain';
import {DocumentInputSchema,UspSnapshotManifestSchema} from '../../packages/contracts/src/usp';
import {readDocumentResult,documentResultKey,DocumentIngestionService} from '../../packages/server/src/modules/usp/ingestion/documents';
import {documentAuthorityTx,documentSnapshotView,captureDocumentSourceTx,assertDocumentPackageParts} from '../../packages/server/src/modules/usp/ingestion/document-authority';
import {readSnapshotBody,readSnapshotOriginal,readManifest,readRegistryEvidenceBytes} from '../../packages/server/src/modules/usp/snapshots';
import {readExactPart,createPacket0,readPacket0} from '../../packages/server/src/modules/usp/packet0';
import {exportCityJson} from '../../packages/server/src/modules/usp/exchange';
import {copyCaseDocuments} from '../../packages/server/src/modules/areas/areas';
import {localRequestContext} from '../../packages/server/src/modules/usp/principal';
import {assertUspIsolation} from './local-isolation.mjs';

assertUspIsolation(process.env);assert.equal(process.env.ULPIN_ISOLATION_PROFILE,'local-nest');
const [caseId,sourceId,jobId,originalPath,phase]=process.argv.slice(2);
const db=pool(),connect=db.connect,subject=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT!;
let saved:any;
try{
  const source=(await db.query('SELECT * FROM sources WHERE id=$1 AND case_id=$2',[sourceId,caseId])).rows[0];
  const job=(await db.query('SELECT j.payload,m.result_ref FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id WHERE j.id=$1',[jobId])).rows[0];
  const input=DocumentInputSchema.parse(job.payload),result=await readDocumentResult(input,job.result_ref.sha256);
  // Mirror the former db985b9 inspection in memory from actual canonical text.
  const historical={...source,inspection:{...source.inspection,documentAccepted:{jobId,sha256:job.result_ref.sha256},referenceParts:result.native.parts.map(p=>({id:p.id,sourceRevisionId:sourceId,locator:p.locator.label,text:p.text,entityIds:[]}))}};
  const before=fingerprint(historical);
  const pin={ref:{namespace:'source_revision',id:sourceId},revision:source.revision};
  const digest=fingerprint(historical),scope={kind:'snapshot',scopeId:caseId,world:{namespace:'world',id:`registry-site/${caseId}`},manifestId:jobId,snapshotDigest:digest,stage:'recorded'} as const;
  const context=()=>localRequestContext(jobId);
  const manifest=UspSnapshotManifestSchema.parse({schemaVersion:'usp/1',id:jobId,digest,scope,capturedAt:new Date().toISOString(),selection:{kind:'targets',pins:[pin]},
    members:[{pin,bodySha256:before,bodyRef:before,authority:'source'}],frame:{horizontal:null,vertical:null,unit:null,transform:null},
    policyVersion:context().policyVersion,accessViewId:context().accessViewId,validAt:null,asOf:null,coverage:{state:'partial',reasonCodes:['protocol_no_registered_target']}});
  const pointer={sourceRevision:pin,assetRevision:null,partRevision:null,locator:{kind:'verbatim',locator:result.native.parts[0]?.locator.label??'original file'},
    legacyLocator:result.native.parts[0]?.locator.label??'original file',purpose:'record',origin:'direct',target:pin.ref} as any;
  // Only historical snapshot/packet metadata queries are protocol doubles. All
  // canonical source/case/job/access queries still use this isolated PostgreSQL.
  const protocolPacket={packetId:jobId,target:pin,scope,format:'text',artifact:{assetId:jobId,version:1,sha256:job.result_ref.sha256},included:[],
    unavailable:[{pointer,reasonCode:'exact_extract_unavailable'}],contentType:'text/plain',createdAt:new Date().toISOString(),status:'incomplete',commandSha256:digest};
  function wrap(client:any){return new Proxy(client,{get(target,key){
    if(key==='query')return (...args:any[])=>{
      const sql=typeof args[0]==='string'?args[0]:args[0]?.text;let rows:any[]|undefined;
      if(sql?.includes('FROM usp_snapshots'))rows=[{body:manifest}];
      else if(sql?.includes('FROM usp_snapshot_bodies'))rows=[{body:historical,body_sha256:before}];
      else if(sql?.includes('FROM usp_packets'))rows=[{body:protocolPacket,object_key:documentResultKey(jobId,job.result_ref.sha256),artifact_hash:job.result_ref.sha256}];
      if(rows){const response={rows,rowCount:rows.length};const callback=args.find(a=>typeof a==='function');if(callback){queueMicrotask(()=>callback(null,response));return;}return Promise.resolve(response);}
      return target.query(...args);
    };
    const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});}
  (db as any).connect=function(callback?:any){
    if(callback)return connect.call(db,(error:any,client:any,release:any)=>callback(error,client?wrap(client):client,release));
    return (connect.call(db) as Promise<any>).then(wrap);
  };
  async function denial(status:number){
    const ctx=context();
    const calls=[()=>transaction(client=>captureDocumentSourceTx(client,historical)),()=>readManifest(ctx,scope),()=>readSnapshotBody(ctx,scope,pin),
      ()=>readSnapshotOriginal(ctx,scope,pin),()=>readRegistryEvidenceBytes(ctx,scope,pointer),()=>readExactPart(ctx,scope,pointer),
      ()=>createPacket0(ctx,{scope,target:pin,evidence:[pointer],format:'text',guard:{mode:'create',requestKey:jobId}} as any),
      ()=>readPacket0(ctx,jobId),()=>exportCityJson(ctx,{scope,targets:[pin],licenceFamily:null,distribution:'private'}),
      ()=>copyCaseDocuments(caseId,{expectedRevision:1,caseId,sourceIds:[sourceId],buildingId:sourceId,reason:'Marked-source authority protocol check'})];
    for(const call of calls)await assert.rejects(call,(error:any)=>error.status===status);
    return calls.length;
  }
  if(phase==='stale'){
    const count=await denial(409);
    console.log(JSON.stringify({status:'passed',phase,gates:count,scope:'Real case revision drift; memory-only snapshot/packet protocol metadata; no legitimate target association claimed'}));
  }else{
    assert.equal(result.native.status,'extracted');assert.equal(result.model.status,'disabled');
    const captured=await transaction(client=>captureDocumentSourceTx(client,historical));assert.deepEqual(captured.inspection.referenceParts,[]);
    assert.equal(fingerprint(historical),before);
    const view=await readSnapshotBody(context(),scope,pin);assert(!view.inspection.referenceParts);assert(!view.inspection.documentOriginal);assert(!view.inspection.documentAccepted);
    const original=await readSnapshotOriginal(context(),scope,pin);assert.equal(sha256(original.bytes),sha256(readFileSync(originalPath)));
    assert(!sourceFrom(historical).inspection?.referenceParts);
    assert.throws(()=>assertDocumentPackageParts({parts:historical.inspection.referenceParts},new Set([sourceId])),(e:any)=>e.code==='DOCUMENT_STAGED_PACKAGE_PARTS');
    const legacyView=documentSnapshotView({...historical,inspection:{referenceParts:historical.inspection.referenceParts}},false);assert.equal(legacyView.inspection.referenceParts.length,result.native.parts.length);
    await assert.rejects(()=>transaction(client=>documentAuthorityTx(client,source,'copy')),(e:any)=>e.code==='DOCUMENT_CANONICAL_COPY_REQUIRED');
    saved=(await db.query('SELECT archived FROM cases WHERE id=$1',[caseId])).rows[0].archived;
    await db.query('UPDATE cases SET archived=true WHERE id=$1',[caseId]);const archive=await denial(403);
    await assert.rejects(()=>new DocumentIngestionService().original(caseId,sourceId),(e:any)=>e.status===403);
    await db.query('UPDATE cases SET archived=$2 WHERE id=$1',[caseId,saved]);saved=undefined;
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='document-authority-denial-control';const actor=await denial(403);
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
    assert.equal(fingerprint(historical),before);
    (db as any).connect=connect;
    const invariants=(await db.query(`SELECT (SELECT count(*)::int FROM registry_records) records,(SELECT count(*)::int FROM physical_features) features,
      (SELECT count(*)::int FROM usp_snapshots) snapshots,(SELECT count(*)::int FROM usp_packets) packets,(SELECT count(*)::int FROM usp_model_calls) model_calls`)).rows[0];
    assert(Object.values(invariants).every(value=>value===0));
    console.log(JSON.stringify({status:'passed',phase,archiveGates:archive,operatorGates:actor,invariants,
      checks:['canonical capture excludes actual historical native mirror','historical snapshot view suppresses parts/private markers','original I/O exact before/after canonical checks',
        'generic source projection and mixed package gate','legacy unmarked view compatible; staged copy blocked'],
      limits:['Protocol metadata is memory-only and uses actual case/source/job IDs; no registered target, packet artifact, geometry or evidence association is claimed',
        'Legitimate target-linked packet/export/copy success remains unqualified']}));
  }
}finally{
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=subject;
  (db as any).connect=connect;
  if(saved!==undefined)await db.query('UPDATE cases SET archived=$2 WHERE id=$1',[caseId,saved]);
  await closePool();
}
