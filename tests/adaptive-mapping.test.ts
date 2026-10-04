import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {GisInspection} from '../packages/contracts/src/gis-inspection';
import {AuthorMappingSchema,SourceProfileSchema,type SourceProfile} from '../packages/contracts/src/usp/ingestion';
import {StreamingVectorRecordSchema} from '../packages/contracts/src/usp/streaming-vector';
import {geojsonInventory,inspectedProfile,compileMapping} from '../packages/server/src/modules/usp/ingestion/registry';
import {validateAdaptiveMapping} from '../packages/server/src/modules/usp/ingestion/adaptive-mapping';
import {proposeAdaptiveMapping} from '../packages/server/src/modules/usp/ingestion/adaptive-mapping-service';
import {ModelGateway} from '../packages/server/src/modules/model-gateway/gateway';
import {ReplayAdapter} from '../packages/server/src/modules/model-gateway/adapter';
import {ModelGatewayConfigSchema,hash as gatewayHash} from '../packages/server/src/modules/model-gateway/config';
import type {PgModelCallLedger} from '../packages/server/src/modules/model-gateway/ledger';
import {normalizeMappedChunk} from '../packages/server/src/modules/usp/ingestion/chunk-mapping-normalizer';

const key='/features/*/properties/doitt_id',geometry='/features/*/geometry';
const operations=[
  {target:'building.sourceKey',sourcePath:key,conversionId:'literal_identifier@1'},
  {target:'building.geometry',sourcePath:geometry,conversionId:'geojson_polygon@1'},
];
const proposal={decision:'propose',reason:'none',operations};

async function officialProfile():Promise<SourceProfile>{
  const bytes=new Uint8Array(await readFile(new URL('../fixtures/real-area/original.geojson',import.meta.url)));
  const hash=createHash('sha256').update(bytes).digest('hex');
  const manifest=JSON.parse(await readFile(new URL('../fixtures/real-area/manifest.json',import.meta.url),'utf8'));
  const metadata=await readFile(new URL('../fixtures/real-area/evidence/nyc-building-metadata.md',import.meta.url),'utf8');
  assert.equal(hash,manifest.sourceSha256);
  assert.match(metadata,/DOITT_ID \| DOITT_ID \| Consistent unique identifier assigned by OTI/);
  const rows=geojsonInventory(bytes),source=JSON.parse(new TextDecoder().decode(bytes));
  assert.equal(source.crs.properties.name,'urn:ogc:def:crs:OGC:1.3:CRS84');
  const fields=[...new Set(rows.flatMap(row=>Object.keys(row.properties??{})))].map(name=>({name,complete:false,unique:false,idEligible:false}));
  const inspection={format:'geojson',sourceSha256:hash,bytes:bytes.length,layers:[],layer:null,
    sourceCrs:'EPSG:4326',crsEvidence:source.crs.properties.name,featureCount:rows.length,
    geometryTypes:[...new Set(rows.map(row=>(row.geometry as {type:string}).type))],fields,
    featureIdEligible:false,suggestedIdField:null,suggestedNameField:null,
    suggestedTitle:'NYC BUILDING',suggestedNamespace:'source:'+hash} satisfies GisInspection;
  const inventory=inspectedProfile(bytes,inspection);
  const {schemaFingerprint,...fieldsInventory}=inventory;
  return SourceProfileSchema.parse({...fieldsInventory,source:{sourceId:randomUUID(),familyId:randomUUID(),
    sourceRevision:1,sourceSha256:hash,schemaFingerprint},
    caseId:randomUUID(),workspaceRevision:1,workspaceFingerprint:'a'.repeat(64)});
}

