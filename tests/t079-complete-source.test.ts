import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeReferencePackage} from '../apps/web/features/spatial/reference-import/browser';
import {normalizeSourceFiles} from '../apps/web/features/spatial/reference-import/source-normalizer';
import {deriveSpatialChecks} from '../apps/web/features/spatial/reference-runtime/spatial-checks.js';
import {createSceneRecords} from '../apps/web/features/spatial/reference-runtime/records.js';
const path='apps/web/public/reference/lake-view-complete.zip';
const receipt=()=>readFile(path).then(b=>normalizeReferencePackage('lake-view-complete.zip',new Uint8Array(b)));
test('complete source upload reconstructs the same reference city, identities and conflicts',async()=>{
 const imported=await receipt(),original=await normalizeReferencePackage('showcase-anchor.zip',new Uint8Array(await readFile('apps/web/public/reference/showcase-anchor.zip')));
 const scene=deriveSpatialChecks(imported.render.scene),records=createSceneRecords(scene);
 assert.equal(scene.objects.filter((o:any)=>o.type==='building').length,49);
 for(const old of original.render.scene.geometries){const actual=scene.geometries.find((g:any)=>g.id===old.id);assert.deepEqual(actual?.coordinates,old.coordinates);assert.equal(actual?.baseElevationM,old.baseElevationM);assert.equal(actual?.heightM,old.heightM);}
 assert.equal(records.search('DEMO-3D-ANCHOR-B01:1')[0].floorId,'B01-F1');
 assert.equal(records.search('DEMO-2D-ANCHOR-P01')[0].buildingId,'B01');
 assert.equal(records.residents('B01-F1').length,2);
 const issues=scene.issues.filter((i:any)=>i.objectIds.includes('B01'));
 assert.ok(issues.some((i:any)=>i.code==='ROAD_OVERLAP'&&Math.abs(i.evidence.areaM2-21.6)<.001));
 assert.ok(issues.some((i:any)=>i.code==='OUTSIDE_PARCEL'));
 assert.equal(imported.receipt.files.has('normalized.json'),false);
 assert.ok(imported.receipt.files.has('MASTER_SCENE.json'));
 assert.ok(imported.receipt.files.has('normalized/source_assets.json'));
});
test('original formats, control coordinates, documents and separate rights survive normalization',async()=>{
 const {receipt:r,render}=await receipt();
 for(const suffix of ['.geojson','.gpkg','.csv','.pdf','.svg','.las','.laz','.tif','.jpg'])assert.ok([...r.files.keys()].some(p=>p.endsWith(suffix)),suffix);
 const b=render.scene.objects.find(o=>o.id==='B01')!;
 const rights=b.attributes?.rights as any[];assert.equal(rights.length,1);assert.equal(rights[0].partyName,'Fictional Owner B01');assert.equal(rights[0].status,'unreviewed');
 const source=render.scene.sourceRecords.find(s=>s.id===rights[0].sourceRecordId);assert.ok(source);
 assert.ok(b.sourceRecordIds.includes('record/records/fictional-property-schedule.pdf/asset'));
 assert.equal((render.scene.metadata.controlPoints as any[]).length,9);
 const lidar=render.scene.sources.find(s=>s.label.endsWith('.las'))!;assert.equal(lidar.processing,'retained');assert.equal(lidar.mimeType,'application/vnd.las');
 assert.ok(!render.scene.geometries.some(g=>g.sourceRecordIds.some(id=>id.includes('.las'))));
 for(const s of render.scene.sources){const bytes=r.files.get(String(s.originalUri).replace(/^dataset\//,''))!;assert.equal(bytes.length,s.byteSize);}
});
async function changedCsv(member:string,replace:(text:string)=>string){
 const {receipt:r}=await receipt();const files=new Map(r.files);const bytes=new TextEncoder().encode(replace(new TextDecoder().decode(files.get(member))));files.set(member,bytes);
 const manifest=JSON.parse(new TextDecoder().decode(files.get('source-manifest.json')));const entry=manifest.files.find((f:any)=>f.path===member);entry.bytes=bytes.length;entry.sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');files.set('source-manifest.json',new TextEncoder().encode(JSON.stringify(manifest)));return files;
}
test('bad party joins and mismatched survey frames fail without producing a draft',async()=>{
 const broken=await changedCsv('records/rights.csv',t=>t.replace('LV-PARTY-B01','MISSING-PARTY'));await assert.rejects(()=>normalizeSourceFiles(broken),/Invalid fictional right/);
 const datum=await changedCsv('gnss-cors-survey-control.csv',t=>t.replaceAll('LOCAL-LAKE-VIEW-DEMO-M','UNKNOWN-FRAME'));await assert.rejects(()=>normalizeSourceFiles(datum),/Control frame requires alignment/);
});
