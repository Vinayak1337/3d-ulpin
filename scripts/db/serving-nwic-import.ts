/** Install one retained NWIC administrative source through native authorities. SQL is read-only. */
import {createHash} from 'node:crypto';
import {realpathSync,openSync,readSync,fstatSync,closeSync} from 'node:fs';
import {open,type FileHandle} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import type {Pool,PoolClient} from 'pg';
import {LARGE_ORIGINAL_LIMITS as limits,LargeUploadCreateSchema,LargeUploadFinalizeSchema,LargeUploadStatusSchema,
  PROJECTED_VECTOR_PROFILE as profile,ProjectedVectorRequestSchema,ProjectedVectorStatusSchema,
  AdministrativeObservationPageSchema, type LargeUploadStatus} from '../../packages/contracts/src/usp/index';
import {codePin,connection,hash,loadEnvironment,assertEffectiveEnvironment,target,reserveReceipt,
  requireGuard,toolRoot,toolPath} from './serving-common';

const uuid={parse(value:unknown){requireGuard(typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),'UUID_REQUIRED');return value.toLowerCase();}};
const sourceName='NWIC District Boundary';
const sourceDirectory='fixtures/usp/D3/nwic-boundaries-v1/';
const jsonLimit=4*1024*1024;
const readMetadata=(path:string)=>{
  const fd=openSync(path,'r');
  try{
    const info=fstatSync(fd);requireGuard(info.isFile()&&info.size<=2*1024*1024,'METADATA_FILE_BOUND');
    const bytes=Buffer.alloc(info.size);let offset=0;
    while(offset<bytes.length){const count=readSync(fd,bytes,offset,bytes.length-offset,offset);requireGuard(count>0,'METADATA_FILE_CHANGED');offset+=count;}
    requireGuard(readSync(fd,Buffer.alloc(1),0,1,offset)===0,'METADATA_FILE_CHANGED');return bytes;
  }finally{closeSync(fd);}
};

/** Request identities only, never application/source/administrative identifiers. */
export function operationRequestKey(operationKey:string,stage:string) {
  uuid.parse(operationKey);
  const hex=hash(`serving-nwic/1\n${operationKey.toLowerCase()}\n${stage}`).slice(0,32).split('');
  hex[12]='8';hex[16]=((parseInt(hex[16],16)&3)|8).toString(16);
  const s=hex.join('');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}
export async function inspectOriginal(file:FileHandle) {
  const before=await file.stat();requireGuard(before.isFile()&&before.size===profile.zipBytes,'ORIGINAL_SIZE_CHANGED');
  const full=createHash('sha256'),parts:{partNumber:number;bytes:number;sha256:string}[]=[];
  const chunk=Buffer.alloc(1024*1024),deadline=Date.now()+60000;
  let offset=0,partBytes=0,partHash=createHash('sha256');
  while(offset<before.size){
    requireGuard(Date.now()<deadline,'ORIGINAL_HASH_DEADLINE');
    const read=await file.read(chunk,0,Math.min(chunk.length,before.size-offset),offset);
    requireGuard(read.bytesRead>0,'ORIGINAL_TRUNCATED');const bytes=chunk.subarray(0,read.bytesRead);full.update(bytes);offset+=bytes.length;
    let pos=0;
    while(pos<bytes.length){const count=Math.min(bytes.length-pos,limits.partBytes-partBytes);partHash.update(bytes.subarray(pos,pos+count));pos+=count;partBytes+=count;
      if(partBytes===limits.partBytes){parts.push({partNumber:parts.length+1,bytes:partBytes,sha256:partHash.digest('hex')});partHash=createHash('sha256');partBytes=0;}}
  }
  if(partBytes)parts.push({partNumber:parts.length+1,bytes:partBytes,sha256:partHash.digest('hex')});
  const after=await file.stat();
  requireGuard(after.ino===before.ino&&after.dev===before.dev&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs,
    'ORIGINAL_CHANGED_DURING_HASH');
  requireGuard(full.digest('hex')===profile.zipSha256,'ORIGINAL_HASH_CHANGED');
  return {bytes:offset,sha256:profile.zipSha256,parts,fileIdentity:{ino:before.ino,dev:before.dev,mtimeMs:before.mtimeMs,ctimeMs:before.ctimeMs}};
}
export async function consumeResponse(response:Response,maxBytes:number,buffer=true,readMs=30000) {
  requireGuard(response.body,'API_BODY_REQUIRED');
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes)){await response.body.cancel();requireGuard(false,'API_RESPONSE_BOUND');}
  const reader=response.body.getReader(),digest=createHash('sha256'),chunks:Uint8Array[]=[];
  const abort=AbortSignal.timeout(readMs),cancel=()=>{void reader.cancel().catch(()=>{});};abort.addEventListener('abort',cancel,{once:true});
  let bytes=0;
  try {
    while(true){requireGuard(!abort.aborted,'API_READ_TIMEOUT');const item=await reader.read();requireGuard(!abort.aborted,'API_READ_TIMEOUT');if(item.done)break;
      bytes+=item.value.length;if(bytes>maxBytes){await reader.cancel();requireGuard(false,'API_RESPONSE_BOUND');}
      digest.update(item.value);if(buffer)chunks.push(item.value);}
    requireGuard(declared===null||Number(declared)===bytes,'API_RESPONSE_LENGTH_CHANGED');
    return {bytes,sha256:digest.digest('hex'),body:buffer?Buffer.concat(chunks,bytes):null};
  } finally {abort.removeEventListener('abort',cancel);reader.releaseLock();}
}
class Pending extends Error {code='NATIVE_OPERATION_PENDING';}

