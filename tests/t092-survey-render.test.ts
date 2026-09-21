import test from 'node:test';
import assert from 'node:assert/strict';
import {createSurveyLayers} from '../apps/web/features/spatial/reference-runtime/survey-layers';
import type {SurveyAsset} from '../apps/web/features/spatial/reference-import/survey-assets';
const base={id:'survey/test',kind:'dem',label:'DEM',sourceId:'source/test',sourcePath:'test.tif',sourceSha256:'a'.repeat(64),frameId:'frame/test',verticalReference:'benchmark',classification:'synthetic',sourceRevision:'1',minimum:0,maximum:3} as const;
test('source mesh uses ENU once, excludes no-data triangles and builds lazily',()=>{
 const asset:SurveyAsset={...base,width:2,height:2,affine:[1,0,10,0,-1,20],elevations:new Float32Array([0,1,2,3]),valid:new Uint8Array([1,1,1,0])};
 const layers=createSurveyLayers([asset]);assert.equal(layers.group.children.length,0);layers.show(asset.id);
 const mesh=layers.group.children[0] as any;assert.deepEqual(Array.from(mesh.geometry.attributes.position.array).slice(0,3),[10.5,0,-19.5]);assert.deepEqual(Array.from(mesh.geometry.index.array),[0,2,1]);
 layers.show(asset.id);assert.equal(layers.group.children.length,1);assert.equal(mesh.userData.sourceSha256,asset.sourceSha256);layers.show('model');assert.equal(layers.group.visible,false);
 mesh.geometry.dispose();mesh.material.dispose();
});
test('point-cloud coordinates come from the source and mesh disposal is ordinary Three ownership',()=>{
 const asset:SurveyAsset={...base,kind:'lidar',positions:new Float32Array([10,20,3]),colors:new Uint8Array([100,150,200]),pointCount:1,displayedPoints:1};
 const layers=createSurveyLayers([asset]);layers.show(asset.id);const points=layers.group.children[0] as any;assert.deepEqual(Array.from(points.geometry.attributes.position.array),[10,3,-20]);assert.deepEqual(Array.from(asset.positions!),[10,20,3]);assert.equal(points.userData.role,'source_visualization_not_extracted_building');points.geometry.dispose();points.material.dispose();
});
