import assert from 'node:assert/strict';
import test from 'node:test';
import {mvtCodeSha,mvtReadCompilerCompatible} from '@ulpin/server/modules/usp/tiles/compiler';
import {fingerprint} from '@ulpin/server/modules/cases/domain';
import {PrivateMvtCompilerSchema,type PrivateMvtInput} from '../packages/contracts/src/usp/private-mvt';

// Actual compiler metadata from the retained bed80b6 generation, independently
// reconstructed from that release. No source records or geometry are fixtures.
const retained=PrivateMvtCompilerSchema.parse({
  codeSha256:'7ba0d09183675baa615a63a4f72add4f683bb83f1027321b2d61d09bb63fbc82',
  policySha256:'32ec71b4da66b81bb327a71b828b6ed4657cbdd697c7f2d2cf73c61978298e00',
  postgis:'POSTGIS="3.5.2 dea6d0a" [EXTENSION] PGSQL="170" GEOS="3.9.0-CAPI-1.16.2" PROJ="7.2.1 NETWORK_ENABLED=OFF URL_ENDPOINT=https://cdn.proj.org USER_WRITABLE_DIRECTORY=/var/lib/postgresql/.local/share/proj DATABASE_PATH=/usr/share/proj/proj.db" (compiled against PROJ 7.2.1) LIBXML="2.9.10" LIBJSON="0.15" LIBPROTOBUF="1.3.3" WAGYU="0.5.0 (Internal)" TOPOLOGY',
  sourceTransformSha256:'be1ac135a94abffa5cf29707de98f9fa1fcada8889c723349dd8c5c3531cea90',
  sourceCrs:'EPSG:4326',targetCrs:'EPSG:3857',axisOrder:'always_xy',verticalReference:null,
  sha256:'c36c3ea4d51fd52914fa89c602e36867c3132715b06836b535c21a3f7072c6f5',
});
function repin(changes:Partial<PrivateMvtInput['compiler']>){
  const {sha256:_,...base}={...retained,...changes};
  return PrivateMvtCompilerSchema.parse({...base,sha256:fingerprint(base)});
}
const current=repin({codeSha256:mvtCodeSha()});

// This concrete upgrade failure crosses the immutable-read/security boundary;
// these checks prevent a compatibility exception from admitting unknown profiles.
test('the exact retained profile reads after a code upgrade without rewriting any pins',()=>{
  const before=JSON.stringify(retained);
  assert.notEqual(current.codeSha256,retained.codeSha256);
  assert.equal(mvtReadCompilerCompatible(retained,current),true);
  assert.equal(JSON.stringify(retained),before);
  assert.equal(mvtReadCompilerCompatible(current,current,true),true);
});
test('the historical approval binds the complete original compiler and full-source mode',()=>{
  assert.equal(mvtReadCompilerCompatible(retained,current,true),false);
  assert.equal(mvtReadCompilerCompatible(repin({codeSha256:retained.policySha256}),current),false);
  assert.equal(mvtReadCompilerCompatible(repin({postgis:retained.postgis+' changed'}),current),false);
  assert.equal(mvtReadCompilerCompatible({...retained,sha256:retained.codeSha256},current),false);
  assert.equal(mvtReadCompilerCompatible(retained,{...current,sha256:retained.sha256}),false);
});
test('current policy and source transform remain required for historical reads',()=>{
  assert.equal(mvtReadCompilerCompatible(retained,repin({codeSha256:current.codeSha256,policySha256:retained.sourceTransformSha256})),false);
  assert.equal(mvtReadCompilerCompatible(retained,repin({codeSha256:current.codeSha256,sourceTransformSha256:retained.policySha256})),false);
});
test('an installed runtime change cannot rewrite the reviewed immutable compiler profile',()=>{
  assert.equal(mvtReadCompilerCompatible(retained,repin({codeSha256:current.codeSha256,postgis:retained.postgis+' changed'})),true);
});

const beforeDocument=repin({codeSha256:'3d060fda17b9cd542c4c8c2ffb29ad5fafb6cd28e34053235885ce13b3275656'});
test('the reviewed pre-document code reads complete and committed-prefix artifacts with every other pin exact',()=>{
  const before=JSON.stringify(beforeDocument);
  assert.equal(mvtReadCompilerCompatible(beforeDocument,current),true);
  assert.equal(mvtReadCompilerCompatible(beforeDocument,current,true),true);
  assert.equal(JSON.stringify(beforeDocument),before);
});
test('pre-document reads deny unknown code, tampered self-hashes, policy, transform and PostGIS drift',()=>{
  for(const prefix of [false,true]){
    assert.equal(mvtReadCompilerCompatible(repin({codeSha256:retained.sourceTransformSha256}),current,prefix),false);
    assert.equal(mvtReadCompilerCompatible({...beforeDocument,sha256:current.sha256},current,prefix),false);
    assert.equal(mvtReadCompilerCompatible(beforeDocument,{...current,sha256:beforeDocument.sha256},prefix),false);
    for(const changes of [{policySha256:retained.sourceTransformSha256},{sourceTransformSha256:retained.policySha256},{postgis:retained.postgis+' changed'}]){
      assert.equal(mvtReadCompilerCompatible(beforeDocument,repin({codeSha256:current.codeSha256,...changes}),prefix),false);
    }
  }
});
