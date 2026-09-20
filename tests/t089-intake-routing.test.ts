import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {intakeFileKind} from '../apps/web/lib/intake-file-kind';
const {zipSync}=createRequire(new URL('../apps/web/package.json',import.meta.url))('fflate');
const file=(name:string,data:Uint8Array)=>({name,size:data.length,arrayBuffer:async()=>new Uint8Array(data).buffer});
test('complete Lake View and supplied Shiv Vihar route to datasets irrespective of filename',async()=>{
 for(const path of ['lake-view-complete.zip','provided-master.zip'])assert.equal(await intakeFileKind(file('renamed.zip',await readFile('apps/web/public/reference/'+path))),'dataset');
});
test('Shapefile archives stay GIS and corrupt packages do not silently classify',async()=>{
 assert.equal(await intakeFileKind(file('survey.zip',zipSync({'survey.shp':new Uint8Array([0,1])}))),'gis');
 await assert.rejects(()=>intakeFileKind(file('bad.zip',new Uint8Array([1,2,3]))));
 assert.equal(await intakeFileKind(file('bad-manifest.zip',zipSync({'manifest.json':new TextEncoder().encode('bad')}))),'dataset');
});
test('documents, GeoJSON and normalized scenes retain separate routes',async()=>{
 const json=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
 assert.equal(await intakeFileKind(file('plan.pdf',new Uint8Array([1]))),'document');
 assert.equal(await intakeFileKind(file('geo.json',json({type:'FeatureCollection',features:[]}))),'gis');
 assert.equal(await intakeFileKind(file('scene.json',json({objects:[],geometries:[]}))),'dataset');
});
