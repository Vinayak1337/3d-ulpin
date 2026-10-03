import assert from 'node:assert/strict';
import test from 'node:test';
import {crc32,deflateSync} from 'node:zlib';
import {PacketImageRegionService,packetImageRegionTransform,type PacketImageRegionDependencies} from '../packages/server/src/modules/usp/packets/image-region';
import {DocumentImagesService,type DocumentImageAuthority} from '../packages/server/src/modules/usp/ingestion/document-images';
import {PacketImageRegionRequestSchema,PacketImageRegionProvenanceSchema,type PacketImageRegionSelection,
  type PacketImageRegionWorker} from '../packages/contracts/src/packet-image-region';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {AppError} from '../packages/server/src/infrastructure/errors';

// Technical transport/authority controls only; these bytes are not operational originals.
const sourceId='174da4ed-bb83-4726-bd2d-d3f53578de11',caseId='b4d629b1-b948-4ba6-900b-28e4c2bf2458';
const original=Buffer.from('technical image region authority'),hash=sha256(original);
const authority:DocumentImageAuthority={sourceId,caseId,caseRevision:1,sourceRevision:1,sourceSha256:hash,
  sourceBytes:original.length,objectKey:'private-technical-key',name:'Technical image',format:'png',authoritySha256:'1'.repeat(64)};
const orientation={exifValue:6,applied:6,provenance:'source_exif' as const};
const selection:PacketImageRegionSelection={frame:{kind:'image_oriented_top_left_pixels',width:3,height:4,orientation},
  coordinates:'oriented_original_pixel_edges/1',region:[.2,.2,2.9,3.9],selectionAcknowledged:true};
const request={revision:'1',sha256:hash,purpose:'private_source_preview',selection};
const recipe={version:'packet-image-region-recipe/1' as const,workerSha256:'2'.repeat(64),decoderSha256:'3'.repeat(64),
  supervisorSha256:'4'.repeat(64),crop:'oriented_original_before_resampling/1' as const,
  rounding:'inward_complete_pixels/1' as const,metadataPolicy:'fresh_rgb_or_rgba_pixels_only/1' as const};
function chunk(type:string,data:Buffer){const tag=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);
  size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,crc]);}
function technicalPng(ancillary=false){const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),
    ...(ancillary?[chunk('tEXt',Buffer.from('Comment\0technical private text'))]:[]),
    chunk('IDAT',deflateSync(Buffer.from([0,1,2,3,128,0,4,5,6,255]))),chunk('IEND',Buffer.alloc(0))]);}
const png=technicalPng();
const result:PacketImageRegionWorker={version:'packet-image-region-local/1',sourceSha256:hash,sourceBytes:original.length,
  sourceImage:{format:'png',mode:'RGBA',frame:{kind:'image_source_top_left_pixels',width:4,height:3},frameCount:1,
    orientation,densityDeclarations:[],color:{embeddedIcc:false,declaredSrgb:null,transparency:'supplied'},unsupportedReason:null},
  selection,recipe,runtime:{python:'3.12.14',pillow:'12.3.0',jpegCodec:'8.0',libjpegTurbo:'3.1.4.1',zlibCodec:'1.3.1.zlib-ng',
    pythonSha256:'5'.repeat(64),launcherSha256:'5'.repeat(64),pillowImageSha256:'6'.repeat(64),imagingSha256:'7'.repeat(64)},
  transform:packetImageRegionTransform(selection).transform,output:{sha256:sha256(png),bytes:png.length,pixels:[1,2],format:'png',mode:'RGBA',
    colorInterpretation:'encoded_samples_unmanaged',metadataPolicy:'fresh_rgb_or_rgba_pixels_only/1'}};
const error=(status:number,code:string)=>(v:unknown)=>v instanceof AppError&&v.status===status&&v.code===code;
function service(overrides:Partial<PacketImageRegionDependencies>={}){return new PacketImageRegionService({
  authorize:async()=>structuredClone(authority),original:async()=>original,inspect:async()=>({result:structuredClone(result),png}),
  recipe:async()=>({recipe,pythonSha256:result.runtime.pythonSha256}),...overrides});}

