import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildArchitecture } from './architecture.js';
import { createEnvironment } from './environment.js';

const square = (x,y,size) => [[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]];
const building = {id:'different-building-id',type:'building',attributes:{floorCount:3}};
function architecture(geometry, options={}) {
  return buildArchitecture({ buildings:[building], geometryFor:()=>geometry, floorsFor:()=>[], ...options });
}
function downwardHits(group,x,y,altitude=200) {
  group.updateMatrixWorld(true);
  return new THREE.Raycaster(new THREE.Vector3(x,altitude,-y),new THREE.Vector3(0,-1,0)).intersectObject(group,true);
}
function surfaceArea(mesh) {
  const positions=mesh.geometry.attributes.position,indices=mesh.geometry.index;
  let area=0;
  for(let i=0;i<(indices?.count??positions.count);i+=3){
    const vertices=[0,1,2].map(offset=>new THREE.Vector3().fromBufferAttribute(positions,indices?indices.getX(i+offset):i+offset));
    area+=vertices[1].sub(vertices[0]).cross(vertices[2].sub(vertices[0])).length()/2;
  }
  return area;
}
function environment(objects,geometries,decoration={}) {
  return createEnvironment({metadata:{extent:[-10,-10,80,80]},objects,sceneDecoration:{ground:'paved',plotWalls:false,...decoration}},{THREE,geometryFor:object=>geometries[object.id],detail:'massing'});
}

test('multipart building preserves identity, courtyard void, separated parts and +100m base',()=>{
  const geo={id:'g-multipart',type:'MultiPolygon',coordinates:[[square(0,0,20),square(6,6,8)],[square(35,0,10)]],baseElevationM:100,heightM:12};
  const before=JSON.stringify(geo),result=architecture(geo);
  assert.equal(result.entries.size,1);
  const entry=result.entries.get(building.id);
  assert.equal(entry.segments.length,1);
  assert.equal(downwardHits(result.group,10,10).length,0,'courtyard remains open through every roof cap');
  assert.equal(downwardHits(result.group,28,5).length,0,'disconnected parts are not joined');
  assert.ok(downwardHits(result.group,40,5).length>0);
  assert.ok(result.pickables.every(mesh=>mesh.userData.objectId===building.id));
  assert.ok(entry.bounds.min.y>=99.999);
  assert.ok(entry.bounds.max.y>=111.8&&entry.bounds.max.y<112.1);
  assert.ok(entry.anchor.y>=114);
  assert.equal(JSON.stringify(geo),before,'source rings remain byte-equivalent');
  result.dispose();
});

test('unknown-height multipart building remains planar at source base',()=>{
  const result=architecture({id:'missing',type:'MultiPolygon',coordinates:[[square(0,0,4)],[square(10,0,4)]],baseElevationM:103,heightM:null});
  const entry=result.entries.get(building.id);
  assert.equal(entry.height,null);assert.equal(entry.segments.length,0);
  assert.equal(result.pickables.length,2);
  assert.ok(entry.bounds.max.y-entry.bounds.min.y<.03);
  assert.ok(entry.bounds.min.y>103);
  result.dispose();
});

test('multipart floor is one canonical floor segment with its own absolute base',()=>{
  const floor={id:'different-floor-id',type:'floor'},geo={id:'b',type:'Polygon',coordinates:[square(0,0,20)],baseElevationM:100,heightM:9};
  const floorGeo={id:'f',type:'MultiPolygon',coordinates:[[square(0,0,5)],[square(10,10,5)]],baseElevationM:106,heightM:3};
  const result=buildArchitecture({buildings:[building],geometryFor:object=>object===floor?floorGeo:geo,floorsFor:()=>[floor],detail:'massing'});
  const entry=result.entries.get(building.id);
  assert.equal(entry.segments.length,1);assert.equal(entry.segments[0].group.position.y,106);
  assert.ok(result.pickables.every(mesh=>mesh.userData.floorId===floor.id));
  assert.equal(downwardHits(result.group,8,8).length,0);
  assert.ok(downwardHits(result.group,12,12).length>0);
  result.dispose();
});