test('unchanged official NYC BUILDING source yields only executable, review-required mechanics',async()=>{
  const profile=await officialProfile();
  assert.equal(profile.featureCount,62);
  assert.equal(profile.paths.find(path=>path.path===key)?.literalIdEligible,true);
  assert.equal(profile.paths.some(path=>path.path==='/features/*/properties/name'),false);
  const result=validateAdaptiveMapping(proposal,profile);
  assert.equal(result.status,'proposed');
  assert.equal(result.plan?.mode,'manual_mapping');
  assert.deepEqual(result.plan?.operations,operations);
  assert.equal(validateAdaptiveMapping({decision:'abstain',reason:'ambiguous_identity',operations:[]},profile).code,'MODEL_ABSTAINED');
  assert.equal(validateAdaptiveMapping({decision:'propose',reason:'none',operations:[
    {...operations[0],sourcePath:'/features/*/properties/base_bbl'},operations[1]]},profile).code,'MODEL_FIELD_SEMANTICS');
  assert.equal(validateAdaptiveMapping({decision:'propose',reason:'none',operations:[
    ...operations,{target:'building.name',sourcePath:'/features/*/properties/bin',conversionId:'literal_text@1'}]},profile).code,'MODEL_FIELD_SEMANTICS');
  assert.equal(validateAdaptiveMapping({...proposal,tool:'approve'},profile).code,'MODEL_OUTPUT_INVALID');
  assert.equal(validateAdaptiveMapping({...proposal,operations:[{...operations[0],sourcePath:'/features/*/properties/missing'},operations[1]]},profile).code,'MODEL_MAPPING_INVALID');
});

test('disabled provider and stale or changed access cannot yield a proposal',async()=>{
  const profile=await officialProfile(),request={requestKey:randomUUID(),source:profile.source,
    workspaceRevision:profile.workspaceRevision,workspaceFingerprint:profile.workspaceFingerprint};
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='adaptive-mapping-test-operator';
  try{
    const noKey=await proposeAdaptiveMapping(profile.caseId,profile.source.sourceId,request,{
      readProfile:async()=>profile,assertCaseActive:async()=>{},policyHash:()=>undefined,gatewayFactory:async()=>{throw Error('must not call');}});
    assert.equal(noKey.status,'disabled');assert.equal(noKey.plan,null);
    const unavailable=await proposeAdaptiveMapping(profile.caseId,profile.source.sourceId,request,{
      readProfile:async()=>profile,assertCaseActive:async()=>{},policyHash:()=> 'policy',gatewayFactory:async()=>undefined});
    assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.code,'MODEL_KEY_UNAVAILABLE');
    let reads=0;
    const fake={config:{policyVersion:'test'},port:(trusted:{authorize:()=>Promise<void>})=>({modelGateway:async()=>{
      await trusted.authorize();return {state:'available',data:{output:proposal,modelId:'control',outputSchemaId:'adaptive-geojson-mapping/1',evidenceRefs:[]}};
    }})} as unknown as ModelGateway;
    const proposed=await proposeAdaptiveMapping(profile.caseId,profile.source.sourceId,request,{
      readProfile:async()=>profile,assertCaseActive:async()=>{},policyHash:()=> 'policy',gatewayFactory:async()=>fake});
    assert.equal(proposed.status,'proposed');assert.equal(proposed.validation,'mechanics_only');
    assert.deepEqual(proposed.plan?.operations,operations);assert.equal(proposed.reviewRequired,true);
    await assert.rejects(proposeAdaptiveMapping(profile.caseId,profile.source.sourceId,request,{
      readProfile:async()=>++reads===1?profile:{...profile,workspaceRevision:profile.workspaceRevision+1},
      assertCaseActive:async()=>{},
      policyHash:()=> 'policy',gatewayFactory:async()=>fake}),
    (error:any)=>error?.status===409);
    reads=0;
    await assert.rejects(proposeAdaptiveMapping(profile.caseId,profile.source.sourceId,request,{
      readProfile:async()=>profile,assertCaseActive:async()=>{},policyHash:()=> 'policy',gatewayFactory:async()=>({
        config:{policyVersion:'test'},port:(trusted:{authorize:()=>Promise<void>})=>({modelGateway:async()=>{
          process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='changed-adaptive-mapping-operator';
          await trusted.authorize();throw Error('unreachable');
        }})} as unknown as ModelGateway)}),
    (error:any)=>error?.code==='INGESTION_ACCESS_CHANGED');
  }finally{
    if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;
  }
});

