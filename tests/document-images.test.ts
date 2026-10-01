import assert from 'node:assert/strict';
import test from 'node:test';
import type {PoolClient} from 'pg';
import {DocumentImagesService,documentImageAuthorityTx,type DocumentImageAuthority} from '../packages/server/src/modules/usp/ingestion/document-images';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {AppError} from '../packages/server/src/infrastructure/errors';

// Technical authority/transport controls; no operational records are created.
const sourceId='174da4ed-bb83-4726-bd2d-d3f53578de11',caseId='b4d629b1-b948-4ba6-900b-28e4c2bf2458';
const original=Buffer.from('technical original image authority'),hash=sha256(original),pin={revision:'1',sha256:hash};
const authority:DocumentImageAuthority={sourceId,caseId,caseRevision:1,sourceRevision:1,sourceSha256:hash,
  sourceBytes:original.length,objectKey:'private-technical-key',name:'Technical image',format:'png',authoritySha256:'1'.repeat(64)};
const image={format:'png' as const,mode:'RGBA',frame:{kind:'image_source_top_left_pixels' as const,width:1,height:1},frameCount:1 as const,
  orientation:{exifValue:null,applied:1,provenance:'specification_default' as const},
  densityDeclarations:[],
  color:{embeddedIcc:false,declaredSrgb:null,transparency:'supplied' as const},unsupportedReason:null,
  display:{frame:{kind:'image_display_top_left_pixels' as const,width:1,height:1},sourceToRaster:[1,0,0,0,1,0] as [number,number,number,number,number,number],
    coordinateConvention:'pixel_edges/1' as const,mode:'RGBA' as const,resampling:'none' as const,colorInterpretation:'encoded_samples_unmanaged' as const}};
const metadata={version:'document-image-local/1' as const,sourceSha256:hash,sourceBytes:original.length,image,render:null};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const raster={...metadata,render:{sha256:sha256(png),bytes:png.length}};
const error=(status:number,code:string)=>(v:unknown)=>v instanceof AppError&&v.status===status&&v.code===code;
function service(overrides:Partial<ConstructorParameters<typeof DocumentImagesService>[0]>={}){
  return new DocumentImagesService({authorize:async()=>structuredClone(authority),original:async()=>original,
    inspect:async(_a,_b,render)=>({result:structuredClone(render?raster:metadata),...(render?{png}: {})}),...overrides});
}

