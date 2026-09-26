/** One guarded byte-receipt journey using the retained unchanged official NWIC ZIP. */
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createReadStream,existsSync,readFileSync,writeFileSync,realpathSync } from 'node:fs';
import { open,stat } from 'node:fs/promises';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertUspIsolation,assertLocalOperatorProcess } from './local-isolation.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const safeEnv=Object.fromEntries(['HOME','PATH','USER','LOGNAME','TMPDIR','SHELL','LANG'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
const git=args=>execFileSync('git',args,{cwd:root,env:safeEnv,encoding:'utf8',timeout:5000}).trim();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireApi=createRequire(join(root,'apps/api/package.json'));
const {Pool}=requireApi('pg');
const {S3Client,HeadObjectCommand,ListMultipartUploadsCommand}=requireApi('@aws-sdk/client-s3');
async function run(){
  const dir=realpathSync(process.argv[2]||'');assert(dir.startsWith(realpathSync(join(root,'.runtime/run01'))+'/'));
  const env=JSON.parse(readFileSync(join(dir,'run.env.json'),'utf8')),ownership=JSON.parse(readFileSync(join(dir,'ownership.json'),'utf8'));
  let scope,operator;try{scope=assertUspIsolation(env);operator=assertLocalOperatorProcess(env);}catch{throw new Error('Private isolation validation failed.');}
  assert.equal(env.ULPIN_ISOLATION_PROFILE,'local-nest');assert.equal(ownership.checkout,root);assert.equal(ownership.project,scope.project);
  assert.equal(ownership.nonce,env.ULPIN_LOCAL_NONCE);assert.deepEqual(ownership.operatorProvenance,operator);
  assert.equal(git(['rev-parse','HEAD']),ownership.baseCommit);assert.equal(git(['status','--porcelain','--untracked-files=no']),'');assert(!existsSync(join(root,'.env')));
  const output=join(dir,'large-original-smoke.json');assert(!existsSync(output),'Use a fresh nonce; this receipt already exists.');
  const sourceCheck=JSON.parse(readFileSync(join(root,'docs/evidence/usp/nest-migration/nwic-boundaries/source-check.json'),'utf8'));
  const source=sourceCheck.acquisition,original=source.privateOriginalPath;
  assert.equal((await stat(original)).size,source.bytes);
  const beforeHash=createHash('sha256');for await(const chunk of createReadStream(original,{highWaterMark:1024*1024}))beforeHash.update(chunk);
  assert.equal(beforeHash.digest('hex'),source.sha256);
  const base=env.ULPIN_TEST_URL+'api/v1',receipt={version:'large-original-smoke/1',status:'running',codeCommit:ownership.baseCommit,project:scope.project,nonce:ownership.nonce,operatorProvenance:operator,
    source:{path:original,bytes:source.bytes,sha256:source.sha256,issuer:sourceCheck.source.issuer,url:source.finalUrl,acquiredAt:source.acquiredAtUtc,terms:sourceCheck.termsDecision.localDeterministicTesting,geography:'India',purpose:'test_only'},checks:[],
    notQualified:['Archive expansion/member parsing or companion completeness','CRS conversion, semantic geometry, ownership or property facts','Model approval, learning, placement or public publication','Scale/performance and GF release gates']};
  const pool=new Pool({connectionString:env.DATABASE_URL}),s3=new S3Client({endpoint:env.S3_ENDPOINT,region:env.S3_REGION,forcePathStyle:true,credentials:{accessKeyId:env.S3_ACCESS_KEY,secretAccessKey:env.S3_SECRET_KEY}});
  let phase='limits',file;
  async function call(path,status=200,body,headers={}){
    const response=await fetch(base+path,{...(body?{method:'POST',body:body instanceof FormData?body:JSON.stringify(body)}:{}),headers:{...(body && !(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},signal:AbortSignal.timeout(150000)});
    const value=await response.json();assert.equal(response.status,status,`${phase} ${path}: ${value.error?.code||response.status}`);return value;
  }
  const guard=upload=>({requestKey:randomUUID(),expectedRevision:upload.revision,expectedCaseRevision:upload.currentCaseRevision});
  const uploadPath=upload=>`/ingestion/cases/${upload.caseId}/uploads/${upload.id}`;
  const createInput=(caseRevision,sha256=source.sha256)=>({requestKey:randomUUID(),expectedCaseRevision:caseRevision,filename:'district_nwic_geojson.zip',mediaType:'application/zip',bytes:source.bytes,sha256,
    provenance:{issuer:sourceCheck.source.issuer,originalUrl:source.finalUrl,acquiredAt:new Date(source.acquiredAtUtc).toISOString(),permissionReference:sourceCheck.termsDecision.termsUrl,
      limitations:['Conditional deterministic test-only use; training permission unconfirmed','Single opaque original; archive member and companion completeness not assessed','Source inspection reported EPSG:7755; no semantic conversion performed']}});
  async function part(upload,number,replay){
    const offset=(number-1)*receipt.limits.partBytes,bytes=Buffer.alloc(Math.min(receipt.limits.partBytes,source.bytes-offset));
    const result=await file.read(bytes,0,bytes.length,offset);assert.equal(result.bytesRead,bytes.length);
    const input=replay??{...guard(upload),sha256:hash(bytes)};
    const response=await fetch(base+uploadPath(upload)+`/parts/${number}`,{method:'PUT',headers:{'Content-Type':'application/octet-stream','X-Request-Key':input.requestKey,'X-Upload-Revision':String(input.expectedRevision),'X-Case-Revision':String(input.expectedCaseRevision),'X-Part-Sha256':input.sha256},body:bytes,signal:AbortSignal.timeout(45000)});
    const value=await response.json();assert.equal(response.status,200,`${phase} part ${number}: ${value.error?.code||response.status}`);return {value,input};
  }
  async function missing(key){try{await s3.send(new HeadObjectCommand({Bucket:scope.bucket,Key:key}),{abortSignal:AbortSignal.timeout(5000)});return false;}catch(error){if(error.$metadata?.httpStatusCode===404)return true;throw error;}}
  try{
    const limits=await call('/ingestion/upload-limits');receipt.limits=limits.limits;assert.equal(limits.conversion,'unsupported');assert(source.bytes>64*1024*1024 && source.bytes<=receipt.limits.maxOriginalBytes);
    assert.equal(receipt.limits.partBytes,8*1024*1024);assert.equal(Math.ceil(source.bytes/receipt.limits.partBytes),9);
    await call('/ingestion/upload-limits',403,undefined,{'Sec-Fetch-Site':'cross-site'});
    const caseResult=await call('/source-cases',201,{requestKey:randomUUID(),name:'NWIC District Boundary opaque original receipt'});
    const caseId=caseResult.caseId;receipt.caseId=caseId;
    const other=await call('/source-cases',201,{requestKey:randomUUID(),name:'Official NYC compatibility source receipt'});receipt.otherCaseId=other.caseId;
    phase='admit';const admitted=createInput(0);let main=await call(`/ingestion/cases/${caseId}/uploads`,201,admitted);
    assert.deepEqual(await call(`/ingestion/cases/${caseId}/uploads`,201,admitted),main);
    await call(`/ingestion/cases/${caseId}/uploads`,409,{...admitted,filename:'changed.zip'});
    await call(`/ingestion/cases/${caseId}/uploads`,422,{...createInput(0),objectKey:'caller-key'});
    await call(`/ingestion/cases/${caseId}/uploads`,409,createInput(1));
    await call(`/ingestion/cases/${other.caseId}/uploads/${main.id}`,404);
    await call(uploadPath(main)+'/finalize',422,{...guard(main),sha256:'0'.repeat(64)});
    receipt.checks.push('fixed byte limits, cross-site guard, create replay/conflict, strict caller-key rejection, stale case and cross-case scope denial');
    file=await open(original,'r');phase='checkpoint';const first=await part(main,1);main=first.value;
    assert.deepEqual((await part(main,1,first.input)).value,main);
    main=(await part(main,2)).value;
    await call(uploadPath(main)+'/finalize',409,{...guard(main),sha256:source.sha256});
    assert.equal((await pool.query('SELECT count(*)::int n FROM sources WHERE case_id=$1',[caseId])).rows[0].n,0);
    const checkpoint=await call(uploadPath(main));assert.equal(checkpoint.receivedBytes,2*receipt.limits.partBytes);
    phase='api-only-restart';receipt.restart=JSON.parse(execFileSync(process.execPath,['scripts/usp/real-source-runtime.mjs','api-restart',dir],{cwd:root,env:safeEnv,encoding:'utf8',timeout:90000}).trim());
    assert.deepEqual(await call(uploadPath(main)),checkpoint);main=checkpoint;
    receipt.checks.push('two durable parts, immutable part replay, incomplete finalize creates no source, verified API-only process restart preserves exact status');
    phase='wrong-digest-peer';const badInput=createInput(0,'0'.repeat(64));let peer=await call(`/ingestion/cases/${caseId}/uploads`,201,badInput);receipt.peerUploadId=peer.id;
    for(let number=1;number<=peer.partCount;number++)peer=(await part(peer,number)).value;
    await call(uploadPath(peer)+'/finalize',422,{...guard(peer),sha256:badInput.sha256});peer=await call(uploadPath(peer));assert.equal(peer.state,'receiving');assert.equal(peer.lastError,'ORIGINAL_INTEGRITY');
    assert.equal((await pool.query('SELECT count(*)::int n FROM sources WHERE case_id=$1',[caseId])).rows[0].n,0);
    phase='peer-abort';const abortInput=guard(peer);peer=await call(uploadPath(peer)+'/abort',200,abortInput);assert.equal(peer.state,'aborted');assert.equal(peer.cleanupPending,false);
    assert.deepEqual(await call(uploadPath(peer)+'/abort',200,abortInput),peer);
    assert.deepEqual(await call(uploadPath(peer)+'/abort',200,guard(peer)),peer);
    assert.deepEqual(await call(uploadPath(main)),checkpoint);
    const peerKeys=(await pool.query('SELECT object_key FROM usp_source_upload_parts WHERE upload_id=$1',[peer.id])).rows;
    for(const {object_key} of peerKeys)assert(await missing(object_key),'aborted peer temporary object remains');
    const mainKeys=(await pool.query('SELECT object_key FROM usp_source_upload_parts WHERE upload_id=$1',[main.id])).rows;
    for(const {object_key} of mainKeys)assert.equal(await missing(object_key),false,'peer abort affected another upload');
    receipt.checks.push('all nine unchanged real parts under invalid declared whole digest reject finalization without source; scoped abort/replay reclaims only peer objects');
    phase='resume-finalize';for(let number=3;number<=main.partCount;number++)main=(await part(main,number)).value;
    await call(uploadPath(main)+'/finalize',409,{...guard(main),expectedRevision:main.revision-1,sha256:source.sha256});
    const finalizeInput={...guard(main),sha256:source.sha256};main=await call(uploadPath(main)+'/finalize',200,finalizeInput);
    assert.equal(main.state,'retained');assert.equal(main.verifiedSha256,source.sha256);assert.equal(main.source.bytes,source.bytes);assert.equal(main.cleanupPending,false);
    assert.deepEqual(await call(uploadPath(main)+'/finalize',200,finalizeInput),main);
    await call(uploadPath(main)+'/abort',409,guard(main));
    const cleanupInput=guard(main);assert.deepEqual(await call(uploadPath(main)+'/cleanup',200,cleanupInput),main);assert.deepEqual(await call(uploadPath(main)+'/cleanup',200,cleanupInput),main);
    receipt.main=main;receipt.sourceId=main.source.sourceId;
    const detail=await call(`/cases/${caseId}`);assert.equal(detail.sources.length,1);const retained=detail.sources[0];
    assert.equal(retained.profile,'large-original-v1');assert.equal(retained.status,'needs_input');assert.equal(retained.inspection.largeOriginal.provenance.state,'caller_declared');assert.equal(retained.inspection.largeOriginal.conversion,'unsupported');
    const sourceRow=(await pool.query('SELECT * FROM sources WHERE id=$1',[receipt.sourceId])).rows[0];
    const ownParts=(await pool.query('SELECT object_key FROM usp_source_upload_parts WHERE upload_id=$1',[main.id])).rows;
    for(const {object_key} of ownParts)assert(await missing(object_key),'retained temporary part remains');assert.equal(await missing(sourceRow.object_key),false);
    const assemblies=await s3.send(new ListMultipartUploadsCommand({Bucket:scope.bucket,Prefix:sourceRow.object_key,MaxUploads:16}),{abortSignal:AbortSignal.timeout(5000)});assert(!assemblies.IsTruncated);assert.equal((assemblies.Uploads||[]).filter(x=>x.Key===sourceRow.object_key).length,0);
    receipt.checks.push('resumed nine-part complete actual hash/size verification, one canonical unsupported source, finalize replay, retained abort denial and scoped temporary cleanup');
    phase='private-stream';const response=await fetch(base+`/sources/${receipt.sourceId}/file`,{signal:AbortSignal.timeout(150000)});assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'private, max-age=60');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('content-length'),String(source.bytes));assert.equal(response.headers.get('x-source-sha256'),source.sha256);
    const downloaded=createHash('sha256');let downloadedBytes=0;for await(const chunk of response.body){downloadedBytes+=chunk.length;assert(downloadedBytes<=source.bytes);downloaded.update(chunk);}
    assert.equal(downloadedBytes,source.bytes);assert.equal(downloaded.digest('hex'),source.sha256);receipt.download={bytes:downloadedBytes,sha256:source.sha256,integrityHeader:response.headers.get('x-source-integrity')};
    await call(`/sources/${receipt.sourceId}/file`,403,undefined,{'Sec-Fetch-Site':'cross-site'});
    await call(`/sources/${receipt.sourceId}/file`,416,undefined,{'Range':'bytes=0-1023'});
    receipt.checks.push('native private bounded original download hashes exact 71,238,839 bytes; cross-site and partial-range requests denied');
    phase='small-compatibility';const small=readFileSync(join(root,'fixtures/real-nyc/original.geojson')),provenance=JSON.parse(readFileSync(join(root,'fixtures/real-nyc/provenance.json'),'utf8'));assert.equal(hash(small),provenance.originalSha256);
    const form=new FormData();form.set('file',new Blob([small],{type:'application/geo+json'}),'original.geojson');form.set('requestKey',randomUUID());form.set('expectedWorkspaceRevision','0');form.set('format','geojson');
    const smallReceipt=await call(`/ingestion/cases/${other.caseId}/sources`,201,form),smallResponse=await fetch(base+`/sources/${smallReceipt.source.sourceId}/file`);assert.equal(smallResponse.status,200);assert.equal(smallResponse.headers.get('cache-control'),'private, max-age=60');assert(Buffer.from(await smallResponse.arrayBuffer()).equals(small));
    receipt.smallCompatibility={sourceId:smallReceipt.source.sourceId,bytes:small.length,sha256:hash(small)};receipt.checks.push('existing small official NYC GIS retention and private unchanged-byte download remain useful in separate geography');
    phase='canonical-counts';receipt.counts=(await pool.query(`SELECT (SELECT count(*)::int FROM sources WHERE case_id=$1) sources,
      (SELECT count(*)::int FROM usp_source_uploads WHERE case_id=$1) uploads,(SELECT count(*)::int FROM usp_source_uploads WHERE case_id=$1 AND state='retained') retained,
      (SELECT count(*)::int FROM usp_source_uploads WHERE case_id=$1 AND state='aborted') aborted,(SELECT count(*)::int FROM usp_source_upload_parts WHERE upload_id=$2) parts,
      (SELECT count(*)::int FROM jobs WHERE case_id=$1) jobs,(SELECT count(*)::int FROM usp_model_calls) "modelCalls"`,[caseId,main.id])).rows[0];
    assert.deepEqual(receipt.counts,{sources:1,uploads:2,retained:1,aborted:1,parts:9,jobs:0,modelCalls:0});receipt.checks.push('read-only isolated counts prove one large original, one safely aborted peer, nine receipt parts and zero jobs/model calls');
    receipt.status='passed';receipt.completedAt=new Date().toISOString();writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:receipt.status,checks:receipt.checks.length,counts:receipt.counts,receipt:output}));
  }catch(error){receipt.status='failed';receipt.phase=phase;receipt.error=error.message;writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});throw error;}
  finally{await file?.close();await pool.end();s3.destroy();}
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