// D05 reuses unchanged single-feature NYC bytes. Profile/UUID/authority transport
// and the replay loader are controls; no accepted job, live DB, inference or
// independent learning label is manufactured. Historical manual HTTP evidence
// remains in ingest-02-manual-handoff.md rather than being rerun here.
async function singleProfile(){
  const bytes=await readFile(new URL('../fixtures/real-nyc/original.geojson',import.meta.url));
  const provenanceBytes=await readFile(new URL('../fixtures/real-nyc/provenance.json',import.meta.url));
  const digest=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
  const provenance=JSON.parse(provenanceBytes.toString('utf8')),raw=JSON.parse(bytes.toString('utf8'));
  assert.equal(digest(bytes),'6a0035cd7abe0f96da0fb7c9fc61067fd63c1894675e13e234173643e143ffda');
  assert.equal(digest(provenanceBytes),'762ad8fe4b28a65715810961b65e1a1610a6b3525467177d2f75bb94806349f4');
  assert.equal(digest(bytes),provenance.originalSha256);assert.equal(raw.features[0].properties.doitt_id,provenance.sourceKey.doitt_id);
  assert.equal(raw.crs.properties.name,'urn:ogc:def:crs:OGC:1.3:CRS84');
  const rows=geojsonInventory(bytes),inventory=inspectedProfile(bytes,{format:'geojson',sourceSha256:digest(bytes),bytes:bytes.length,
    layers:[],layer:null,sourceCrs:'EPSG:4326',crsEvidence:raw.crs.properties.name,featureCount:rows.length,
    geometryTypes:[...new Set(rows.map(row=>(row.geometry as {type:string}).type))],
    fields:Object.keys(rows[0].properties!).map(name=>({name,complete:false,unique:false,idEligible:false})),
    featureIdEligible:false,suggestedIdField:null,suggestedNameField:null,suggestedTitle:'NYC BUILDING',suggestedNamespace:'source:'+digest(bytes)});
  const {schemaFingerprint,...fields}=inventory;
  const profile=SourceProfileSchema.parse({...fields,source:{sourceId:randomUUID(),familyId:randomUUID(),sourceRevision:1,
    sourceSha256:digest(bytes),schemaFingerprint},caseId:randomUUID(),workspaceRevision:1,workspaceFingerprint:'a'.repeat(64)});
  return {bytes,raw,profile,digest};
}

test('D05 single-feature measurement/date values cannot masquerade as adaptive building identity',async()=>{
  const {profile}=await singleProfile();
  for(const field of ['height_roof','ground_elevation','construction_year','shape_area','shape_length','last_edited_date']){
    const sourcePath='/features/*/properties/'+field;
    assert.equal(profile.paths.find(path=>path.path===sourcePath)?.literalIdEligible,true,'One row can make a nonidentity string mechanically unique.');
    const result=validateAdaptiveMapping({...proposal,operations:[{...operations[0],sourcePath},operations[1]]},profile);
    assert.equal(result.status,'needs_input');assert.equal(result.code,'MODEL_FIELD_SEMANTICS');assert.equal(result.plan,null);
  }
  assert.equal(validateAdaptiveMapping(proposal,profile).status,'proposed');
  assert.equal(validateAdaptiveMapping({...proposal,operations:[...operations,
    {target:'building.name',sourcePath:'/features/*/properties/name',conversionId:'literal_text@1'}]},profile).code,'MODEL_MAPPING_INVALID');
});

