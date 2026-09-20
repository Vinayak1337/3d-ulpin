import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeReferencePackage} from '../apps/web/features/spatial/reference-import/browser';
import {normalizePresentation} from '../apps/web/features/spatial/reference-import/presentation';

test('shared browser path verifies original ZIP, builds canonical candidate and derives display',async()=>{
 const bytes=new Uint8Array(await readFile('design/reference-map-v5/data/neem-reference-dataset.zip'));
 const result=await normalizeReferencePackage('scene.zip',bytes);
 assert.equal(result.canonical.input.schemaVersion,'ulpin-spatial/2');
 assert.equal(result.render.scene.projectionVersion,'ulpin-reference-render/1');
 assert.equal(result.presentation?.canonicalSnapshotDigest,result.render.scene.canonicalSnapshotDigest);
 assert.deepEqual(result.receipt.originalBytes,bytes);
 assert.equal(result.render.scene.objects.length,196);
 assert.equal(result.presentation?.decoration.trees?.length,2);
 assert.equal(result.render.scene.objects.filter(o=>o.type==='utility'&&o.geometryId===null).length,2);
});
test('display sidecar excludes cadastral decisions and rejects invalid placement',()=>{
 const value={classification:'synthetic_visual_decoration',trees:[[2,3]],rights:{owner:'not display data'},conflict:true};
 const result=normalizePresentation(value,'digest',[0,0,10,10],new Set());
 assert.equal(result?.schemaVersion,'ulpin-presentation/1');assert.equal('rights' in result!.decoration,false);assert.equal('conflict' in result!.decoration,false);
 assert.throws(()=>normalizePresentation({...value,trees:[[1e9,0]]},'digest',[0,0,10,10],new Set()),/outside/);
 assert.throws(()=>normalizePresentation({...value,buildingStyles:{unknown:{palette:1}}},'digest',[0,0,10,10],new Set()),/unknown object/);
});
