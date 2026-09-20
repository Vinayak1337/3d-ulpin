import test from 'node:test';
import assert from 'node:assert/strict';
import {localOrbitState} from '../apps/web/features/spatial/data/local-session';
const view={selectedId:'unrelated-id',activeConflictId:'check-1',mode:'2d',floor:'floor-3',space:'unit-4',floorMode:'isolate',labels:false,railTab:'findings',inspectorTab:'sources',inspectorOpen:false,section:true,sectionHeight:107.2,layers:{publicLand:false,roads:true},camera:{position:[10,120,30],target:[0,106,0],perspectiveOffset:[20,30,40],zoom:2,orthoHalfHeight:50}};
test('local session preserves independent identity, tools and named-frame camera without aliasing',()=>{
 const saved=localOrbitState(view,'LOCAL-FRAME','digest')!;
 assert.equal(saved.kind,'engineering-orbit');assert.equal(saved.frameId,'LOCAL-FRAME');assert.equal(saved.snapshotDigest,'digest');
 for(const key of ['selectedId','floor','space','floorMode','labels','railTab','inspectorTab','inspectorOpen','sectionHeight'] as const)assert.equal(saved.view[key],view[key]);
 assert.deepEqual(saved.view.camera,view.camera);assert.notEqual(saved.view.camera.position,view.camera.position);assert.deepEqual(saved.view.layers,{publicLand:false,roads:true});
});
test('geodetic or invalid cameras cannot become local orbit sessions',()=>{
 for(const camera of [{longitude:77,latitude:28,height:120},{...view.camera,position:[NaN,0,0]},{...view.camera,zoom:0},{...view.camera,target:[0,100001,0]}])assert.equal(localOrbitState({...view,camera},'F','D'),null);
 const saved=localOrbitState({...view,railTab:'unknown',inspectorTab:'unknown',layers:{roads:true,execute:true}},'F','D')!;
 assert.equal(saved.view.railTab,'layers');assert.equal(saved.view.inspectorTab,'overview');assert.deepEqual(saved.view.layers,{roads:true});
});