test('D05 canonical controlled replay retains its label and passes the existing manual contract/executor',async()=>{
  const {bytes,raw,profile,digest}=await singleProfile(),prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='d05-controlled-local-process';
  try{
    // Explicit software-only configuration; no credential read or provider access.
    const config=ModelGatewayConfigSchema.parse({projectId:'d05-replay-control',policyVersion:'d05-control-policy',fundingVersion:'d05-control-only',
      gatewayExclusiveFunding:true,indiaPrivateApproved:true,secretReference:'ULPIN_PROVIDER_KEY_D05_CONTROL',model:'sarvam-105b',
      projectCapMicroInr:'1',principalDailyCallCap:1,paceMs:1500,
      price:{version:'control-only-not-a-tariff',inputPerMillionMicroInr:'1',cachedInputPerMillionMicroInr:'0',outputPerMillionMicroInr:'1'},
      inputBound:{version:'controlled-byte-bound',maxPromptTokens:34816},timeoutMs:1000});
    const response={output:proposal,responseHash:gatewayHash(proposal),httpStatus:200};
    const adapter=new ReplayAdapter(async inputHash=>({inputHash,sourceHashes:[profile.source.sourceSha256],
      responseHash:gatewayHash(response),response,eligible:true})); // This loader is test transport, not an enrolled replay corpus.
    const gateway=new ModelGateway(config,{reserve:async()=>assert.fail('Replay must not reserve or dispatch a provider call.')} as unknown as PgModelCallLedger,adapter);
    const input={requestKey:randomUUID(),source:profile.source,workspaceRevision:profile.workspaceRevision,workspaceFingerprint:profile.workspaceFingerprint};
    const deps={readProfile:async()=>profile,assertCaseActive:async()=>{},policyHash:()=>config.policyVersion,gatewayFactory:async()=>gateway};
    const result=await proposeAdaptiveMapping(profile.caseId,profile.source.sourceId,input,deps);
    assert.equal(result.status,'proposed');assert.equal(result.replayed,true);assert.equal(result.call,null);
    assert.equal(result.reviewRequired,true);assert.equal(result.validation,'mechanics_only');
    assert.deepEqual(result.plan?.source,profile.source);assert.equal(result.plan?.workspaceFingerprint,profile.workspaceFingerprint);
    const author=AuthorMappingSchema.parse({requestKey:randomUUID(),expectedRecipeRevision:0,plan:result.plan,
      destination:{kind:'new_area',namespace:'d05-controlled-manual',name:'Retained NYC mapping control'}});
    // Only author-request compatibility and deterministic compilation are exercised:
    // real operator approval/persistence/execution remains with the existing service.
    const mapping=compileMapping(author.plan,profile);
    assert.deepEqual(mapping,{kind:'building',geometryRole:'unknown',idField:'doitt_id'});
    assert.equal(profile.paths.find(path=>path.path==='/features/*/properties/name')?.explicitNull,1);
    assert.equal(profile.paths.some(path=>path.path==='/features/*/id'),false);
    const byteStart=bytes.indexOf('{"type":"Feature"'),byteEnd=bytes.indexOf('], "crs"');assert(byteStart>=0&&byteEnd>byteStart);
    const record=StreamingVectorRecordSchema.parse({featureIndex:0,byteStart,byteEnd,rawSha256:digest(bytes.subarray(byteStart,byteEnd)),
      disposition:'accepted',issueCode:null,feature:raw.features[0]});
    const normalized=normalizeMappedChunk([record],author.plan,profile,randomUUID(),0,[]);
    assert.equal(normalized.records.length,1);assert.equal(normalized.records[0].disposition,'observed');
    assert.deepEqual(normalized.records[0].sourceKey,{state:'known',value:'353927',sourcePath:key});
    assert.deepEqual(normalized.records[0].name,{state:'unknown',value:null,sourcePath:null});
    assert.equal(normalized.records[0].geometryRef?.rawSha256,record.rawSha256);assert.equal(normalized.schemaDrift,false);

    const unavailable=await proposeAdaptiveMapping(profile.caseId,profile.source.sourceId,input,{...deps,gatewayFactory:async()=>undefined});
    assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.plan,null);
    const manual=validateAdaptiveMapping(proposal,profile).plan!;
    assert.deepEqual(compileMapping(manual,profile),mapping,'The same canonical deterministic mapping remains usable without a provider.');
  }finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}
});
