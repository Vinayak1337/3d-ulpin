import test from 'node:test';
import assert from 'node:assert/strict';
import {assignApplicationIdentifiers,withApplicationIdentifiers} from '@ulpin/server/modules/spatial/identifiers/application-identifiers';
import {createSceneRecords} from '@ulpin/server/modules/spatial/identifiers/records';
function fixture(){return {objects:[{id:'p',type:'parcel',attributes:{ulpin:'00123456789ABC'}},{id:'a',type:'building',label:'First',attributes:{}},{id:'b',type:'building',label:'Second',attributes:{}},{id:'f',type:'floor',attributes:{level:-1}},{id:'unknown',type:'floor',attributes:{}}],relations:[{kind:'contains',fromId:'p',toId:'a'},{kind:'contains',fromId:'p',toId:'b'},{kind:'contains',fromId:'a',toId:'f'},{kind:'contains',fromId:'a',toId:'unknown'}],identifierAssertions:[{objectId:'a',scheme:'internal_3d',value:'DEMO-3D-A',status:'fictional'}]};}
test('source 2D IDs retain leading zeros, shared parcel returns both buildings; no missing IDs fabricated',()=>{
 const scene=fixture(),records=createSceneRecords(scene);
 assert.deepEqual(records.search('00123456789ABC').map(r=>r.buildingId),['a','b']);
 assert.equal(records.identity('a')?.twoDIds[0].value,'00123456789ABC');
 delete (scene.objects[0].attributes as any).ulpin;
 assert.equal(createSceneRecords(scene).identity('a')?.twoDIds.length,0);
});
test('assignment is stable across order and geometry edits; receipt namespace separates unrelated records',async()=>{
 const scene=fixture(),before=JSON.stringify(scene),first=await assignApplicationIdentifiers(scene,'receipt-1');
 assert.match(first[0].identifier,/^3D-[0-9A-HJKMNP-TV-Z]{14}$/);
 assert.equal(first.find(x=>x.objectId==='f')?.identifier,first[0].identifier+':-1');
 assert.equal(first.find(x=>x.objectId==='unknown'),undefined);
 const again=await assignApplicationIdentifiers({...scene,objects:[...scene.objects].reverse()},'receipt-1');
 assert.equal(again.find(x=>x.objectId==='a')?.identifier,first[0].identifier);
 assert.notEqual((await assignApplicationIdentifiers(scene,'receipt-2'))[0].identifier,first[0].identifier);
 const projected=withApplicationIdentifiers(scene,first),records=createSceneRecords(projected);
 assert.equal(records.search(first[0].identifier+':-1')[0].floorId,'f');
 assert.equal(records.search('DEMO-3D-A')[0].buildingId,'a');
 assert.equal(records.search(first[0].identifier)[0].buildingId,'a');
 assert.equal(JSON.stringify(scene),before);
});
test('duplicate explicit floor levels fail rather than selecting a different floor',async()=>{
 const scene=fixture();scene.objects.find(o=>o.id==='unknown')!.attributes={level:-1};
 await assert.rejects(()=>assignApplicationIdentifiers(scene,'receipt'),/Ambiguous 3D identity/);
});
test('all source-field aliases are accepted only as exact 14-character strings',()=>{
 for(const key of ['ULPIN','ulpin_2d','2d_ulpin','parcel_ulpin','parcel2dUlpIn','official_2d_ulpin']){
  const scene=fixture();scene.objects[0].attributes={[key]:'0123456789ABCD'};
  assert.equal(createSceneRecords(scene).identity('a')?.twoDIds[0].value,'0123456789ABCD');
  scene.objects[0].attributes={[key]:12345678901234} as any;
  assert.equal(createSceneRecords(scene).identity('a')?.twoDIds.length,0);
 }
});
