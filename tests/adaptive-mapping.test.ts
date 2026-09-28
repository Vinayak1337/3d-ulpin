import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {GisInspection} from '../packages/contracts/src/gis-inspection';
import {SourceProfileSchema,type SourceProfile} from '../packages/contracts/src/usp/ingestion';
import {geojsonInventory,inspectedProfile} from '../packages/server/src/modules/usp/ingestion/registry';
import {validateAdaptiveMapping} from '../packages/server/src/modules/usp/ingestion/adaptive-mapping';
import {proposeAdaptiveMapping} from '../packages/server/src/modules/usp/ingestion/adaptive-mapping-service';
import type {ModelGateway} from '../packages/server/src/modules/model-gateway/gateway';

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
