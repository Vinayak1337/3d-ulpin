import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {PrivateMvtCompilerSchema,ProjectedVectorInputSchema,PROJECTED_VECTOR_PROFILE as p} from '../packages/contracts/src/usp';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {semanticPublisherSha,semanticPublisherReadCompatible} from '../packages/server/src/modules/usp/ingestion/semantic-chunks';
import {projectedParserSha,assertProjectedInput,assertProjectedReadInput} from '../packages/server/src/modules/usp/ingestion/projected-vector';
import {mvtCodeSha,mvtReadCompilerCompatible} from '../packages/server/src/modules/usp/tiles/compiler';
import {ifcConfig,assertIFCTools,assertIFCReadTools,ifcReadToolsCompatible} from '../packages/server/src/modules/usp/ingestion/ifc-config';
import {verifyFusionIFCTools} from '../packages/server/src/modules/usp/ingestion/source-fusion-ifc-authority';

// Exact cfc679fd Git/LF and retained physical aggregates; no property records.
const old={semantic:['d38d11c0c0c9e97339fee2f1adf30fa40f01faa7e6bff0ba87a606940041ae66','4278b5bbf56687af035f87f97b991b7fd240eb9b818c76419d9603adb5c8d9ce'],
  mvt:['64b5b4f8ae0a0366a15139e3bdd6692e1753c06590073c7c81a8dfa3df34079e','f44ff28bcf553f35e90950bc8729fde08eac62dee4033d4e86697f43f54df49a'],
  ifc:['c7d6d9b23fd9334079868b046907cd9bc3d0c3efb2f298552b409e113279aa1a','16ccbbfd5ece82bf8f5fff15799e7cc448df371ed4de67a3cb1e7934c6aa8db8']};
const unknown='0'.repeat(64);
test('pre-DXF semantic reads preserve input pins while admission remains strict and unknown publishers deny',()=>{
  const caseId=randomUUID(),sourceId=randomUUID(),base={kind:'retained_source',version:p.version,jobId:randomUUID(),caseId,caseRevision:1,
    sourceId,sourceRevision:1,sourceFamilyId:sourceId,sha256:p.zipSha256,bytes:p.zipBytes,objectKey:'large-originals/protocol-only',
    parserSha256:projectedParserSha(),accessBinding:unknown};
  const ctx={current:{id:caseId,revision:1},source:{id:sourceId,revision:1,family_id:sourceId,sha256:p.zipSha256,object_key:base.objectKey},access:unknown} as any;
  for(const publisherSha256 of old.semantic){
    const value={...base,semanticChunks:{version:'nwic-semantic-chunks/1',publisherSha256}},input=ProjectedVectorInputSchema.parse({...value,inputFingerprint:fingerprint(value)}),saved=JSON.stringify(input);
    assert.equal(semanticPublisherReadCompatible(publisherSha256),true);assertProjectedReadInput(ctx,input);
    assert.throws(()=>assertProjectedInput(ctx,input),(e:any)=>e.code==='PROJECTED_CONTEXT_STALE');
    assert.equal(JSON.stringify(input),saved);
    assert.equal(semanticPublisherReadCompatible(publisherSha256,unknown),false);
    assert.throws(()=>assertProjectedReadInput({...ctx,access:'1'.repeat(64)},input));
  }
  assert.equal(semanticPublisherReadCompatible(unknown),false);assert.equal(semanticPublisherReadCompatible(semanticPublisherSha()),true);
});
test('pre-DXF MVT reads require self-integrity and exact non-code pins',()=>{
  const base={codeSha256:mvtCodeSha(),policySha256:unknown,postgis:'protocol-only runtime',sourceTransformSha256:unknown,
    sourceCrs:'EPSG:4326',targetCrs:'EPSG:3857',axisOrder:'always_xy',verticalReference:null};
  const pin=(patch:any)=>{const v={...base,...patch};return PrivateMvtCompilerSchema.parse({...v,sha256:fingerprint(v)});},current=pin({});
  for(const codeSha256 of old.mvt){const stored=pin({codeSha256}),saved=JSON.stringify(stored);
    for(const prefix of [true,false]){
      assert.equal(mvtReadCompilerCompatible(stored,current,prefix),true);
      assert.equal(mvtReadCompilerCompatible({...stored,sha256:unknown},current,prefix),false);
      for(const patch of [{postgis:'changed'},{policySha256:'1'.repeat(64)},{sourceTransformSha256:'1'.repeat(64)},{codeSha256:unknown}])
        assert.equal(mvtReadCompilerCompatible(stored,pin(patch),prefix),false);
      assert.equal(mvtReadCompilerCompatible(pin({codeSha256:unknown}),current,prefix),false);
    }
    assert.notEqual(fingerprint(stored),fingerprint(current));assert.equal(JSON.stringify(stored),saved);
  }
});
test('pre-DXF IFC comparison allows exact non-code tools only; missing full inventory denies reads',()=>{
  const current={platform:'windows-x86_64' as const,pythonSha256:unknown,profileSha256:unknown,readerSha256:unknown,
    supervisorSha256:unknown,dependencyLockSha256:unknown,codeSha256:'1'.repeat(64)};
  for(const codeSha256 of old.ifc){const stored={...current,codeSha256},saved=JSON.stringify(stored);
    assert.equal(ifcReadToolsCompatible(stored,current),true);
    for(const key of ['pythonSha256','profileSha256','readerSha256','supervisorSha256','dependencyLockSha256'] as const)
      assert.equal(ifcReadToolsCompatible({...stored,[key]:'2'.repeat(64)},current),false);
    assert.equal(JSON.stringify(stored),saved);
  }
  assert.equal(ifcReadToolsCompatible({...current,codeSha256:unknown},current),false);
  const path=process.env.ULPIN_IFC_PROFILE,hash=process.env.ULPIN_IFC_PROFILE_SHA256;
  try{delete process.env.ULPIN_IFC_PROFILE;delete process.env.ULPIN_IFC_PROFILE_SHA256;
    assert.throws(()=>assertIFCReadTools({...current,codeSha256:old.ifc[0]}),(e:any)=>e.status===503);
  }finally{if(path!==undefined)process.env.ULPIN_IFC_PROFILE=path;if(hash!==undefined)process.env.ULPIN_IFC_PROFILE_SHA256=hash;}
});
test('configured full IFC inventory permits old immutable tools/fusion reads but never writer launch',
  {skip:process.env.ULPIN_IFC_COMPATIBILITY_INVENTORY!=='1'},()=>{
  const current=ifcConfig();
  for(const codeSha256 of old.ifc){const stored={...current.pins,codeSha256};
    assert.equal(assertIFCReadTools(stored),undefined);
    verifyFusionIFCTools({tools:stored} as any,{deadlineAt:Date.now()+20000,signal:new AbortController().signal});
    assert.throws(()=>assertIFCTools(stored),(e:any)=>e.code==='IFC_TOOL_CHANGED');
  }
  assert.throws(()=>assertIFCReadTools({...current.pins,codeSha256:unknown}),(e:any)=>e.code==='IFC_TOOL_CHANGED');
  assert.throws(()=>assertIFCReadTools({...current.pins,codeSha256:old.ifc[0],profileSha256:unknown}),(e:any)=>e.code==='IFC_TOOL_CHANGED');
});
