import assert from 'node:assert/strict';
import test from 'node:test';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {semanticPublisherSha,semanticPublisherReadCompatible} from '../packages/server/src/modules/usp/ingestion/semantic-chunks';
import {mvtCodeSha,mvtReadCompilerCompatible} from '../packages/server/src/modules/usp/tiles/compiler';
import {ifcReadToolsCompatible,assertIFCReadTools} from '../packages/server/src/modules/usp/ingestion/ifc-config';
import {dxfReadToolsCompatible,assertDXFReadTools} from '../packages/server/src/modules/usp/ingestion/dxf-config';
import {kmlReadToolsCompatible,assertKMLReadTools} from '../packages/server/src/modules/usp/ingestion/kml-config';
import {citygmlReadToolsCompatible,assertCityGMLReadTools} from '../packages/server/src/modules/usp/ingestion/citygml-config';
import {PrivateMvtCompilerSchema} from '../packages/contracts/src/usp';
// Independently reconstructed exact 409d2641 code pins; technical controls, no historic runtime repair.
const old={"ifc": ["2d1ec8e223c7124196237b7d33c84be37d5a202cb9b11515f3d510962ba8ff79", "9e5771204c653c37598ac52e3d2e555b1875a7e9bf7ad565c959bde8d0233c6e"], "dxf": ["d6ff578327b1edc6906f862fb559f0d573507a643e551115b15ed14380cd4541", "01b22fb44f4ce88a8d372c5c8a4ffd94885da76268b4fe1fa24e3de5f2de6ad1"], "kml": ["5c4d50085d0b16ae656c35b6684f6a81eba6cd83728f9fe7d34562847ff2ec41", "a80fef5011b91c23dfb28bc201a0a1c1432f03b38e01a522d5038672b25d7c61"], "citygml": ["e9d559731bfc4a37a4f7388427f80c7c88df40a5286746d1d078f2ffb7fee308", "319041a906b31bca05e1386c992e5a5ca8bad15062930d9b9ab0880e8074408d"], "mvt": ["4d59027d16b1bacc5a9145ae6b98d9ae4a1e343020aaab9db84cfc11b132dc0b", "5066ec961fdf3e56796fe581c1b8708e11d62b72488f711988b9d40f85b5b788"], "semantic": ["a34189b6a8fd60c58340ddc622f680c69d0705d44ab4e78e04f5cc6a122ad1c5", "e45f2695f016a6e84c1cc225e2cd10dd1f3f0ebd29552cbb42175d8ff5a80eeb"]},unknown='0'.repeat(64);
test('pre-GeoParquet IFC/DXF/KML immutable reads require exact non-code tools and current inventory',()=>{
 const current={platform:'windows-x86_64' as const,pythonSha256:unknown,profileSha256:unknown,readerSha256:unknown,
   supervisorSha256:unknown,dependencyLockSha256:unknown,codeSha256:'1'.repeat(64)};
 for(const [name,compare,read] of [['IFC',ifcReadToolsCompatible,assertIFCReadTools],['DXF',dxfReadToolsCompatible,assertDXFReadTools],['KML',kmlReadToolsCompatible,assertKMLReadTools],['CITYGML',citygmlReadToolsCompatible,assertCityGMLReadTools]] as const){
   for(const codeSha256 of old[name.toLowerCase() as 'ifc'|'dxf'|'kml'|'citygml']){
     const stored={...current,codeSha256},saved=JSON.stringify(stored);assert.equal(compare(stored,current),true);
     for(const key of ['pythonSha256','profileSha256','readerSha256','supervisorSha256','dependencyLockSha256'] as const)
       assert.equal(compare({...stored,[key]:'2'.repeat(64)},current),false);
     assert.equal(compare({...stored,codeSha256:unknown},current),false);assert.equal(JSON.stringify(stored),saved);
     const key='ULPIN_'+name+'_PROFILE',hashKey=key+'_SHA256',profile=process.env[key],hash=process.env[hashKey];
     try{delete process.env[key];delete process.env[hashKey];assert.throws(()=>read(stored),(e:any)=>e.status===503);}
     finally{if(profile!==undefined)process.env[key]=profile;if(hash!==undefined)process.env[hashKey]=hash;}
   }
 }
});
test('pre-GeoParquet semantic/MVT reads preserve exact runtime/policy/transform and refuse unknown code',()=>{
 for(const stored of old.semantic){assert.equal(semanticPublisherReadCompatible(stored),true);assert.equal(semanticPublisherReadCompatible(stored,unknown),false);}
 assert.equal(semanticPublisherReadCompatible(unknown),false);assert.equal(semanticPublisherReadCompatible(semanticPublisherSha()),true);
 const base={codeSha256:mvtCodeSha(),policySha256:unknown,postgis:'controlled runtime',sourceTransformSha256:unknown,
   sourceCrs:'EPSG:4326',targetCrs:'EPSG:3857',axisOrder:'always_xy',verticalReference:null};
 const pin=(patch:any)=>{const v={...base,...patch};return PrivateMvtCompilerSchema.parse({...v,sha256:fingerprint(v)});},current=pin({});
 for(const codeSha256 of old.mvt){const stored=pin({codeSha256});
   for(const prefix of [true,false]){
     assert.equal(mvtReadCompilerCompatible(stored,current,prefix),true);
     for(const patch of [{postgis:'changed'},{policySha256:'1'.repeat(64)},{sourceTransformSha256:'1'.repeat(64)},{codeSha256:unknown}])
       assert.equal(mvtReadCompilerCompatible(stored,pin(patch),prefix),false);
     assert.equal(mvtReadCompilerCompatible({...stored,sha256:unknown},current,prefix),false);
   }
 }
});