test('exact private image excerpt publishes only acknowledged inward pixels and typed source-only provenance',async()=>{
  let captures=0;const output=await service({authorize:async()=>{captures++;return authority;}}).extract(sourceId,request);
  assert.equal(captures,3);assert.deepEqual(output.bytes,png);PacketImageRegionProvenanceSchema.parse(output.provenance);
  assert.deepEqual(output.provenance.transform.includedPixelBounds,[1,1,2,3]);
  assert.deepEqual(output.provenance.transform.sourceToOutput,[0,-1,2,1,0,-1]);
  assert.equal(output.provenance.calibration,null);assert.equal(output.provenance.applicability,'not_assessed');
  assert(!JSON.stringify(output.provenance).includes('private-technical-key'));
  const large=packetImageRegionTransform({...selection,frame:{...selection.frame,width:5000,height:5000},region:[0,0,5000,5000]});
  assert(large.pixels[0]*large.pixels[1]<=1_600_000);assert.equal(large.transform.resampling,'lanczos');
});

test('revoked/changed full authority refuses before decode or disclosure and full-image inspection shares its slot',async()=>{
  for(const at of [2,3]){let captures=0,decoded=false;
    await assert.rejects(service({authorize:async()=>++captures===at?{...authority,authoritySha256:'8'.repeat(64)}:authority,
      inspect:async()=>{decoded=true;return {result,png};}}).extract(sourceId,request),error(409,'STALE_REVISION'));
    assert.equal(decoded,at===3);
  }
  let captures=0;await assert.rejects(service({authorize:async()=>{if(++captures===3)throw new AppError(403,'DOCUMENT_DENIED','Technical revocation');return authority;}})
    .extract(sourceId,request),error(403,'DOCUMENT_DENIED'));
  let started!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>started=r),hold=new Promise<void>(r=>release=r);
  const pending=service({inspect:async()=>{started();await hold;return {result,png};}}).extract(sourceId,request);await ready;
  await assert.rejects(new DocumentImagesService().image(sourceId,{revision:'1',sha256:hash}),error(429,'DOCUMENT_IMAGE_BUSY'));
  release();await pending;await service().extract(sourceId,request);
});

test('unacknowledged/subpixel/caller inputs refuse before I/O; frame/profile/recipe and ancillary PNG mismatches refuse',async()=>{
  let reads=0;const inputService=service({original:async()=>{reads++;return original;}});
  for(const bad of [{...request,path:'C:/caller.jpg'},{...request,selection:{...selection,selectionAcknowledged:false}},
    {...request,selection:{...selection,region:[.2,.2,.9,.9]}},{...request,selection:{...selection,region:[0,0,4,4]}}])
    await assert.rejects(inputService.extract(sourceId,bad));
  assert.equal(reads,0);assert.equal(PacketImageRegionRequestSchema.safeParse({...request,purpose:'property_binding'}).success,false);
  await assert.rejects(service().extract(sourceId,{...request,selection:{...selection,frame:{...selection.frame,width:4}}}),error(422,'DOCUMENT_IMAGE_REGION_FRAME_MISMATCH'));
  const unsupported=structuredClone(result);unsupported.sourceImage.color.embeddedIcc=true;
  await assert.rejects(service({inspect:async()=>({result:unsupported,png})}).extract(sourceId,request),error(503,'DOCUMENT_IMAGE_REGION_RESULT_INTEGRITY'));
  await assert.rejects(service({recipe:async()=>({recipe:{...recipe,workerSha256:'9'.repeat(64)},pythonSha256:result.runtime.pythonSha256})})
    .extract(sourceId,request),error(503,'DOCUMENT_IMAGE_REGION_RESULT_INTEGRITY'));
  const dirty=technicalPng(true),dirtyResult={...result,output:{...result.output,sha256:sha256(dirty),bytes:dirty.length}};
  await assert.rejects(service({inspect:async()=>({result:dirtyResult,png:dirty})}).extract(sourceId,request),error(503,'DOCUMENT_IMAGE_REGION_RESULT_INTEGRITY'));
});
