/** RUN-01: independent official PDF queue and synchronous NYC GIS journeys. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertUspIsolation, assertLocalOperatorProcess } from './local-isolation.mjs';

// Enable only after the lead accepts this preparation and authorizes the run.
const RUNTIME_ENABLED = false;
if (!RUNTIME_ENABLED) {
  console.error('RUN-01 phase 2B smoke is gated pending lead acceptance and run authorization; no source read or API call was made.');
  process.exit(1);
}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const uuid=value=>assert.match(value || '',/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,'API must return an actual UUID');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const safeEnvironment=Object.fromEntries(['HOME','PATH','USER','LOGNAME','TMPDIR','SHELL','LANG'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
const git=args=>execFileSync('git',args,{cwd:root,env:safeEnvironment,encoding:'utf8',timeout:5000}).trim();

async function run() {
  const dir=realpathSync(process.argv[2] || '');
  assert(dir.startsWith(realpathSync(join(root,'.runtime','run01'))+'/'),'run directory must be inside .runtime/run01');
  const env=JSON.parse(readFileSync(join(dir,'run.env.json'),'utf8'));
  const ownership=JSON.parse(readFileSync(join(dir,'ownership.json'),'utf8'));
  let scope, operatorProvenance;
  try {
    assert.equal(env.ULPIN_ISOLATION_PROFILE,'local-nest');
    scope=assertUspIsolation(env);
    operatorProvenance=assertLocalOperatorProcess(env);
    assert.deepEqual(ownership.operatorProvenance,operatorProvenance);
  } catch {throw new Error('private run configuration failed isolation or process-attribution validation');}
  assert.equal(ownership.checkout,root);assert.equal(ownership.project,scope.project);assert.equal(ownership.nonce,env.ULPIN_LOCAL_NONCE);
  assert.equal(git(['rev-parse','HEAD']),ownership.baseCommit,'checkout changed since prepare');
  assert.equal(git(['status','--porcelain','--untracked-files=no']),'','runtime checkout has tracked edits');
  assert(!existsSync(join(root,'.env')),'root .env is forbidden');
  const receipt=join(dir,'source-smoke.json');
  assert(!existsSync(receipt),'source receipt already exists; use a new exact nonce');
  const base=env.ULPIN_TEST_URL+'api/v1';
  const result={schemaVersion:'run01-smoke/3',qualification:'running',startedAt:new Date().toISOString(),
    codeCommit:ownership.baseCommit,nonce:ownership.nonce,project:scope.project,operatorProvenance,
    documentJourney:{status:'not_run'},gisJourney:{status:'not_run'},
    notQualified:['Indian operational evidence','geometry, ownership or rights accuracy','provider or model behavior','scale','frontend or release-gate completion']};
  let phase='source-preflight';
  async function call(path,options={}) {
    const response=await fetch(base+path,{...options,signal:AbortSignal.timeout(30000)});
    let value;
    try {value=await response.json();} catch {throw new Error(`${options.method || 'GET'} ${path} -> ${response.status} NON_JSON_RESPONSE`);}
    if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${response.status} ${value.error?.code || 'API_ERROR'}`);
    return {status:response.status,value};
  }
  function multipart(bytes,name,mimeType,fields={}) {
    const form=new FormData();form.set('file',new Blob([bytes],{type:mimeType}),name);
    for(const [key,value] of Object.entries(fields))form.set(key,value);
    return form;
  }
  async function exactSource(sourceId,want,name,mimeType) {
    uuid(sourceId);
    const response=await fetch(base+`/sources/${sourceId}/file`,{signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,200,'private original download failed');
    assert.equal(response.headers.get('cache-control'),'private, max-age=60');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.equal(response.headers.get('content-type'),mimeType);
    assert.equal(response.headers.get('content-disposition'),`inline; filename*=UTF-8''${encodeURIComponent(name)}`);
    const got=Buffer.from(await response.arrayBuffer());
    assert(got.equals(want),'private original download differs from submitted bytes');
    return {status:response.status,bytes:got.length,sha256:hash(got),contentType:response.headers.get('content-type'),
      cacheControl:response.headers.get('cache-control'),contentDisposition:response.headers.get('content-disposition'),nosniff:true};
  }
  async function deniedOrigin(sourceId,origin) {
    const response=await fetch(base+`/sources/${sourceId}/file`,{headers:{Origin:origin},signal:AbortSignal.timeout(10000)});
    assert.equal(response.status,403,'remote-origin original request must be denied');
    const value=await response.json();assert.equal(value.error?.code,'ORIGIN_DENIED');
    return {status:response.status,errorCode:value.error.code,origin};
  }
  function control(action) {
    // The launcher rechecks clean code, nonce ownership and process groups.
    try {
      const output=execFileSync(process.execPath,[join(root,'scripts/usp/real-source-runtime.mjs'),action,dir],
        {cwd:root,env:safeEnvironment,encoding:'utf8',timeout:125000,stdio:['ignore','pipe','pipe']});
      return JSON.parse(output.trim());
    } catch {throw new Error(`owned runtime ${action} failed; inspect private logs and complete owned cleanup`);}
  }
  async function detail(caseId) {
    const read=await call(`/cases/${caseId}`);
    assert.equal(read.status,200);assert.equal(read.value.case.id,caseId);
    return read.value;
  }
  function sourceJob(read,sourceId,jobId) {
    const source=read.sources.find(item=>item.id===sourceId),job=read.jobs.find(item=>item.id===jobId);
    assert(source && job,'case read must retain this source and job');
    assert.equal(job.sourceId,sourceId);assert.equal(job.caseId,read.case.id);assert.equal(job.operation,'inspect');
    return {source,job};
  }
  async function waitJob(caseId,sourceId,jobId,want) {
    const end=Date.now()+90000;
    while(Date.now()<end) {
      const read=await detail(caseId),pair=sourceJob(read,sourceId,jobId);
      if(pair.job.status===want)return {...pair,read};
      if(['failed','succeeded','stale'].includes(pair.job.status))throw new Error(`inspect job ${jobId} ended ${pair.job.status}; expected ${want}`);
      await delay(750);
    }
    throw new Error(`inspect job ${jobId} did not reach ${want} within 90 seconds`);
  }
  try {
    const sourceCheckPath='docs/evidence/usp/nest-migration/official-runtime-source/source-check.json';
    const sourceCheckBytes=readFileSync(join(root,sourceCheckPath));
    const sourceCheck=JSON.parse(sourceCheckBytes.toString('utf8')),pdfSource=sourceCheck.source;
    assert.equal(pdfSource.permissionState,'documented');
    assert(pdfSource.permissionEvidence && pdfSource.sourcePermissionReference && pdfSource.permittedTaskPurpose);
    assert.equal(pdfSource.original.sha256,'fc554d896f7620149f0c540ad996efc6f0ff26405d8ab77ee7ed1169aaccadcf');
    assert.equal(pdfSource.original.bytes,9344939);
    const pdf=readFileSync(pdfSource.original.localPath),pdfName=basename(pdfSource.original.localPath);
    assert.equal(hash(pdf),pdfSource.original.sha256,'retained USGS PDF changed');assert.equal(pdf.length,pdfSource.original.bytes);
    const pages=Number(sourceCheck.checks.find(item=>item.id==='pdfinfo')?.actual.match(/Pages (\d+)/)?.[1]);
    assert(Number.isSafeInteger(pages) && pages>0,'accepted format-aware page-count receipt is required');
    const original=readFileSync(join(root,'fixtures/real-nyc/original.geojson'));
    const provenance=JSON.parse(readFileSync(join(root,'fixtures/real-nyc/provenance.json'),'utf8'));
    assert.equal(hash(original),provenance.originalSha256,'retained NYC authority bytes changed');assert.equal(original.length,1763);
    assert(provenance.provider && provenance.originalDownload && provenance.terms);
    const native=JSON.parse(original.toString('utf8'));assert.equal(native.features.length,1,'bounded NYC source profile changed');
    const nativeKey=String(native.features[0].properties.doitt_id);assert.equal(nativeKey,provenance.sourceKey.doitt_id);

    const document=result.documentJourney={status:'running',mode:'canonical_queued_document_inspection',
      source:{issuer:pdfSource.issuer,title:pdfSource.title,originalUrl:pdfSource.originalUrl,geography:pdfSource.geography,purpose:'test_only',
        permissionReference:pdfSource.sourcePermissionReference,permissionEvidence:pdfSource.permissionEvidence,
        sourceCheck:{path:sourceCheckPath,sha256:hash(sourceCheckBytes)},sha256:hash(pdf),bytes:pdf.length,
        reference:pdfSource.reference,limitations:sourceCheck.limitations}};
    phase='document-case-create';
    const created=await call('/cases',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:pdfSource.title,description:pdfSource.permittedTaskPurpose})});
    assert.equal(created.status,201);uuid(created.value.id);assert.equal(created.value.name,pdfSource.title);
    document.caseCreate={status:created.status,id:created.value.id,name:created.value.name};
    const caseId=created.value.id,operationKey=`run01:${ownership.nonce}:usgs-pdf`;
    let uploaded,failed;
    phase='document-processor-outage';
    document.outage=control('processor-stop');
    try {
      phase='document-upload';
      uploaded=await call(`/cases/${caseId}/sources`,{method:'POST',headers:{'Idempotency-Key':operationKey},
        body:multipart(pdf,pdfName,'application/pdf',{profile:'plan-pdf-v1'})});
      assert.equal(uploaded.status,201);uuid(uploaded.value.id);uuid(uploaded.value.familyId);
      assert.equal(uploaded.value.caseId,caseId);assert.equal(uploaded.value.profile,'plan-pdf-v1');
      assert.equal(uploaded.value.sha256,hash(pdf));assert.equal(uploaded.value.bytes,pdf.length);assert.equal(uploaded.value.status,'received');
      document.upload={httpStatus:uploaded.status,...uploaded.value,operationKey};
      const queued=await detail(caseId);assert.equal(queued.sources.length,1);assert.equal(queued.jobs.length,1);
      const job=queued.jobs[0];uuid(job.id);sourceJob(queued,uploaded.value.id,job.id);
      assert.equal(job.status,'queued','processor outage must expose the persisted canonical queued job');
      document.queuedJob=job;
      document.downloadDuringOutage=await exactSource(uploaded.value.id,pdf,pdfName,'application/pdf');
      phase='document-dispatch-failure';
      failed=await waitJob(caseId,uploaded.value.id,job.id,'failed');
      assert.equal(failed.source.status,'failed');assert(failed.job.error,'service failure must be recorded');
      assert(failed.read.history.some(item=>item.kind==='processing.failed'));
      document.failedJob=failed.job;
      document.downloadAfterFailure=await exactSource(uploaded.value.id,pdf,pdfName,'application/pdf');
    } catch(error) {
      document.failureBeforeRecovery={phase,message:error.message};
      throw error;
    } finally {
      document.recovery=control('processor-start');
    }
    phase='document-job-retry';
    const retry=await call(`/jobs/${failed.job.id}/retry`,{method:'POST'});
    assert.equal(retry.status,202);uuid(retry.value.id);assert.notEqual(retry.value.id,failed.job.id);
    assert.equal(retry.value.sourceId,uploaded.value.id);assert.equal(retry.value.caseId,caseId);
    assert.equal(retry.value.operation,'inspect');assert.equal(retry.value.status,'queued');assert.equal(retry.value.inputFingerprint,failed.job.inputFingerprint);
    document.retry={httpStatus:retry.status,...retry.value};
    phase='document-persisted-inspection';
    const succeeded=await waitJob(caseId,uploaded.value.id,retry.value.id,'succeeded');
    assert.equal(succeeded.source.status,'needs_input');assert.equal(succeeded.source.inspection.profile,'plan-pdf-v1');
    assert.equal(succeeded.source.inspection.status,'needs_input');assert.equal(succeeded.source.inspection.image.pages,pages);
    assert(succeeded.source.inspection.image.width>0 && succeeded.source.inspection.image.height>0);
    assert(succeeded.source.inspection.issues.some(item=>item.code==='CALIBRATION_REQUIRED'));
    assert.equal(succeeded.source.inspection.features,undefined);assert.equal(succeeded.source.inspection.frame,undefined);
    assert.equal(succeeded.read.units.length,0);assert.equal(succeeded.read.model,null);assert.equal(succeeded.read.case.frame.id,'UNASSIGNED');
    assert(succeeded.read.history.some(item=>item.kind==='source.inspected'));
    document.completedJob=succeeded.job;document.persistedSource=succeeded.source;
    document.recordRead={status:200,caseId,sourceCount:succeeded.read.sources.length,jobCount:succeeded.read.jobs.length,
      units:succeeded.read.units.length,model:succeeded.read.model,frame:succeeded.read.case.frame};
    phase='document-same-key-replay';
    const replay=await call(`/cases/${caseId}/sources`,{method:'POST',headers:{'Idempotency-Key':operationKey},
      body:multipart(pdf,pdfName,'application/pdf',{profile:'plan-pdf-v1'})});
    assert.equal(replay.status,201);assert.equal(replay.value.id,uploaded.value.id);
    assert.equal(replay.value.familyId,uploaded.value.familyId);assert.equal(replay.value.revision,uploaded.value.revision);
    const afterReplay=await detail(caseId);
    assert.deepEqual(afterReplay.sources.map(item=>item.id),succeeded.read.sources.map(item=>item.id));
    assert.deepEqual(afterReplay.jobs.map(item=>item.id).sort(),succeeded.read.jobs.map(item=>item.id).sort());
    document.sameKeyReplay={httpStatus:replay.status,sourceId:replay.value.id,familyId:replay.value.familyId,revision:replay.value.revision,
      sourceCount:afterReplay.sources.length,jobIds:afterReplay.jobs.map(item=>item.id),noDuplicateSourceOrJob:true};
    document.finalDownload=await exactSource(uploaded.value.id,pdf,pdfName,'application/pdf');
    document.remoteOrigin=await deniedOrigin(uploaded.value.id,new URL(pdfSource.sourcePermissionReference).origin);
    assert.equal(hash(readFileSync(pdfSource.original.localPath)),pdfSource.original.sha256);
    document.status='passed';

    const gis=result.gisJourney={status:'running',mode:'synchronous_gis_import',
      source:{issuer:provenance.provider,originalUrl:provenance.originalDownload,terms:provenance.terms,geography:'New York City, USA',purpose:'test_only',
        sha256:hash(original),bytes:original.length,nativeKey,sourceCrs:'OGC CRS84 / EPSG:4326',limitations:provenance.limitations},
      jobAuthority:{status:'not_applicable',reason:'This GeoJSON import normalizes synchronously; no queued document-job receipt is claimed.'}};
    phase='gis-inspect';
    const inspected=await call('/import-packages/inspect',{method:'POST',body:multipart(original,'original.geojson','application/geo+json')});
    assert.equal(inspected.status,200);assert.equal(inspected.value.sourceSha256,hash(original));
    assert.equal(inspected.value.featureCount,1);assert.equal(inspected.value.sourceCrs,'EPSG:4326');
    gis.inspection={httpStatus:inspected.status,sourceSha256:inspected.value.sourceSha256,featureCount:inspected.value.featureCount};
    phase='gis-import';
    const imported=await call('/import-packages',{method:'POST',body:multipart(original,'original.geojson','application/geo+json',{
      format:'geojson',namespace:'nyc-oti-5zhs-2jue',name:`NYC OTI building footprint ${nativeKey}`,
      mapping:JSON.stringify({idField:'doitt_id',kind:'building',geometryRole:'unknown'}),sourceCrs:'EPSG:4326',worldStatus:'observed',
    })});
    assert.equal(imported.status,201);
    const pkg=imported.value;uuid(pkg.id);uuid(pkg.areaId);
    assert.equal(pkg.sourceHash,hash(original));assert.equal(pkg.features.length,1);assert.equal(pkg.features[0].sourceKey,nativeKey);
    assert.equal(pkg.features[0].geometryRole,'unknown');
    gis.rawImport={httpStatus:imported.status,packageId:pkg.id,areaId:pkg.areaId,state:pkg.state};
    phase='gis-persisted-read';
    const readPackage=await call(`/import-packages/${pkg.id}`);
    assert.equal(readPackage.status,200);assert.equal(readPackage.value.sourceHash,hash(original));
    assert.equal(readPackage.value.sourceRevisionIds.length,1);assert.equal(readPackage.value.features.length,1);
    const sourceRevisionId=readPackage.value.sourceRevisionIds[0];uuid(sourceRevisionId);
    assert.notEqual(sourceRevisionId,uploaded.value.id,'independent originals must have distinct source revisions');
    const candidate=readPackage.value.features[0];uuid(candidate.id);
    assert.equal(candidate.sourceKey,nativeKey);assert.equal(candidate.sourceRevisionId,sourceRevisionId);
    assert(candidate.evidence?.some(item=>item.sourceRevisionId===sourceRevisionId && item.featureId===nativeKey));
    const area=await call(`/areas/${pkg.areaId}/context`),persisted=area.value.packages.find(item=>item.id===pkg.id);
    assert(persisted,'GIS package must be present in the area read');
    assert.equal(persisted.sourceRevisionIds[0],sourceRevisionId);assert.equal(persisted.features[0].id,candidate.id);
    gis.persistedRead={packageStatus:readPackage.status,areaStatus:area.status,sourceRevisionId,candidateId:candidate.id,
      nativeKey:candidate.sourceKey,geometryRole:candidate.geometryRole,evidence:candidate.evidence};
    gis.download=await exactSource(sourceRevisionId,original,'original.geojson','application/geo+json');
    gis.remoteOrigin=await deniedOrigin(sourceRevisionId,new URL(provenance.terms).origin);
    assert.equal(hash(readFileSync(join(root,'fixtures/real-nyc/original.geojson'))),provenance.originalSha256);
    gis.status='passed';result.qualification='passed';
  } catch(error) {
    result.qualification='failed';result.failure={phase,message:error.message};
    if(result.documentJourney.status==='running')result.documentJourney.status='failed';
    if(result.gisJourney.status==='running')result.gisJourney.status='failed';
    process.exitCode=1;
  }
  result.completedAt=new Date().toISOString();
  writeFileSync(receipt,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({receipt,qualification:result.qualification,document:result.documentJourney.status,gis:result.gisJourney.status,
    failure:result.failure,documentSourceId:result.documentJourney.upload?.id,gisSourceId:result.gisJourney.persistedRead?.sourceRevisionId}));
}
try {await run();}
catch(error) {console.error(`RUN-01 source smoke preflight failed: ${error.message}`);process.exitCode=1;}
