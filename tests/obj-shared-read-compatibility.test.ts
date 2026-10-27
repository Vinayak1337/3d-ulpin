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

import {GLTF_CODE_FILES,gltfReadToolsCompatible} from '../packages/server/src/modules/usp/ingestion/gltf-config';

// Prevent shared OBJ job additions from invalidating accepted immutable reads.
// Exact observed receipt aggregates only; no runtime/native/persistence claim.
const previous=[
  [
    "3f8e872b66b74886e9850d99bb13b12877e15fcc39db7508d1acf10eeb079247",
    "b5db10a0e2b01c8d9941e99bb1a74d872185c0e80c7138ce8d023eb3d019a742",
    "3a34e3c2fbcfd34c78c50fab59f17c1ca8850453e056ae45b93699cee665d33b"
  ],
  [
    "6d317ec105921543d3ce17bff115969ee89d2e4cfaa22477843f9fa173526bbb",
    "c4192dbadeb7cbb819e97b00b53930577dee77e25b4f5500a4ccc9409de137e7",
    "ad211965366a915022bc1a1786c1a70b8745a5f02d996b65dcfa93a6fdff657b"
  ],
  [
    "16e65e18446b132b445eb133dcd67c0019179fc4a02351314a1d6a5c9e5a6e5b",
    "d010ddefa567afff305aa333458ca50cf5b338f4c6e9a812e5e3a15f54fbd5e4",
    "a5c1ae4cef4d54664d75a2f7fca03b53a8057025a2a3aa8e5e2f139ba8804df6"
  ],
  [
    "3ecd27225165fcb1bd5b76e9037c4792a35c9a15c79ad55647002e2026c7e1d5",
    "8310d1e8abd384dda09ccbdf5ba9d7836f189f34d9d4c250aaa7cf1f6e5fc2a3",
    "f353a0f10904b4e272660fe9da70005d9419e613581c475b1d08d93a2a221943"
  ],
  [
    "15b55b6192ecf8345dfd05c4bc117e4d6f33288886d785e9da781f17ee796eec",
    "f53fa951e99f578fe39f0b9e5c5b28ec2bc5636617d81f80c3f92df06cb9f2a8",
    "e138d4b36cbbcb91fd9b38aae35dec86c3923ab9021189829f9ca5b0836717f9"
  ],
  [
    "a65e70ab797791693b65d0d23c42389fe10248856022a1d9264210301908ba3b",
    "0dd2070c9001591fad9263e06203bc8d3f316f0277db8fb4552a9464a918514d",
    "a50cf2e380ad19770783ce9708ff76e10d90f68ab00962706b3a579dbfa060a2"
  ]
];
const readers=[
  [IFC_CODE_FILES,ifcReadToolsCompatible], [DXF_CODE_FILES,dxfReadToolsCompatible],
  [KML_CODE_FILES,kmlReadToolsCompatible], [CITYGML_CODE_FILES,citygmlReadToolsCompatible],
  [GEOPARQUET_CODE_FILES,geoparquetReadToolsCompatible], [GLTF_CODE_FILES,gltfReadToolsCompatible],
] as const;

test('pre-OBJ immutable aliases preserve exact non-code pins and verified current code',()=>{
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
