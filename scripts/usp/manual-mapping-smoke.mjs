/** One isolated API journey on unchanged official NYC bytes; invalid plans are control inputs only. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertUspIsolation, assertLocalOperatorProcess } from './local-isolation.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const safeEnv=Object.fromEntries(['HOME','PATH','USER','LOGNAME','TMPDIR','SHELL','LANG'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
const git=args=>execFileSync('git',args,{cwd:root,env:safeEnv,encoding:'utf8',timeout:5000}).trim();
async function run(){
  const dir=realpathSync(process.argv[2]||'');
  assert(dir.startsWith(realpathSync(join(root,'.runtime/run01'))+'/'));
  const env=JSON.parse(readFileSync(join(dir,'run.env.json'),'utf8')),ownership=JSON.parse(readFileSync(join(dir,'ownership.json'),'utf8'));
  let scope,operator;
  try{scope=assertUspIsolation(env);operator=assertLocalOperatorProcess(env);}catch{throw new Error('Private isolation validation failed.');}
  assert.equal(env.ULPIN_ISOLATION_PROFILE,'local-nest');assert.equal(ownership.checkout,root);
  assert.equal(ownership.project,scope.project);assert.equal(ownership.nonce,env.ULPIN_LOCAL_NONCE);assert.deepEqual(ownership.operatorProvenance,operator);
  assert.equal(git(['rev-parse','HEAD']),ownership.baseCommit);assert.equal(git(['status','--porcelain','--untracked-files=no']),'');
  assert(!existsSync(join(root,'.env')));
  const output=join(dir,'manual-mapping-smoke.json');assert(!existsSync(output),'Use a fresh nonce; this receipt already exists.');
  const original=readFileSync(join(root,'fixtures/real-nyc/original.geojson'));
  const provenance=JSON.parse(readFileSync(join(root,'fixtures/real-nyc/provenance.json'),'utf8'));
  assert.equal(hash(original),provenance.originalSha256);
  const raw=JSON.parse(original),nativeKey=raw.features[0].properties.doitt_id;
  assert.equal(nativeKey,provenance.sourceKey.doitt_id);
  const base=env.ULPIN_TEST_URL+'api/v1';
  const receipt={version:'manual-mapping-smoke/1',status:'running',codeCommit:ownership.baseCommit,project:scope.project,nonce:ownership.nonce,operatorProvenance:operator,
    source:{path:'fixtures/real-nyc/original.geojson',sha256:hash(original),bytes:original.length,issuer:provenance.provider,url:provenance.originalDownload,terms:provenance.terms,geography:'New York City, USA',purpose:'test_only',nativeKey},checks:[],
    notQualified:['Other formats or target concepts','Unit/height conversions','Revised-source row reconciliation','Queued streaming, split recovery and scale','Model proposals, per-batch caps, held-out accuracy, injection and PII egress','Indian operational qualification','GF-AGENT, full INGEST-03 and release-gate completion']};
  let phase='source-case';
  async function call(path,status=200,body,headers={}){
    const response=await fetch(base+path,{...(body?{method:'POST',body:body instanceof FormData?body:JSON.stringify(body)}:{}),
      headers:{...(body && !(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},signal:AbortSignal.timeout(60000)});
    const value=await response.json();assert.equal(response.status,status,`${path}: ${value.error?.code||response.status}`);return value;
  }
  const form=(requestKey,expectedWorkspaceRevision)=>{
    const value=new FormData();value.set('file',new Blob([original],{type:'application/geo+json'}),'original.geojson');
    for(const [key,item] of Object.entries({requestKey,expectedWorkspaceRevision,format:'geojson'}))value.set(key,String(item));return value;
  };
  const decision=revision=>({requestKey:randomUUID(),expectedRecipeRevision:revision});
  try{
    const sourceCase=await call('/source-cases',201,{requestKey:randomUUID(),name:provenance.provider+' building footprint'}),caseId=sourceCase.caseId;
    const path=`/ingestion/cases/${caseId}`,uploadKey=randomUUID();receipt.caseId=caseId;
    phase='retain-profile';
    const profile=await call(`${path}/sources`,201,form(uploadKey,0));receipt.sourceId=profile.source.sourceId;receipt.profile=profile;
    assert.equal(profile.source.sourceSha256,hash(original));assert.equal(profile.workspaceRevision,1);assert.equal(profile.featureCount,1);
    for(const field of profile.paths.filter(p=>p.path.startsWith('/features/*/properties/'))){
      const name=field.path.slice('/features/*/properties/'.length).replaceAll('~1','/').replaceAll('~0','~');
      const values=raw.features.map(feature=>({present:Object.hasOwn(feature.properties,name),value:feature.properties[name]}));
      assert.equal(field.explicitNull,values.filter(v=>v.present&&v.value===null).length);
      assert.equal(field.absent,values.filter(v=>!v.present).length);
      assert.equal(field.values,values.filter(v=>v.present&&v.value!==null).length);
    }
    assert.deepEqual(await call(`${path}/sources`,201,form(uploadKey,0)),profile);
    assert.equal((await call(`${path}/sources`,201,form(randomUUID(),0))).source.sourceId,profile.source.sourceId);
    assert.deepEqual(await call(`${path}/sources/${profile.source.sourceId}/profile`),profile);
    receipt.checks.push('retention, exact replay, same-hash deduplication and source-derived presence/null inventory');
    const conversions=await call('/ingestion/conversions');assert.equal(conversions.conversions.length,3);
    await call('/ingestion/conversions',403,undefined,{'Sec-Fetch-Site':'cross-site'});
    const plan={version:profile.version,mode:'manual_mapping',source:profile.source,caseId,workspaceRevision:profile.workspaceRevision,workspaceFingerprint:profile.workspaceFingerprint,
      operations:[{target:'building.sourceKey',sourcePath:'/features/*/properties/doitt_id',conversionId:'literal_identifier@1'},
        {target:'building.geometry',sourcePath:'/features/*/geometry',conversionId:'geojson_polygon@1'}]};
    const author={requestKey:randomUUID(),expectedRecipeRevision:0,plan,destination:{kind:'new_area',namespace:'nyc-oti-5zhs-2jue',name:`NYC OTI building footprint ${nativeKey}`}};
    const authorPath=`${path}/sources/${profile.source.sourceId}/recipes`;
    phase='invalid-plan';
    for(const extra of [{factor:0.3048},{sourceCrs:'EPSG:4326'},{coordinates:[0,0]},{entityId:'invented'},{tool:'execute'}]){
      const invalid=structuredClone(author);invalid.requestKey=randomUUID();Object.assign(invalid.plan.operations[0],extra);await call(authorPath,422,invalid);
    }
    const invalidPath=structuredClone(author);invalidPath.requestKey=randomUUID();invalidPath.plan.operations[0].sourcePath='/features/*/properties/not_in_source';await call(authorPath,422,invalidPath);
    const model=structuredClone(author);model.requestKey=randomUUID();model.plan.mode='model_mapping';await call(authorPath,422,model);
    const stalePin=structuredClone(author);stalePin.requestKey=randomUUID();stalePin.plan.source.sourceSha256='0'.repeat(64);await call(authorPath,409,stalePin);
    const staleScope=structuredClone(author);staleScope.requestKey=randomUUID();staleScope.plan.workspaceFingerprint='0'.repeat(64);await call(authorPath,409,staleScope);
    receipt.checks.push('numeric/CRS/coordinate/entity/tool literals, unknown path, model mode and stale source/workspace pins rejected before package creation');
    phase='author-approve';
    const proposed=await call(authorPath,201,author);assert.equal(proposed.state,'proposed');assert.equal(proposed.approval,null);receipt.recipeId=proposed.id;
    const recipePath=`${path}/recipes/${proposed.id}`;
    assert.deepEqual(await call(authorPath,201,author),proposed);
    await call(`${recipePath}/execute`,409,decision(proposed.revision));
    const spoof={...decision(proposed.revision),approvedBy:'caller'};await call(`${recipePath}/approve`,422,spoof);
    await call(`${recipePath}/approve`,409,decision(proposed.revision+1));
    const approvalInput=decision(proposed.revision);
    const approved=await call(`${recipePath}/approve`,200,approvalInput);assert.equal(approved.approval.subject,operator.subject);assert.equal(approved.approval.provenance,'server_configured_local_operator');
    assert.deepEqual(await call(`${recipePath}/approve`,200,approvalInput),approved);
    await call(`${recipePath}/execute`,409,decision(proposed.revision));
    receipt.checks.push('unapproved execution, caller attribution and stale recipe revisions denied; server-configured approval is idempotent');
    phase='concurrent-execute';
    const executeInput=decision(approved.revision),executions=await Promise.all([call(`${recipePath}/execute`,200,executeInput),call(`${recipePath}/execute`,200,executeInput)]);
    assert.deepEqual(executions[0],executions[1]);const executed=executions[0];receipt.execution=executed;
    assert.equal(executed.state,'executed');assert.equal(executed.execution.sourceRevisionId,profile.source.sourceId);
    await call(`${recipePath}/execute`,409,decision(executed.revision));
    const history=await call(recipePath);assert.deepEqual(history.map(r=>r.state),['proposed','approved','executed']);
    receipt.checks.push('concurrent same-key execution returns one package; different-key repeat denied; immutable decision revisions retained');
    phase='canonical-package';
    const pkg=await call(`/import-packages/${executed.execution.packageId}`);receipt.packageId=pkg.id;receipt.areaId=pkg.areaId;
    assert.deepEqual(pkg.sourceRevisionIds,[profile.source.sourceId]);assert.equal(pkg.features.length,1);
    const feature=pkg.features[0];assert.equal(feature.sourceKey,nativeKey);assert.equal(feature.height.value,null);assert.equal(feature.height.state,'unknown');assert.equal(feature.geometryRole,'unknown');
    assert.deepEqual(feature.sourceGeometry,raw.features[0].geometry);
    assert.equal(feature.evidence[0].sourceRevisionId,profile.source.sourceId);
    assert.deepEqual(feature.sourceAttributes?.doitt_id??feature.attributes?.doitt_id??feature.sourceKey,nativeKey);
    const download=await fetch(base+`/sources/${profile.source.sourceId}/file`);assert.equal(download.status,200);assert.equal(download.headers.get('cache-control'),'private, max-age=60');
    assert(Buffer.from(await download.arrayBuffer()).equals(original));
    const context=await call(`/areas/${pkg.areaId}/context`);assert.equal(context.packages.filter(p=>p.id===pkg.id).length,1);
    receipt.checks.push('canonical package/candidate/evidence/area reads preserve literal ID, unknown height/role and the sole retained original; exact private download');
    phase='state-counts';
    // Direct read-only verification against this nonce's isolated DB, with no inherited dotenv or provider settings.
    const checked=execFileSync('pnpm',['exec','tsx','scripts/usp/manual-mapping-state.ts',caseId,proposed.id,pkg.id],
      {cwd:root,env:{...safeEnv,...env},encoding:'utf8',timeout:30000}).trim();receipt.state=JSON.parse(checked);
    assert.equal(receipt.state.sources,1);assert.equal(receipt.state.recipes,1);assert.equal(receipt.state.history,3);assert.equal(receipt.state.packages,1);
    assert.equal(receipt.state.jobs,0);assert.equal(receipt.state.modelCalls,0);assert.equal(receipt.state.sourceSha256,hash(original));
    assert.equal(hash(readFileSync(join(root,'fixtures/real-nyc/original.geojson'))),provenance.originalSha256);
    receipt.status='passed';receipt.checks.push('one source, one recipe, three decision revisions, one import package, zero jobs and zero model calls');
    console.log(JSON.stringify({status:receipt.status,codeCommit:receipt.codeCommit,receipt:output,checks:receipt.checks.length,sourceSha256:receipt.source.sha256}));
  }catch(error){receipt.status='failed';receipt.failure={phase,name:error.name,message:error.message};throw error;}
  finally{receipt.completedAt=new Date().toISOString();writeFileSync(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});}
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
