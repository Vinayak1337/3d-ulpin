import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePresentation} from '../apps/web/features/spatial/reference-import/presentation';

test('display sidecar excludes cadastral decisions and rejects invalid placement',()=>{
 const value={classification:'synthetic_visual_decoration',trees:[[2,3]],rights:{owner:'not display data'},conflict:true};
 const result=normalizePresentation(value,'digest',[0,0,10,10],new Set());
 assert.equal(result?.schemaVersion,'ulpin-presentation/1');assert.equal('rights' in result!.decoration,false);assert.equal('conflict' in result!.decoration,false);
 assert.throws(()=>normalizePresentation({...value,trees:[[1e9,0]]},'digest',[0,0,10,10],new Set()),/outside/);
 assert.throws(()=>normalizePresentation({...value,buildingStyles:{unknown:{palette:1}}},'digest',[0,0,10,10],new Set()),/unknown object/);
});