test('image authority reuses private subject/case/current family and exact original pins',async()=>{
  const previous=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='technical-image-owner';
  let subject='technical-image-owner',archived=false,latest=1,format='png';
  const client={query:async(sql:string)=>{
    if(sql.startsWith('SELECT case_id FROM sources'))return {rows:[{case_id:caseId}]};
    if(sql.startsWith('SELECT id,revision,archived'))return {rows:[{id:caseId,revision:1,archived,frame:{id:'UNASSIGNED'},context:[],site_id:null}]};
    if(sql.startsWith('SELECT * FROM sources'))return {rows:[{id:sourceId,case_id:caseId,family_id:sourceId,revision:1,name:'Technical image',bytes:String(original.length),sha256:hash,object_key:'private-technical-key',
      inspection:{documentOriginal:{version:'source-document/1',format,subject,bytes:original.length,sha256:hash,receivedAt:'2026-10-01T00:00:00Z'}}}]};
    if(sql.startsWith('SELECT max(revision)'))return {rows:[{revision:latest}]};
    throw new Error('Unexpected authority SQL');
  }} as unknown as PoolClient;
  try{
    assert.equal((await documentImageAuthorityTx(client,sourceId,{revision:1,sha256:hash})).format,'png');
    format='jpeg';assert.equal((await documentImageAuthorityTx(client,sourceId,{revision:1,sha256:hash})).format,'jpeg');
    format='pdf';await assert.rejects(documentImageAuthorityTx(client,sourceId,{revision:1,sha256:hash}),error(422,'DOCUMENT_IMAGE_FORMAT_REQUIRED'));format='png';
    latest=2;await assert.rejects(documentImageAuthorityTx(client,sourceId,{revision:1,sha256:hash}),error(409,'STALE_REVISION'));latest=1;
    await assert.rejects(documentImageAuthorityTx(client,sourceId,{revision:2,sha256:hash}),error(409,'STALE_REVISION'));
    subject='other-owner';await assert.rejects(documentImageAuthorityTx(client,sourceId,{revision:1,sha256:hash}),error(403,'DOCUMENT_DENIED'));subject='technical-image-owner';
    archived=true;await assert.rejects(documentImageAuthorityTx(client,sourceId,{revision:1,sha256:hash}),error(403,'DOCUMENT_DENIED'));
  }finally{if(previous===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=previous;}
});

test('private image projection distinguishes absent EXIF/default and unsupported display with null calibration',async()=>{
  let checks=0;const result=await service({authorize:async()=>{checks++;return authority;}}).image(sourceId,pin);
  assert.equal(checks,3);assert.equal(result.calibration,null);assert.equal(result.image.orientation.exifValue,null);
  assert.equal(result.image.orientation.provenance,'specification_default');assert(!JSON.stringify(result).includes('private-technical-key'));
  assert.equal(result.url,`/api/v1/sources/${sourceId}/image/raster?revision=1&sha256=${hash}`);
  const unsupported={...image,color:{...image.color,embeddedIcc:true},display:null,unsupportedReason:'unsupported_color_profile' as const};
  const unavailable=await service({inspect:async()=>({result:{...metadata,image:unsupported}})}).image(sourceId,pin);
  assert.equal(unavailable.url,null);assert.equal(unavailable.image.unsupportedReason,'unsupported_color_profile');
});

test('post-I/O and post-decode changes/revocation prevent publication; caller paths/URLs require rejection before decode',async()=>{
  for(const at of [2,3]){let checks=0,decoded=false;
    await assert.rejects(service({authorize:async()=>++checks===at?{...authority,authoritySha256:'2'.repeat(64)}:authority,
      inspect:async()=>{decoded=true;return {result:metadata};}}).image(sourceId,pin),error(409,'STALE_REVISION'));
    assert.equal(decoded,at===3);
  }
  let checks=0;await assert.rejects(service({authorize:async()=>{if(++checks===3)throw new AppError(403,'DOCUMENT_DENIED','Technical revocation');return authority;}}).raster(sourceId,pin),error(403,'DOCUMENT_DENIED'));
  let decoded=false;const s=service({inspect:async()=>{decoded=true;return {result:metadata};}});
  for(const bad of [{revision:'1'},{...pin,path:'C:/caller.png'},{...pin,url:'https://caller.invalid/image'},{...pin,revision:'9007199254740992'}])
    await assert.rejects(s.image(sourceId,bad));
  assert.equal(decoded,false);
});

test('source/format/PNG/affine mismatches cannot publish and a completed failure releases the slot',async()=>{
  await assert.rejects(service({original:async()=>Buffer.from('changed')}).image(sourceId,pin),error(422,'DOCUMENT_IMAGE_SOURCE_INTEGRITY'));
  await assert.rejects(service({inspect:async()=>({result:{...metadata,image:{...image,format:'jpeg'}}})}).image(sourceId,pin),error(503,'DOCUMENT_IMAGE_RESULT_INTEGRITY'));
  await assert.rejects(service({inspect:async()=>({result:{...metadata,image:{...image,display:{...image.display,sourceToRaster:[1,0,100,0,1,0]}}}})}).image(sourceId,pin),error(503,'DOCUMENT_IMAGE_RESULT_INTEGRITY'));
  await assert.rejects(service({inspect:async()=>({result:raster,png:Buffer.from('corrupt')})}).raster(sourceId,pin),error(503,'DOCUMENT_IMAGE_RESULT_INTEGRITY'));
  assert.deepEqual((await service().raster(sourceId,pin)).bytes,png);
  let ready!:()=>void,release!:()=>void;const started=new Promise<void>(r=>ready=r),hold=new Promise<void>(r=>release=r);
  const pending=service({inspect:async()=>{ready();await hold;return {result:metadata};}}).image(sourceId,pin);await started;
  await assert.rejects(service().image(sourceId,pin),error(429,'DOCUMENT_IMAGE_BUSY'));release();await pending;
  assert.equal((await service().image(sourceId,pin)).image.format,'png');
});
