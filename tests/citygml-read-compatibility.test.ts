import assert from 'node:assert/strict';
import test from 'node:test';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {semanticPublisherSha,semanticPublisherReadCompatible} from '../packages/server/src/modules/usp/ingestion/semantic-chunks';
import {mvtCodeSha,mvtReadCompilerCompatible} from '../packages/server/src/modules/usp/tiles/compiler';
import {ifcReadToolsCompatible,assertIFCReadTools} from '../packages/server/src/modules/usp/ingestion/ifc-config';
import {dxfReadToolsCompatible,assertDXFReadTools} from '../packages/server/src/modules/usp/ingestion/dxf-config';
import {kmlReadToolsCompatible,assertKMLReadTools} from '../packages/server/src/modules/usp/ingestion/kml-config';
import {PrivateMvtCompilerSchema} from '../packages/contracts/src/usp';
// Independently reconstructed exact 0b209ca3 code pins; technical controls, no historic runtime repair.
const old={"ifc": ["18a0bc3c1f01fffd338e122b3d028f438dd2f7459377e228a9ae1a94c33e93ed", "06bc6b13fcaae405d4d1390a8a13703f716d05ac3aa2f152679f8047927ae519"], "dxf": ["dbcfe71ae8bac243f6c3aa1b1f549b54b43535aa6c68fa743bdd552f8f897c46", "0f16979a1d9206f99d2e99358932e6f50183a517ef3efd2a0b8f6e0b53b6795f"], "kml": ["fabb23dcf90b0a0f5af81a258538f3202c56260ddc2a92d8a23cb3b6375b885d", "c41f64137609c74fd2f8f04247df9b8d49fa84d34bc2c780b39ba9c72f80cf13"], "mvt": ["8e50f24dff2f78fe6681b76667dc29ec727c9ac377329886fe29a4807aafd532", "b635803489804a2da5778a3dc3dbbfb31f3bab15dd8baf04c204d5e5f5034654"], "semantic": ["35c11ba89f22268f858c11599ac930f88fa3af2c6e5f2d51bf6a2b9dda240d24", "fd4ab52af946b2be387e3619faf7003657ebe666a111ede66f03f5170bf19252"]},unknown='0'.repeat(64);
test('pre-CityGML IFC/DXF/KML immutable reads require exact non-code tools and current inventory',()=>{
 const current={platform:'windows-x86_64' as const,pythonSha256:unknown,profileSha256:unknown,readerSha256:unknown,
   supervisorSha256:unknown,dependencyLockSha256:unknown,codeSha256:'1'.repeat(64)};
 for(const [name,compare,read] of [['IFC',ifcReadToolsCompatible,assertIFCReadTools],['DXF',dxfReadToolsCompatible,assertDXFReadTools],['KML',kmlReadToolsCompatible,assertKMLReadTools]] as const){
   for(const codeSha256 of old[name.toLowerCase() as 'ifc'|'dxf'|'kml']){
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
test('pre-CityGML semantic/MVT reads preserve exact runtime/policy/transform and refuse unknown code',()=>{
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