test('concave, courtyard and multipart road surfaces retain exact area and source elevation',()=>{
  const roads=[{id:'road-a',type:'road'},{id:'road-b',type:'road'}];
  const geos={
    'road-a':{id:'ra',type:'Polygon',coordinates:[[[0,0],[20,0],[20,5],[5,5],[5,20],[0,20],[0,0]]],baseElevationM:100},
    'road-b':{id:'rb',type:'MultiPolygon',coordinates:[[square(30,0,12),square(34,4,4)],[square(50,0,8)]],baseElevationM:104},
  };
  const before=JSON.stringify(geos),result=environment(roads,geos);
  const surfaces=result.layerRefs.roads.children.filter(mesh=>mesh.userData.displayRole==='source_surface');
  assert.equal(surfaces.length,3);
  assert.ok(Math.abs(surfaces.filter(m=>m.userData.objectId==='road-a').reduce((sum,m)=>sum+surfaceArea(m),0)-175)<1e-5);
  assert.ok(Math.abs(surfaces.filter(m=>m.userData.objectId==='road-b').reduce((sum,m)=>sum+surfaceArea(m),0)-192)<1e-5);
  assert.equal(surfaces[0].position.y,100.07);
  assert.equal(surfaces[1].position.y,104.07);
  assert.equal(downwardHits(result.layerRefs.roads,36,6).length,0,'road hole stays open');
  assert.equal(downwardHits(result.layerRefs.roads,12,12).length,0,'concave notch stays open');
  assert.equal(JSON.stringify(geos),before);
  result.dispose();
});

test('rotated rectangular road produces markings at its real angle without changing surface',()=>{
  const a=Math.PI/6,rotate=([x,y])=>[x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)];
  const ring=[[0,0],[40,0],[40,8],[0,8],[0,0]].map(rotate);
  const result=environment([{id:'rotated',type:'road'}],{rotated:{id:'g',type:'Polygon',coordinates:[ring],baseElevationM:50}});
  const surface=result.layerRefs.roads.children.find(mesh=>mesh.userData.displayRole==='source_surface');
  assert.ok(Math.abs(surfaceArea(surface)-320)<.0001);
  const markings=result.layerRefs.roads.children.filter(mesh=>mesh.userData.displayRole==='illustrative_road_marking');
  assert.equal(markings.length,1,'markings batch into one draw call per road');
  const position=markings[0].geometry.attributes.position;
  for(let i=0;i<position.count;i++){
    const x=position.getX(i),y=-position.getZ(i),u=x*Math.cos(a)+y*Math.sin(a),v=-x*Math.sin(a)+y*Math.cos(a);
    assert.ok(u>=0&&u<=40&&Math.abs(v-4)<.051,'marking remains aligned with rotated road center');
    assert.ok(Math.abs(position.getY(i)-50.12)<.00001);
  }
  result.dispose();
});

test('utility source corners stay exact and unknown diameters never become measured pipes',()=>{
  const objects=[{id:'pipe',type:'utility',attributes:{diameterM:.6}},{id:'unknown',type:'utility',attributes:{}}];
  const geos=Object.fromEntries(objects.map(object=>[object.id,{id:object.id+'-geometry',type:'LineString',coordinates:[[0,0,-2],[10,0,-2],[10,10,-5]]}]));
  const result=environment(objects,geos);
  const pipes=result.layerRefs.utilities.children.filter(mesh=>mesh.userData.objectId==='pipe');
  assert.equal(pipes.length,2);assert.ok(pipes.every(mesh=>mesh.geometry.parameters.radiusTop===.3));
  const expected=geos.pipe.coordinates.map(([x,y,z])=>new THREE.Vector3(x,z,-y));
  pipes.forEach((pipe,index)=>{
    const axis=new THREE.Vector3(0,pipe.geometry.parameters.height/2,0).applyQuaternion(pipe.quaternion);
    assert.ok(pipe.position.clone().sub(axis).distanceTo(expected[index])<1e-7);
    assert.ok(pipe.position.clone().add(axis).distanceTo(expected[index+1])<1e-7);
  });
  const alignment=result.layerRefs.utilities.children.find(mesh=>mesh.userData.objectId==='unknown');
  assert.ok(alignment.isLine);assert.equal(alignment.userData.displayRole,'alignment_only_unknown_diameter');
  assert.equal(alignment.geometry.attributes.position.count,3);
  result.dispose();
});

test('public land can be hidden independently of decorative landscape',()=>{
  const result=environment([{id:'park',type:'open_area'}],{park:{id:'park-shape',type:'Polygon',coordinates:[square(0,0,10)],baseElevationM:3}});
  assert.ok(result.layerRefs.publicLand.children.some(mesh=>mesh.userData.objectId==='park'));
  assert.equal(result.layerRefs.trees.children.some(mesh=>mesh.userData.objectId==='park'),false);
  result.layerRefs.publicLand.visible=false;
  assert.equal(result.layerRefs.trees.visible,true);
  result.dispose();
});
