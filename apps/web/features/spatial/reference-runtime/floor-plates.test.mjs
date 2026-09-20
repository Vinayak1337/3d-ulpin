import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildReferenceFloorPlate } from './map.js';
const ring = (x,y,w,h) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const floor = { id:'g-floor',frameId:'local',type:'Polygon',baseElevationM:100,heightM:3,coordinates:[ring(0,0,10,10),ring(3,3,4,4)] };
const area = geometry => { const p=geometry.attributes.position,index=geometry.index;let result=0;for(let i=0;i<index.count;i+=3){const a=new THREE.Vector3().fromBufferAttribute(p,index.getX(i)),b=new THREE.Vector3().fromBufferAttribute(p,index.getX(i+1)),c=new THREE.Vector3().fromBufferAttribute(p,index.getX(i+2));result+=b.sub(a).cross(c.sub(a)).length()/2;}return result; };
const dispose = result => result.group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
test('floor plate preserves courtyard area and leaves hole unpickable',()=>{
 const result=buildReferenceFloorPlate(floor,[],{objectId:'building',floorId:'floor'});
 assert.equal(result.available,true);assert.equal(result.pickables.length,1);assert.equal(area(result.pickables[0].geometry),84);
 result.group.updateMatrixWorld(true);
 const ray=new THREE.Raycaster(new THREE.Vector3(5,10,-5),new THREE.Vector3(0,-1,0));assert.equal(ray.intersectObjects(result.pickables).length,0);
 ray.set(new THREE.Vector3(1,10,-1),new THREE.Vector3(0,-1,0));assert.ok(ray.intersectObjects(result.pickables).length);
 const fins=result.group.children.filter(o=>o.userData.role==='diagram_boundary_not_measured_wall');assert.equal(fins.length,4);assert.ok(fins.every(o=>o.userData.displayOnly));dispose(result);
});
test('multipart keeps disconnected and concave source components, without mutating input',()=>{
 const geometry={...floor,type:'MultiPolygon',coordinates:[floor.coordinates,[[[20,0],[24,0],[24,2],[22,2],[22,4],[20,4],[20,0]]]]};const original=JSON.stringify(geometry);
 const result=buildReferenceFloorPlate(geometry,[],{floorId:'same-floor'});assert.equal(result.pickables.length,2);assert.equal(result.pickables.reduce((n,m)=>n+area(m.geometry),0),96);assert.ok(result.pickables.every(m=>m.userData.floorId==='same-floor'));assert.equal(JSON.stringify(geometry),original);dispose(result);
});
test('unit outlines require supplied polygons in the same frame; no schedule-only rooms',()=>{
 const units=[{object:{id:'u1'},geometry:{...floor,id:'g-u1',coordinates:[ring(0,0,3,3)]}},{object:{id:'u2'},geometry:null},{object:{id:'u3'},geometry:{...floor,frameId:'other'}}];
 const result=buildReferenceFloorPlate(floor,units,{floorId:'f'});assert.equal(result.unitCount,1);assert.equal(result.unavailableUnitCount,2);const meshes=result.pickables.filter(m=>m.userData.unitId);assert.equal(meshes.length,1);assert.equal(meshes[0].userData.unitId,'u1');assert.equal(area(meshes[0].geometry),9);dispose(result);
});
test('missing geometry or placement creates no plate and no invented level',()=>{
 for(const geometry of [null,{...floor,baseElevationM:null}]){const result=buildReferenceFloorPlate(geometry);assert.equal(result.available,false);assert.equal(result.group.children.length,0);}
});
