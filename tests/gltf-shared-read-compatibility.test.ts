import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {settings} from '../packages/server/src/infrastructure/config';
import {IFC_CODE_FILES,ifcReadToolsCompatible} from '../packages/server/src/modules/usp/ingestion/ifc-config';
import {DXF_CODE_FILES,dxfReadToolsCompatible} from '../packages/server/src/modules/usp/ingestion/dxf-config';
import {KML_CODE_FILES,kmlReadToolsCompatible} from '../packages/server/src/modules/usp/ingestion/kml-config';
import {CITYGML_CODE_FILES,citygmlReadToolsCompatible} from '../packages/server/src/modules/usp/ingestion/citygml-config';
import {GEOPARQUET_CODE_FILES,geoparquetReadToolsCompatible} from '../packages/server/src/modules/usp/ingestion/geoparquet-config';

// Exact Git/LF and observed staging physical aggregates independently matched
// against the GLTF-02 receipt before integrating its jobs.ts addition.
// Pure compatibility controls; no native process, runtime repair or DB claim.
const previous=[
  ['1a539bf0cfb49cd6f509a80c7275449472913ff9a3c4fdae0a5af842e1d1cc8c','4572b5ce43aa23c41f3db16744e1f93e7eb1c247f09a03fd880f508b22500a5d'],
  ['6443d8f0b3fa7f1a9e5c97a5bcc0df7858e2b29f1808260aca55643e651b6233','357bc91b6b59623dce9162ad5063dbc89244980600632b5f6b00c9a23ea37e4d'],
  ['6b06ed791345f3d211f2c6ebb5829698ffa033db9ecacaf673e03d58e71671fa','835f9145d85a167dc601d9ca6371a7a2a5c02a29fcc325adee44f77815f8ed8d'],
  ['0d98f4d86b8118a9029d72ecb23e330f28aaa2167424ee7b49b7308e3a0ef181','07ff9352c85b53d5ca2a13df21182e93607e2b93d4ae3e7aa6cf16adcf5518fd'],
  ['d3cbd3d803b71152a09bd00a8918bc593dbb627ffa9453f14b9ba86d71300037','0c543e85652e0ef3f74f46ac44ddd7fcf9464bc01b5f765ef6103193bb16acf5'],
];
const readers=[
  [IFC_CODE_FILES,ifcReadToolsCompatible], [DXF_CODE_FILES,dxfReadToolsCompatible],
  [KML_CODE_FILES,kmlReadToolsCompatible], [CITYGML_CODE_FILES,citygmlReadToolsCompatible],
  [GEOPARQUET_CODE_FILES,geoparquetReadToolsCompatible],
] as const;

test('pre-glTF immutable aliases preserve exact non-code pins and verified current code',()=>{
  const zero='0'.repeat(64),other='f'.repeat(64);
  for(const [index,[files,compatible]] of readers.entries()){
    const current={platform:'windows-x86_64' as const,pythonSha256:zero,profileSha256:zero,
      readerSha256:zero,supervisorSha256:zero,dependencyLockSha256:zero,
      codeSha256:fingerprint(files.map(path=>({path,sha256:sha256(readFileSync(join(settings.repositoryRoot,path)))})))};
    for(const codeSha256 of previous[index]){
      const stored={...current,codeSha256},before=JSON.stringify(stored);
      assert.equal(compatible(stored,current),true);
      assert.equal(compatible({...stored,readerSha256:other},current),false);
      assert.equal(compatible(stored,{...current,codeSha256:other}),false);
      assert.equal(JSON.stringify(stored),before);
    }
    assert.equal(compatible({...current,codeSha256:other},current),false);
  }
});
