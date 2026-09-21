import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeReferencePackage} from '../apps/web/features/spatial/reference-import/browser';
import {decodeLas,readSurveyAssets} from '../apps/web/features/spatial/reference-import/survey-assets';
const imported=normalizeReferencePackage('lake-view-complete.zip',new Uint8Array(await readFile('apps/web/public/reference/lake-view-complete.zip')));
test('verified Lake View binaries produce four aligned views without changing canonical records',async()=>{
 const r=await imported,{assets,diagnostics}=r.render.scene.survey;
 assert.deepEqual(diagnostics,[]);
 assert.deepEqual(assets.map(a=>a.kind),['lidar','imagery','dem','dsm']);
 const cloud=assets[0];assert.equal(cloud.pointCount,62886);assert.equal(cloud.displayedPoints,62886);assert.equal(cloud.positions?.length,62886*3);assert.equal(cloud.maximum,15.5);
 for(const a of assets){assert.ok(r.render.scene.sources.some(s=>s.id===a.sourceId&&s.originalSha256===a.sourceSha256));assert.equal(a.frameId,r.render.scene.frames[0].id);}
 const dem=assets[2],dsm=assets[3];assert.equal(dem.minimum,0);assert.equal(dem.maximum,0);assert.equal(dsm.maximum,15.5);assert.equal(dem.width,220);assert.equal(dem.height,230);assert.equal(dem.valid?.reduce((a,b)=>a+b,0),50600);
 assert.equal(assets[1].rgba?.length,220*230*4);assert.deepEqual(dsm.affine,[1,0,-26,0,-1,204]);
 assert.ok(!('survey' in r.canonical.source));assert.equal(r.render.scene.objects.filter(o=>o.type==='building').length,49);
});
test('LAS values come from bytes; compressed and truncated data are rejected',async()=>{
 const r=await imported,original=r.receipt.files.get('lidar/lake-view-pointcloud.las')!,bytes=new Uint8Array(original),v=new DataView(bytes.buffer),offset=v.getUint32(96,true),before=decodeLas(original);
 v.setInt32(offset,v.getInt32(offset,true)+1000,true);const after=decodeLas(bytes);assert.notEqual(after.positions[0],before.positions[0]);assert.deepEqual(decodeLas(original).positions,before.positions);
 assert.throws(()=>decodeLas(bytes.subarray(0,bytes.length-50)),/truncated/);
 bytes[104]|=128;assert.throws(()=>decodeLas(bytes),/Compressed LAZ/);
});
test('a different frame or benchmark stays unavailable rather than being overlaid',async()=>{
 const r=await imported,files=new Map(r.receipt.files);const path='normalized/elevation_surfaces.json',m=JSON.parse(new TextDecoder().decode(files.get(path)));m.records[0].coordinateFrame='UNRELATED';m.records[1].verticalReference='OTHER_DATUM';files.set(path,new TextEncoder().encode(JSON.stringify(m)));
 const result=await readSurveyAssets(files,r.render.scene.frames,r.render.scene.sources);assert.deepEqual(result.assets.map(a=>a.kind),['lidar','imagery']);assert.equal(result.diagnostics.length,2);
});
test('bad raster headers and metadata do not silently become imagery',async()=>{
 const r=await imported,files=new Map(r.receipt.files);files.set('imagery/lake-view-orthomosaic.tif',new Uint8Array([0,1,2,3]));
 const path='normalized/elevation_surfaces.json',m=JSON.parse(new TextDecoder().decode(files.get(path)));m.records[0].affineTransform[2]+=10;files.set(path,new TextEncoder().encode(JSON.stringify(m)));
 const result=await readSurveyAssets(files,r.render.scene.frames,r.render.scene.sources);assert.deepEqual(result.assets.map(a=>a.kind),['lidar','dsm']);assert.equal(result.diagnostics.length,2);assert.ok(result.diagnostics.some(d=>/alignment/.test(d.message)));
});
test('LAS CRS records require explicit alignment rather than silently trusting a sidecar',async()=>{
 const r=await imported,original=r.receipt.files.get('lidar/lake-view-pointcloud.las')!,before=new DataView(original.buffer,original.byteOffset,original.byteLength),header=before.getUint16(94,true),offset=before.getUint32(96,true);
 const bytes=new Uint8Array(original.length+54);bytes.set(original.subarray(0,header));bytes.set(original.subarray(header),header+54);const v=new DataView(bytes.buffer);v.setUint32(96,offset+54,true);v.setUint32(100,before.getUint32(100,true)+1,true);bytes.set(new TextEncoder().encode('LASF_Projection'),header+2);v.setUint16(header+18,2112,true);
 assert.throws(()=>decodeLas(bytes),/CRS definition/);
});
