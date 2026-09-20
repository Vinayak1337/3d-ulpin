import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneRecords} from './records.js';

function fixture(){return {metadata:{classification:'synthetic'},objects:[
  {id:'plot',type:'parcel',label:'Plot'},
  {id:'home',type:'building',label:'Neem House',systemId:'3D-NEEM-17',attributes:{address:'17 Test Lane',floorCount:8}},
  {id:'third',type:'floor',label:'Third floor',systemId:'3D-NEEM-17:3',geometryId:null},
  {id:'room',type:'space',label:'Unit301',attributes:{occupants:[{id:'demo1',name:'Fictional Resident',role:'resident',classification:'synthetic',sourceRecordId:'row-7'}]}},
  {id:'unlinked',type:'floor',label:'Level with unknown ordinal',geometryId:null},
],relations:[{kind:'contains',fromId:'plot',toId:'home'},{kind:'contains',fromId:'home',toId:'third'},{kind:'contains',fromId:'third',toId:'room'}],identifierAssertions:[{objectId:'plot',scheme:'2d_ulpin',value:'DEMO-2D-0098',status:'fictional'}]};}

test('building, linked parcel and exact floor IDs resolve to canonical selection',()=>{
  const r=createSceneRecords(fixture());
  assert.equal(r.identity('home').primary,'3D-NEEM-17');
  assert.equal(r.identity('home').twoDIds[0].value,'DEMO-2D-0098');
  assert.equal(r.search('demo-2d-0098')[0].buildingId,'home');
  assert.deepEqual(r.search('3D-NEEM-17:3').map(h=>[h.buildingId,h.floorId,h.identifier]),[['home','third','3D-NEEM-17:3']]);
  assert.equal(r.search('test lane')[0].buildingId,'home');
});

test('source occupants retain scope, provenance and fictional classification without mutation',()=>{
  const scene=fixture(),before=JSON.stringify(scene),r=createSceneRecords(scene);
  const resident=r.residents('home')[0];
  assert.equal(resident.name,'Fictional Resident');assert.equal(resident.floorId,'third');assert.equal(resident.unitId,'room');
  assert.equal(resident.classification,'synthetic');assert.equal(resident.sourceRecordId,'row-7');
  assert.equal(r.residents('third').length,1);assert.equal(r.residents('plot').length,0);
  assert.equal(JSON.stringify(scene),before);
});

test('floorCount and label order never create floor identities or occupancy records',()=>{
  const r=createSceneRecords(fixture());
  assert.equal(r.floors('home').length,1);assert.equal(r.identity('unlinked').threeDId,null);
  assert.equal(r.residents('unlinked').length,0);assert.equal(r.search('').length,1);
  assert.equal(r.search('3D-NEEM-17:8').length,0);
});

test('canonical relation directions, multiple parcels and explicit internal assertions are supported',()=>{
  const scene=fixture();scene.relations=[{kind:'associated_parcel',fromId:'home',toId:'plot'},{kind:'part_of',fromId:'third',toId:'home'},{kind:'occupies_level',fromId:'room',toId:'third'}];
  scene.objects.push({id:'plot2',type:'parcel',label:'Second plot',attributes:{parcel2dDemoId:'DEMO-2D-SECOND'}});scene.relations.push({kind:'associated_parcel',fromId:'home',toId:'plot2'});
  scene.identifierAssertions.push({objectId:'third',scheme:'internal_3d',value:'SOURCE-3D:3',status:'fictional'});
  const r=createSceneRecords(scene);assert.equal(r.parcels('third').length,2);assert.equal(r.search('DEMO-2D-SECOND')[0].buildingId,'home');assert.equal(r.search('SOURCE-3D:3')[0].floorId,'third');assert.equal(r.residents('home')[0].unitId,'room');
});