async function main() {
  const args=process.argv.slice(2),opts=new Map<string,string>();
  while(args.length){const key=args.shift()!,value=args.shift();requireGuard(key.startsWith('--')&&value&&!value.startsWith('--')&&!opts.has(key),'INVALID_ARGUMENTS');opts.set(key.slice(2),value);}
  const allowed=['operation-key','out','expect-code','verified-api-code','verified-api-operator','environment-file','api','expect-target','expect-manifest','poll-seconds','original'];
  requireGuard([...opts.keys()].every(key=>allowed.includes(key)),'UNKNOWN_ARGUMENT');
  const get=(key:string)=>{const value=opts.get(key);requireGuard(value,`REQUIRED_${key.toUpperCase().replaceAll('-','_')}`);return value;};
  const operationKey=uuid.parse(get('operation-key')).toLowerCase();
  const receipt:Record<string,any>={version:'serving-nwic-import/1',status:'running',codeCommit:codePin(),operationKey,
    startedAt:new Date().toISOString(),mutationAttempted:false,purpose:'administrative_context',geography:'India',
    qualification:'Deterministic administrative context only; boundary accuracy/currentness, parcel/building/height/rights, tiles and scale remain unqualified.'};
  const durable=reserveReceipt(get('out'),receipt);let p:Pool|undefined,client:PoolClient|undefined,file:FileHandle|undefined;
  const checkpoint=(phase:string,value:Record<string,unknown>={})=>{receipt.phase=phase;Object.assign(receipt,value);durable.update(receipt);};
  try {
    requireGuard(!execFileSync('git',['status','--porcelain'],{cwd:toolRoot,encoding:'utf8',timeout:5000}).trim(),'CLEAN_PINNED_CHECKOUT_REQUIRED');
    requireGuard(codePin()===get('expect-code')&&get('verified-api-code')===codePin(),'VERIFIED_CODE_PIN_REQUIRED');
    const operator=get('verified-api-operator');requireGuard(operator.trim()===operator&&operator.length<=256&&!/[\x00-\x1f\x7f]/.test(operator)&&operator!=='local-demo-operator','VERIFIED_OPERATOR_REQUIRED');
    const env=loadEnvironment(get('environment-file'));receipt.envHash=env.envHash;receipt.resourceBindingHash=await assertEffectiveEnvironment(env);
    requireGuard(!env.env.ULPIN_LOCAL_OPERATOR_SUBJECT||env.env.ULPIN_LOCAL_OPERATOR_SUBJECT===operator,'OPERATOR_ENV_MISMATCH');
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=operator;
    const {fingerprint}=await import('@ulpin/server/modules/cases/domain');
    receipt.launch={codeCommit:codePin(),operatorSubject:operator,basis:'caller_verified_same_api_launch',limitation:'Health attests target/manifest, not loaded process code or human authentication.'};
    const api=new URL(get('api'));requireGuard(api.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(api.hostname)&&!api.username&&!api.password&&!api.search&&!api.hash&&api.pathname==='/api/v1','EXACT_LOOPBACK_API_REQUIRED');
    const pollSeconds=Number(opts.get('poll-seconds')??120);requireGuard(Number.isInteger(pollSeconds)&&pollSeconds>=0&&pollSeconds<=180,'POLL_BOUND_INVALID');
    // Whole invocation remains finite, including hashing, byte receipt, publication and verification.
    const invocationDeadline=Date.now()+10*60*1000;
    const remaining=()=>{const n=invocationDeadline-Date.now();requireGuard(n>0,'INVOCATION_DEADLINE');return n;};
    const request=async(path:string,init:RequestInit={},timeout=30000)=>{
      requireGuard(path.startsWith('/')&&!path.includes('..'),'API_PATH_INVALID');
      return fetch(api.href+path,{...init,redirect:'error',signal:AbortSignal.timeout(Math.min(timeout,remaining()))});};
    const json=async(path:string,init:RequestInit={},timeout=30000)=>{
      const response=await request(path,init,timeout),data=await consumeResponse(response,jsonLimit,true,Math.min(timeout,remaining()));
      if(!response.ok){let code='API_ERROR';try{const value=JSON.parse(data.body!.toString('utf8'));if(/^[A-Z0-9_]+$/.test(value.error?.code))code=value.error.code;}catch{}
        throw Object.assign(new Error(code),{code,httpStatus:response.status});}
      return JSON.parse(data.body!.toString('utf8'));
    };
    const post=async(path:string,body:unknown,timeout=30000)=>{
      checkpoint('native_request_intent',{mutationAttempted:true,lastRequest:{path,method:'POST',body,bodySha256:hash(JSON.stringify(body)),nativeFingerprint:fingerprint(body)}});
      return json(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},timeout);
    };
    p=connection(env.env.DATABASE_URL,true);p.on('error',()=>{});client=await p.connect();
    requireGuard((await target(client,env.endpoint)).token===get('expect-target'),'LIVE_TARGET_CHANGED');
    const health=await json('/health');requireGuard(health.ok===true&&health.databaseReadiness?.schema?.ready===true&&
      health.databaseReadiness.schema.targetToken===get('expect-target')&&health.databaseReadiness.schema.manifestSha256===get('expect-manifest'),'API_TARGET_SCHEMA_OR_HEALTH_MISMATCH');
    const {schemaRequirements}=await import('@ulpin/server/infrastructure/database-readiness');
    requireGuard(schemaRequirements().manifestSha256===get('expect-manifest'),'TOOL_MANIFEST_CHANGED');
    receipt.targetToken=get('expect-target');receipt.manifestSha256=get('expect-manifest');receipt.api=api.href;
    const sourceCheckBytes=readMetadata(toolPath('docs/evidence/usp/nest-migration/nwic-boundaries/source-check.json'));
    const sourceCheck=JSON.parse(sourceCheckBytes.toString('utf8'));
    const manifestBytes=readMetadata(toolPath(sourceDirectory+'manifest.json')),manifest=JSON.parse(manifestBytes.toString('utf8'));
    const profileBytes=readMetadata(toolPath(sourceDirectory+'vector-admission-profile.json')),admission=JSON.parse(profileBytes.toString('utf8'));
    const originalAsset=manifest.assets.find((a:any)=>a.id==='nwic-district-boundaries-original');
    requireGuard(sourceCheck.acquisition.sha256===profile.zipSha256&&sourceCheck.acquisition.bytes===profile.zipBytes&&
      originalAsset?.provenance.original.sha256===profile.zipSha256&&originalAsset.provenance.original.bytes===profile.zipBytes&&originalAsset.permission.state==='documented'&&
      admission.source.sha256===profile.memberSha256&&admission.source.bytes===profile.memberBytes,'RETAINED_PROFILE_PIN_CHANGED');
    const path=realpathSync(opts.get('original')??sourceCheck.acquisition.privateOriginalPath);
    requireGuard(path===realpathSync(sourceCheck.acquisition.privateOriginalPath)&&!path.startsWith(toolRoot+'/'),'EXACT_PRIVATE_ORIGINAL_REQUIRED');
    file=await open(path,'r');const original=await inspectOriginal(file);
    const parserSha256=hash(readMetadata(toolPath('services/geo/geo/projected_vector.py')));
    receipt.source={bytes:original.bytes,sha256:original.sha256,memberSha256:profile.memberSha256,manifestSha256:hash(manifestBytes),
      admissionProfileSha256:hash(profileBytes),sourceCheckSha256:hash(sourceCheckBytes),issuer:sourceCheck.source.issuer,
      originalUrl:sourceCheck.acquisition.finalUrl,acquiredAt:new Date(sourceCheck.acquisition.acquiredAtUtc).toISOString(),
      permissionReference:sourceCheck.termsDecision.termsUrl,parserSha256};
    const liveLimits=await json('/ingestion/upload-limits');requireGuard(isDeepStrictEqual(liveLimits.limits,limits),'NATIVE_UPLOAD_LIMITS_CHANGED');
    const caseKey=operationRequestKey(operationKey,'source-case'),uploadKey=operationRequestKey(operationKey,'upload'),projectedKey=operationRequestKey(operationKey,'projected');
    receipt.requestKeys={case:caseKey,upload:uploadKey,finalize:operationRequestKey(operationKey,'finalize'),projected:projectedKey};
    const knownUploads=(await client.query(`SELECT id,case_id,request_key,operator_subject,state,request_hash,
      body#>>'{input,expectedCaseRevision}' AS initial_case_revision FROM usp_source_uploads WHERE body#>>'{input,sha256}'=$1 LIMIT 3`,[profile.zipSha256])).rows;
    requireGuard(knownUploads.length<=1&&knownUploads.every(u=>u.request_key===uploadKey&&u.operator_subject===operator),'EXISTING_NWIC_DIFFERENT_OR_AMBIGUOUS_INTENT');
    const cases=(await client.query("SELECT case_id,payload_hash FROM operations WHERE operation_key=$1 AND kind='source-case' LIMIT 2",[`source-case:${caseKey}`])).rows;
    requireGuard(cases.length<=1&&(!knownUploads.length||cases.length===1&&cases[0].case_id===knownUploads[0].case_id),'CASE_INTENT_AMBIGUOUS');
    const knownSources=(await client.query("SELECT id,case_id FROM sources WHERE sha256=$1 LIMIT 2",[profile.zipSha256])).rows;
    requireGuard(knownSources.length<=1&&knownSources.every(s=>knownUploads.length===1&&s.case_id===knownUploads[0].case_id),'EXISTING_NWIC_SOURCE_DIFFERENT_OR_AMBIGUOUS_INTENT');
    const caseBody={requestKey:caseKey,name:sourceName};requireGuard(!cases.length||cases[0].payload_hash===fingerprint(caseBody),'CASE_REQUEST_PIN_CHANGED');
    const caseId=uuid.parse(cases[0]?.case_id??(await post('/source-cases',caseBody)).caseId);
    receipt.caseId=caseId;checkpoint('source_case_confirmed');
    const confirmedCases=(await client.query("SELECT case_id,payload_hash FROM operations WHERE operation_key=$1 AND kind='source-case' LIMIT 2",[`source-case:${caseKey}`])).rows;
    requireGuard(confirmedCases.length===1&&confirmedCases[0].case_id===caseId&&confirmedCases[0].payload_hash===fingerprint(caseBody),'CASE_AUTHORITY_MISMATCH');
    const caseRow=(await client.query('SELECT revision,archived FROM cases WHERE id=$1',[caseId])).rows[0];requireGuard(caseRow&&!caseRow.archived,'CASE_UNAVAILABLE');
    const uploadBody=LargeUploadCreateSchema.parse({requestKey:uploadKey,
      expectedCaseRevision:knownUploads.length?Number(knownUploads[0].initial_case_revision):caseRow.revision,
      filename:'district_nwic_geojson.zip',mediaType:'application/zip',bytes:profile.zipBytes,sha256:profile.zipSha256,
      provenance:{issuer:sourceCheck.source.issuer,originalUrl:sourceCheck.acquisition.finalUrl,acquiredAt:new Date(sourceCheck.acquisition.acquiredAtUtc).toISOString(),
        permissionReference:sourceCheck.termsDecision.termsUrl,limitations:['Official administrative context only; boundary accuracy/currentness and training permission remain unqualified; no parcel, building, ownership or height inference.']}});
    requireGuard(!knownUploads.length||knownUploads[0].request_hash===fingerprint(uploadBody),'UPLOAD_REQUEST_PIN_CHANGED');
    let upload=LargeUploadStatusSchema.parse(knownUploads.length?await json(`/ingestion/cases/${caseId}/uploads/${knownUploads[0].id}`):await post(`/ingestion/cases/${caseId}/uploads`,uploadBody));
    const uploadId=upload.id,uploadPath=`/ingestion/cases/${caseId}/uploads/${uploadId}`;
    const uploadAuthority=(await client.query('SELECT request_key,request_hash,operator_subject,source_id FROM usp_source_uploads WHERE id=$1 AND case_id=$2',[uploadId,caseId])).rows[0];
    requireGuard(uploadAuthority&&uploadAuthority.request_key===uploadKey&&uploadAuthority.request_hash===fingerprint(uploadBody)&&uploadAuthority.operator_subject===operator,'UPLOAD_AUTHORITY_MISMATCH');
    const checkUpload=(u:LargeUploadStatus)=>{requireGuard(u.id===uploadId&&u.caseId===caseId&&u.operatorSubject===operator&&u.filename===uploadBody.filename&&u.mediaType===uploadBody.mediaType&&u.bytes===profile.zipBytes&&u.declaredSha256===profile.zipSha256&&u.partCount===original.parts.length,'UPLOAD_SCOPE_OR_SOURCE_CHANGED');
      requireGuard(new Set(u.parts.map(p=>p.partNumber)).size===u.parts.length&&u.parts.every(p=>{const expected=original.parts[p.partNumber-1];
        return expected&&p.requestKey===operationRequestKey(operationKey,`part:${p.partNumber}`)&&p.sha256===expected.sha256&&p.bytes===expected.bytes;}),'PART_IMMUTABLE_BINDING_CHANGED');
      receipt.uploadState=u.state;receipt.uploadRevision=u.revision;receipt.currentCaseRevision=u.currentCaseRevision;return u;};
    checkUpload(upload);receipt.uploadId=upload.id;receipt.uploadCreateBody=uploadBody;checkpoint('upload_confirmed');
    requireGuard(upload.state!=='aborted'&&upload.state!=='aborting','UPLOAD_TERMINAL_REVIEW_REQUIRED');
    if(upload.state==='receiving'){
      requireGuard(upload.pinnedCaseRevision===upload.currentCaseRevision,'UPLOAD_CASE_CONTEXT_CHANGED');
      for(const part of original.parts){
        const requestKey=operationRequestKey(operationKey,`part:${part.partNumber}`),prior=upload.parts.find(p=>p.partNumber===part.partNumber);
        requireGuard(!prior||prior.requestKey===requestKey&&prior.sha256===part.sha256&&prior.bytes===part.bytes,'PART_IMMUTABLE_BINDING_CHANGED');
        if(prior?.state==='received')continue;
        if(prior?.state==='writing'&&prior.leaseExpiresAt&&Date.parse(prior.leaseExpiresAt)>Date.now())throw new Pending('Part is still active; replay the same operation after status advances.');
        const bytes=Buffer.alloc(part.bytes);let offset=0;
        while(offset<bytes.length){remaining();const got=await file.read(bytes,offset,bytes.length-offset,(part.partNumber-1)*limits.partBytes+offset);requireGuard(got.bytesRead>0,'ORIGINAL_TRUNCATED');offset+=got.bytesRead;}
        requireGuard(hash(bytes)===part.sha256,'ORIGINAL_PART_CHANGED');
        const headers={'Content-Type':'application/octet-stream','X-Request-Key':requestKey,'X-Upload-Revision':String(upload.revision),
          'X-Case-Revision':String(upload.currentCaseRevision),'X-Part-Sha256':part.sha256};
        checkpoint('part_request_intent',{mutationAttempted:true,lastRequest:{path:uploadPath+`/parts/${part.partNumber}`,method:'PUT',
          requestKey,expectedRevision:upload.revision,expectedCaseRevision:upload.currentCaseRevision,sha256:part.sha256,bytes:part.bytes}});
        upload=checkUpload(LargeUploadStatusSchema.parse(await json(uploadPath+`/parts/${part.partNumber}`,{method:'PUT',headers,body:bytes},35000)));
        checkpoint('part_confirmed',{receivedBytes:upload.receivedBytes});
      }
    }
    if(upload.state==='finalizing'){
      const lease=(await client.query('SELECT lease_expires_at FROM usp_source_uploads WHERE id=$1 AND case_id=$2',[upload.id,caseId])).rows[0];
      if(!lease||!lease.lease_expires_at||new Date(lease.lease_expires_at).getTime()>Date.now())throw new Pending('Finalization is still active; rerun the same operation.');
      // Ordinary native lease-expiry recovery, never a direct lease change or test control.
    }
    if(upload.state!=='retained'){
      const finalizeBody=LargeUploadFinalizeSchema.parse({requestKey:receipt.requestKeys.finalize,expectedRevision:upload.revision,
        expectedCaseRevision:upload.currentCaseRevision,sha256:profile.zipSha256});
      upload=checkUpload(LargeUploadStatusSchema.parse(await post(uploadPath+'/finalize',finalizeBody,125000)));
    }
    requireGuard(upload.state==='retained'&&upload.verifiedSha256===profile.zipSha256&&upload.source?.sha256===profile.zipSha256&&upload.source.bytes===profile.zipBytes,'ORIGINAL_NOT_RETAINED');
    const retainedSource=upload.source!;
    const sourceId=uuid.parse(retainedSource.sourceId);receipt.sourceId=sourceId;receipt.sourceRevision=retainedSource.sourceRevision;checkpoint('original_retained');
    requireGuard(sourceId===uploadAuthority.source_id&&knownSources.every(s=>s.id===sourceId),'RETAINED_SOURCE_ID_CHANGED');
    const source=(await client.query(`SELECT s.revision,s.sha256,s.bytes,s.family_id,s.object_key,s.profile,s.inspection#>>'{largeOriginal,operatorSubject}' AS operator_subject,
      s.inspection#>>'{projectedVector,currentJobId}' AS current_job_id,c.revision AS case_revision FROM sources s JOIN cases c ON c.id=s.case_id WHERE s.id=$1 AND s.case_id=$2`,[sourceId,caseId])).rows[0];
    requireGuard(source&&source.profile==='large-original-v1'&&source.operator_subject===operator&&source.sha256===profile.zipSha256&&Number(source.bytes)===profile.zipBytes&&source.revision===retainedSource.sourceRevision,'RETAINED_SOURCE_CONTEXT_CHANGED');
    const latest=(await client.query('SELECT max(revision)::int AS revision FROM sources WHERE case_id=$1 AND family_id=$2',[caseId,source.family_id])).rows[0];
    requireGuard(latest.revision===source.revision,'RETAINED_SOURCE_SUPERSEDED');
    const requests=(await client.query("SELECT result->>'jobId' AS job_id,payload_hash FROM operations WHERE case_id=$1 AND operation_key=$2 AND kind='projected-vector' LIMIT 2",[caseId,`projected-vector:${projectedKey}`])).rows;
    requireGuard(requests.length<=1&&(!source.current_job_id||requests.length===1&&requests[0].job_id===source.current_job_id),'EXISTING_PROJECTED_JOB_DIFFERENT_INTENT');
    const job=requests.length?(await client.query("SELECT id,status,payload FROM jobs WHERE id=$1 AND case_id=$2 AND source_id=$3 AND operation='projected-vector'",[requests[0].job_id,caseId,sourceId])).rows[0]:null;
    const {ingestionBinding}=await import('@ulpin/server/modules/usp/ingestion/events');
    const access=ingestionBinding(caseId).access;
    requireGuard(!requests.length||job&&job.payload.parserSha256===parserSha256&&job.payload.accessBinding===access&&job.payload.sourceRevision===source.revision&&job.payload.sha256===profile.zipSha256&&
      job.payload.caseId===caseId&&job.payload.sourceId===sourceId&&job.payload.sourceFamilyId===source.family_id&&job.payload.objectKey===source.object_key,'PROJECTED_JOB_PIN_CHANGED');
    const projectedBody=ProjectedVectorRequestSchema.parse({requestKey:projectedKey,expectedCaseRevision:job?job.payload.caseRevision:source.case_revision,
      expectedSourceRevision:source.revision,sourceSha256:profile.zipSha256});
    requireGuard(!requests.length||requests[0].payload_hash===fingerprint({caseId,sourceId,request:projectedBody,access,parserSha256}),'PROJECTED_REQUEST_PIN_CHANGED');
    const projectedPath=`/ingestion/cases/${caseId}/sources/${sourceId}/projected-vector`;
    let status=ProjectedVectorStatusSchema.parse(await post(projectedPath,projectedBody));
    requireGuard(!job||status.jobId===job.id,'PROJECTED_REPLAY_CHANGED_JOB');receipt.jobId=status.jobId;receipt.projectedBody=projectedBody;checkpoint('projected_job_confirmed');
    const pollDeadline=Date.now()+pollSeconds*1000;
    while(['queued','running'].includes(status.status)&&Date.now()<pollDeadline){
      await new Promise(resolve=>setTimeout(resolve,Math.min(2000,pollDeadline-Date.now())));
      status=ProjectedVectorStatusSchema.parse(await json(projectedPath));requireGuard(status.jobId===receipt.jobId,'PROJECTED_CURRENT_JOB_CHANGED');
    }
    requireGuard(status.caseId===caseId&&status.sourceId===sourceId&&status.sourceRevision===source.revision&&status.sourceSha256===profile.zipSha256,'PROJECTED_STATUS_SCOPE_CHANGED');
    receipt.projectedStatus=status.status;receipt.errorCode=status.errorCode;
    if(['queued','running'].includes(status.status))throw new Pending('Keep this operation key and rerun; no replacement job is admitted.');
    requireGuard(status.status==='succeeded','PROJECTED_FAILED_OR_STALE_REVIEW_REQUIRED');
    requireGuard(status.totals?.admitted===720&&status.totals.quarantined===13&&status.transform?.parserSha256===parserSha256&&
      status.transform.projDatabaseSha256===admission.runtime.projDatabase.sha256&&status.transform.definition===admission.crsDiagnostic.operation.definition,'PROJECTED_DISPOSITION_OR_TRANSFORM_MISMATCH');
    receipt.totals=status.totals;receipt.transform=status.transform;
    const ids=new Set<string>();let cursor=0,admitted=0,quarantined=0,pages=0,sample:any=null,quarantine:any=null;
    do {
      requireGuard(pages++<30,'METADATA_PAGE_BOUND');
      const page=AdministrativeObservationPageSchema.parse(await json(projectedPath+`/units?limit=25&cursor=${cursor}&jobId=${status.jobId}`));
      requireGuard(page.jobId===status.jobId&&page.records.length>0,'METADATA_GENERATION_CHANGED');
      for(const row of page.records){requireGuard(!ids.has(row.id)&&row.sourceId===sourceId&&row.sourceRevision===source.revision&&row.jobId===status.jobId,'METADATA_IDENTITY_MISMATCH');ids.add(row.id);
        if(row.disposition==='admitted'){admitted++;sample??=row;}else{quarantined++;quarantine??=row;}}
      if(page.next!==null)requireGuard(page.next>cursor&&page.next<=733,'METADATA_CURSOR_INVALID');cursor=page.next??733;
      if(page.next===null)break;
    }while(true);
    requireGuard(ids.size===733&&admitted===720&&quarantined===13&&sample&&quarantine,'METADATA_DISPOSITIONS_MISMATCH');
    const geometry=async(row:any,representation:'native'|'geographic')=>{
      const response=await request(projectedPath+`/units/${row.id}/geometry?jobId=${status.jobId}&representation=${representation}`,{},15000);
      const value=await consumeResponse(response,representation==='native'?profile.featureBytes:profile.geographicBytes,true,15000);
      requireGuard(response.status===200&&response.headers.get('cache-control')==='private, no-store'&&value.sha256===response.headers.get('x-content-sha256')&&
        value.sha256===(representation==='native'?row.rawSha256:row.geographicSha256)&&response.headers.get('x-source-crs')==='EPSG:7755'&&
        response.headers.get('x-target-crs')===(representation==='native'?'EPSG:7755':'EPSG:4326')&&
        response.headers.get('content-type')?.split(';')[0]===(representation==='native'?'application/json':'application/geo+json'),'GEOMETRY_HASH_FRAME_OR_PRIVACY_MISMATCH');
      return JSON.parse(value.body!.toString('utf8'));
    };
    const native=await geometry(sample,'native'),geographic=await geometry(sample,'geographic');await geometry(quarantine,'native');
    requireGuard(native.type==='Feature'&&geographic.type==='Feature'&&native.properties&&geographic.properties&&isDeepStrictEqual(native.properties,geographic.properties)&&
      native.geometry?.type==='MultiPolygon'&&geographic.geometry?.type==='MultiPolygon','GEOGRAPHIC_PROPERTIES_CHANGED');
    const deniedQuarantine=await request(projectedPath+`/units/${quarantine.id}/geometry?jobId=${status.jobId}&representation=geographic`);
    const quarantineError=await consumeResponse(deniedQuarantine,jsonLimit);requireGuard(deniedQuarantine.status===422&&JSON.parse(quarantineError.body!.toString('utf8')).error?.code==='PROJECTED_QUARANTINE','QUARANTINE_GEOGRAPHIC_READ_NOT_DENIED');
    const download=await request(`/sources/${sourceId}/file`,{},125000),downloaded=await consumeResponse(download,profile.zipBytes,false,125000);
    requireGuard(download.status===200&&downloaded.bytes===profile.zipBytes&&downloaded.sha256===profile.zipSha256&&
      download.headers.get('cache-control')==='private, max-age=60'&&download.headers.get('x-content-type-options')==='nosniff'&&
      download.headers.get('x-source-sha256')===profile.zipSha256&&download.headers.get('content-length')===String(profile.zipBytes)&&
      download.headers.get('content-type')?.split(';')[0]==='application/zip'&&
      download.headers.get('x-source-integrity')==='recomputed-before-response; conditional-sealed-read; checked-at-stream-end','ORIGINAL_DOWNLOAD_INTEGRITY_OR_PRIVACY_MISMATCH');
    const denied=await request(projectedPath+'/units?limit=1',{headers:{Origin:new URL(sourceCheck.source.resourceUrl).origin}},10000);
    await consumeResponse(denied,jsonLimit,true,10000);requireGuard(denied.status===403,'REMOTE_ORIGIN_READ_NOT_DENIED');
    const deniedOriginal=await request(`/sources/${sourceId}/file`,{headers:{Origin:new URL(sourceCheck.source.resourceUrl).origin}},10000);
    await consumeResponse(deniedOriginal,jsonLimit,true,10000);requireGuard(deniedOriginal.status===403,'REMOTE_ORIGIN_ORIGINAL_NOT_DENIED');
    const counts=(await client.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE disposition='admitted')::int AS admitted,
      count(*) FILTER(WHERE disposition='quarantined')::int AS quarantined FROM administrative_unit_observations WHERE job_id=$1 AND source_id=$2`,[status.jobId,sourceId])).rows[0];
    requireGuard(counts.total===733&&counts.admitted===720&&counts.quarantined===13,'DATABASE_ADOPTION_MISMATCH');
    const finalFile=await file.stat();requireGuard(finalFile.ino===original.fileIdentity.ino&&finalFile.dev===original.fileIdentity.dev&&finalFile.size===original.bytes&&
      finalFile.mtimeMs===original.fileIdentity.mtimeMs&&finalFile.ctimeMs===original.fileIdentity.ctimeMs,'ORIGINAL_CHANGED_DURING_INSTALL');
    receipt.read={metadataPages:pages,dispositions:counts,originalHashPreserved:true,privateGeometry:true,quarantineExcluded:true,remoteOriginDenied:true,
      statusUrl:api.href+projectedPath,unitsUrl:api.href+projectedPath+'/units?limit=25&jobId='+status.jobId,originalUrl:api.href+`/sources/${sourceId}/file`,
      admittedUnitId:sample.id,quarantinedUnitId:quarantine.id,geographicUrl:api.href+projectedPath+`/units/${sample.id}/geometry?jobId=${status.jobId}&representation=geographic`};
    receipt.replay={case:cases.length===1,upload:knownUploads.length===1,job:requests.length===1};receipt.status='passed';
  } catch(error) {
    receipt.status=error instanceof Pending?'pending':'failed';const code=(error as {code?:string}).code;
    receipt.errorCode=code&&/^[A-Z0-9_]+$/.test(code)?code:'NATIVE_INSTALL_VERIFICATION_FAILED';
    receipt.httpStatus=(error as {httpStatus?:number}).httpStatus;
    receipt.recovery='Preserve this receipt/journal and operation-key. Rerun identical source/actor intent with a new --out; native receipts recover the same case/upload/source/job. Failed/stale/aborted or changed context requires lead review, never reset, a new operation key, re-upload or replacement job.';
    process.exitCode=error instanceof Pending?2:1;
  } finally {
    await file?.close().catch(()=>{receipt.cleanup='original_close_failed';});client?.release();await p?.end().catch(()=>{receipt.cleanup='pool_close_failed';});
    receipt.completedAt=new Date().toISOString();try{durable.update(receipt);}finally{durable.close();}
    console.log(JSON.stringify({status:receipt.status,receipt:durable.output,operationKey,errorCode:receipt.errorCode,
      caseId:receipt.caseId,uploadId:receipt.uploadId,sourceId:receipt.sourceId,jobId:receipt.jobId,mutationAttempted:receipt.mutationAttempted}));
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
  try{await main();}catch(error){const code=(error as {code?:string}).code;console.error(code&&/^[A-Z0-9_]+$/.test(code)?code:'SERVING_NWIC_RECEIPT_UNCERTAIN');process.exitCode=1;}
}
