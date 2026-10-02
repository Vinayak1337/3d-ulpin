import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {PrivateMvtCompilerSchema,ProjectedVectorInputSchema,PROJECTED_VECTOR_PROFILE as p} from '../packages/contracts/src/usp';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {semanticPublisherSha,semanticPublisherReadCompatible} from '../packages/server/src/modules/usp/ingestion/semantic-chunks';
import {projectedParserSha,assertProjectedInput,assertProjectedReadInput} from '../packages/server/src/modules/usp/ingestion/projected-vector';
import {mvtCodeSha,mvtReadCompilerCompatible} from '../packages/server/src/modules/usp/tiles/compiler';
import {ifcConfig,assertIFCTools,assertIFCReadTools,ifcReadToolsCompatible} from '../packages/server/src/modules/usp/ingestion/ifc-config';
import {dxfConfig,assertDXFTools,assertDXFReadTools,dxfReadToolsCompatible} from '../packages/server/src/modules/usp/ingestion/dxf-config';
import {verifyFusionIFCTools} from '../packages/server/src/modules/usp/ingestion/source-fusion-ifc-authority';

// Exact fd36a4b9 Git/LF and retained physical aggregates; no property records.
const old={semantic:['aefcce46f18502786d2cc4c15ce0a306ec765045c5039afe78e5500866d19e3e','c32495d23f7df31384bc0ee83dea1481b34f9d1cbe92b8dbf2f32a99394e67cc'],
  mvt:['3cf0b3859a113d4ba24f708d1fa8fa9aad124ac45fd0d21ec69f953e213fb358','41bcb3aae67bc7b3c88016a8053db7747f469fc8d1c570157f8d6adf7bd06019'],
  ifc:['a441e6ac5d3947e4f267e63494685fada870384c6850c8c205dc8870ea0b68c8','3bd4f09e8a4bdfd2963e2e6c0ff735cdb423c3405e06694755f1f017bb585ac0']};
const oldDXF=["6d52384008e5aad896ec16defc76c607c905ca8e644fbb2661fd34c8285efa5c","1c00e8bbbac697ff41d71ebf6f81f0b4b18ad31aba005c9724d5ce01d2f95388"];
const unknown='0'.repeat(64);
test('pre-KML semantic reads preserve input pins while admission remains strict and unknown publishers deny',()=>{
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
test('pre-KML MVT reads require self-integrity and exact non-code pins',()=>{
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
test('pre-KML IFC comparison allows exact non-code tools only; missing full inventory denies reads',()=>{
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
  {skip:process.env.ULPIN_KML_COMPATIBILITY_INVENTORY!=='1'},()=>{
  const current=ifcConfig();
  for(const codeSha256 of old.ifc){const stored={...current.pins,codeSha256};
    assert.equal(assertIFCReadTools(stored),undefined);
    verifyFusionIFCTools({tools:stored} as any,{deadlineAt:Date.now()+20000,signal:new AbortController().signal});
    assert.throws(()=>assertIFCTools(stored),(e:any)=>e.code==='IFC_TOOL_CHANGED');
  }
  assert.throws(()=>assertIFCReadTools({...current.pins,codeSha256:unknown}),(e:any)=>e.code==='IFC_TOOL_CHANGED');
  assert.throws(()=>assertIFCReadTools({...current.pins,codeSha256:old.ifc[0],profileSha256:unknown}),(e:any)=>e.code==='IFC_TOOL_CHANGED');
});

test('pre-KML DXF comparison preserves exact non-code pins and current inventory is mandatory',()=>{
 const current={platform:'windows-x86_64' as const,pythonSha256:unknown,profileSha256:unknown,readerSha256:unknown,supervisorSha256:unknown,dependencyLockSha256:unknown,codeSha256:'1'.repeat(64)};
 for(const codeSha256 of oldDXF){const stored={...current,codeSha256};assert.equal(dxfReadToolsCompatible(stored,current),true);
 for(const key of ['pythonSha256','profileSha256','readerSha256','supervisorSha256','dependencyLockSha256'] as const)assert.equal(dxfReadToolsCompatible({...stored,[key]:'2'.repeat(64)},current),false);}
 assert.equal(dxfReadToolsCompatible({...current,codeSha256:unknown},current),false);
 const path=process.env.ULPIN_DXF_PROFILE,hash=process.env.ULPIN_DXF_PROFILE_SHA256;
 try{delete process.env.ULPIN_DXF_PROFILE;delete process.env.ULPIN_DXF_PROFILE_SHA256;assert.throws(()=>assertDXFReadTools({...current,codeSha256:oldDXF[0]}),(e:any)=>e.status===503);}
 finally{if(path!==undefined)process.env.ULPIN_DXF_PROFILE=path;if(hash!==undefined)process.env.ULPIN_DXF_PROFILE_SHA256=hash;}
});
test('configured full DXF inventory permits historical read but never new native execution',{skip:process.env.ULPIN_KML_COMPATIBILITY_INVENTORY!=='1'},()=>{
 const current=dxfConfig();for(const codeSha256 of oldDXF){const stored={...current.pins,codeSha256};assert.equal(assertDXFReadTools(stored),undefined);assert.throws(()=>assertDXFTools(stored),(e:any)=>e.code==='DXF_TOOL_CHANGED');}
 assert.throws(()=>assertDXFReadTools({...current.pins,codeSha256:unknown}),(e:any)=>e.code==='DXF_TOOL_CHANGED');
 assert.throws(()=>assertDXFReadTools({...current.pins,codeSha256:oldDXF[0],readerSha256:unknown}),(e:any)=>e.code==='DXF_TOOL_CHANGED');
});
