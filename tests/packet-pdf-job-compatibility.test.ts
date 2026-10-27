import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {settings} from '../packages/server/src/infrastructure/config';
import {IFC_CODE_FILES,ifcReadToolsCompatible} from '../packages/server/src/modules/usp/ingestion/ifc-config';
import {DXF_CODE_FILES,dxfReadToolsCompatible} from '../packages/server/src/modules/usp/ingestion/dxf-config';
import {KML_CODE_FILES,kmlReadToolsCompatible} from '../packages/server/src/modules/usp/ingestion/kml-config';
import {CITYGML_CODE_FILES,citygmlReadToolsCompatible} from '../packages/server/src/modules/usp/ingestion/citygml-config';
import {GEOPARQUET_CODE_FILES,geoparquetReadToolsCompatible} from '../packages/server/src/modules/usp/ingestion/geoparquet-config';
import {mvtCodeSha,mvtReadCompilerCompatible} from '../packages/server/src/modules/usp/tiles/compiler';
import {semanticPublisherSha,semanticPublisherReadCompatible} from '../packages/server/src/modules/usp/ingestion/semantic-chunks';
import {PrivateMvtCompilerSchema} from '../packages/contracts/src/usp';

// Exact assigned-base aggregates frozen before modification; runtime fields below
// are technical predicate controls, never a configured inventory or native run.
const prePacket={
  ifc:['08d97a9d01afcca16ad651dd2d854544e5ab97b128cc49521247992178a18ec8','7cef4287ab8cd2c50a4f44e47e07fd115038ff3c2526a38306474d1165828a82'],
  dxf:['3908950565f0bf139c38d07c57b21eb5873e6acd60798457374f4e699b13c670','0dbd6d0f053968be658d456cdfb1d521e36d096244ef8bb926d91276d4d0b384'],
  kml:['6c1573a0a4ad3dc9561064444681121e73a956b10673d5627c9b621c5b3c363e','9c480acf3d7b0dd38f966b228835bbf141b50b7e650e04cbfbc26c1d8a746ab3'],
  citygml:['bdc3ae2758db333894aed1c4a664829c7e3f67ad6331982adaef16d7fc66be78','f6533370a70cb15c86b424e334eef6fad20d050ad0572f7c387772d6b5abd14c'],
  geoparquet:['a0ab2ac38fcd794177ed6c799515243207e4beeb31b9acc583442a31c6aae0a5','5c8567e7943c564990a28fca34679c23b113806f3f99663ae493fc56375acf58'],
  mvt:['5f1d1803ad9fdf8fee43a453e204723b91a3f987cd2832076eb4c36b99a5c3cc','79af89bcef0e32427eb341641673d895b9ef7c1c80d6436b36cdc321c293f6b4'],
  semantic:['f5abbdbabd56d2675bac74e033b1186803a869ea45fb20e0a80a692a9eaa45f9','3e70b8b75e1872c011f12a44d68cec924db0f9c6b6db6819ec7e5b79c33b93b4']};
const h=sha256('technical compatibility control'),changed=sha256('changed technical control');
test('packet job enrollment preserves only exact pre-packet immutable reader profiles and refuses non-code/current-code drift',()=>{
  for(const [name,paths,compare] of [['ifc',IFC_CODE_FILES,ifcReadToolsCompatible],['dxf',DXF_CODE_FILES,dxfReadToolsCompatible],
    ['kml',KML_CODE_FILES,kmlReadToolsCompatible],['citygml',CITYGML_CODE_FILES,citygmlReadToolsCompatible],
    ['geoparquet',GEOPARQUET_CODE_FILES,geoparquetReadToolsCompatible]] as const){
    const codeSha256=fingerprint(paths.map(path=>({path,sha256:sha256(readFileSync(settings.repositoryRoot+'/'+path))})));
    const current={platform:'windows-x86_64' as const,pythonSha256:h,profileSha256:h,readerSha256:h,
      supervisorSha256:h,dependencyLockSha256:h,codeSha256};
    for(const oldCode of prePacket[name]){
      const stored={...current,codeSha256:oldCode},original=JSON.stringify(stored);
      assert.equal(compare(stored,current),true);assert.notEqual(fingerprint(stored),fingerprint(current),'Strict writer full-pin equality remains false');
      assert.equal(compare({...stored,profileSha256:changed},current),false);
      assert.equal(compare(stored,{...current,codeSha256:changed}),false);
      assert.equal(compare({...stored,codeSha256:changed},current),false);assert.equal(JSON.stringify(stored),original);
    }
  }
  const currentCode=mvtCodeSha(),base={codeSha256:currentCode,policySha256:h,postgis:'technical runtime',sourceTransformSha256:h,
    sourceCrs:'EPSG:4326' as const,targetCrs:'EPSG:3857' as const,axisOrder:'always_xy' as const,verticalReference:null};
  const pin=(patch:any)=>{const v={...base,...patch};return PrivateMvtCompilerSchema.parse({...v,sha256:fingerprint(v)});};
  for(const codeSha256 of prePacket.mvt){const stored=pin({codeSha256});
    assert(mvtReadCompilerCompatible(stored,pin({}),true));assert(!mvtReadCompilerCompatible(stored,pin({postgis:'changed'}),true));
    assert(!mvtReadCompilerCompatible(stored,pin({codeSha256:changed}),true));assert.notEqual(stored.codeSha256,currentCode);
  }
  for(const stored of prePacket.semantic){assert(semanticPublisherReadCompatible(stored));assert(!semanticPublisherReadCompatible(stored,changed));
    assert.notEqual(stored,semanticPublisherSha(),'Strict current publisher remains different');}
});
