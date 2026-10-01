import assert from 'node:assert/strict';
import test from 'node:test';
import {crc32,deflateSync} from 'node:zlib';
import {PacketRegionService,packetRegionTransform,assertCleanRegionPng,type PacketRegionDependencies} from '../packages/server/src/modules/usp/packets/region-extract';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {AppError} from '../packages/server/src/infrastructure/errors';
import type {PacketRegionSelection,PacketRegionWorker} from '../packages/contracts/src/packet-region';
const sourceId='174da4ed-bb83-4726-bd2d-d3f53578de11',caseId='b4d629b1-b948-4ba6-900b-28e4c2bf2458';
const original=Buffer.from('technical source authority control'),hash=sha256(original),recipe='1'.repeat(64);
const selection:PacketRegionSelection={frame:{kind:'pdf_display_page_top_left_points',width:2,height:2,rotation:0},
  mediaBox:[0,0,2,2],cropBox:[0,0,2,2],boxConvention:'pymupdf_page_rectangles/1',
  coordinates:'displayed_cropbox_normalized_top_left/1',region:[.25,.25,.75,.75],selectionAcknowledged:true};
const request={revision:'1',sha256:hash,purpose:'private_source_preview',selection};
const authority={caseId,caseRevision:1,sourceId,sourceRevision:1,sourceSha256:hash,sourceBytes:original.length,
  objectKey:'NEVER_PRIVATE_OBJECT',name:'NEVER_PRIVATE_NAME',authoritySha256:'2'.repeat(64)};
function chunk(type:string,data:Buffer){const value=Buffer.concat([Buffer.from(type),data]);
  const size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(value));return Buffer.concat([size,value,crc]);}
const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=2;
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const png=Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,0,255,0,0,255,0,0,0,255,0,0,255,0]))),chunk('IEND',Buffer.alloc(0))]);
const worker:PacketRegionWorker={version:'packet-region-local/1',sourceSha256:hash,sourceBytes:original.length,page:1,
  selection,recipeSha256:recipe,renderer:{pypdfium2:'5.13.0',pdfium:'153.0.7999.0',pymupdf:'1.25.5',pillow:'12.3.0',pdfiumSha256:'fb898a1f5ace57805834f390407500bdb6ef93eff326a252ad334a8aae809d8e'},
  transform:packetRegionTransform(selection),output:{sha256:sha256(png),bytes:png.length,pixels:[2,2],format:'png',
    metadataPolicy:'fresh_rgb_pixels_only/1',annotations:'excluded',applicability:'not_assessed'}};
const error=(status:number,code:string)=>(e:unknown)=>e instanceof AppError&&e.status===status&&e.code===code;
function service(overrides:Partial<PacketRegionDependencies>={}){return new PacketRegionService({
  authorize:async()=>structuredClone(authority),original:async()=>original,
  inspect:async()=>({result:structuredClone(worker),png}),recipe:async()=>recipe,...overrides});}

test('private source region rechecks authority and returns only pinned bytes/provenance',async()=>{
  let checks=0;
  const result=await service({authorize:async()=>{checks++;return authority;}}).extract(sourceId,1,request);
  assert.equal(checks,3);assert.deepEqual(result.bytes,png);
  assert.equal(result.provenance.sourceSha256,hash);assert.equal(result.provenance.output.applicability,'not_assessed');
  assert(!JSON.stringify(result.provenance).includes('NEVER_PRIVATE'));
  assert.deepEqual(result.provenance.transform.includedNormalizedRegion,[1/3,1/3,2/3,2/3]);
});

test('stale/revoked sources at either I/O boundary never publish a derivative',async()=>{
  for(const changedAt of [2,3]){let checks=0,rendered=false;
    await assert.rejects(service({authorize:async()=>++checks===changedAt?{...authority,authoritySha256:'3'.repeat(64)}:authority,
      inspect:async()=>{rendered=true;return {result:worker,png};}}).extract(sourceId,1,request),error(409,'STALE_REVISION'));
    assert.equal(rendered,changedAt===3);
  }
  let checks=0;
  await assert.rejects(service({authorize:async()=>{if(++checks===3)throw new AppError(403,'DOCUMENT_DENIED','Technical revocation');return authority;}})
    .extract(sourceId,1,request),error(403,'DOCUMENT_DENIED'));
});

test('wrong selectors, caller paths and unacknowledged selections reject before source I/O',async()=>{
  let read=false;const s=service({original:async()=>{read=true;return original;}});
  for(const value of [{...request,path:'C:/caller.pdf'},{...request,url:'https://caller.invalid'},
    {...request,selection:{...selection,selectionAcknowledged:false}},
    {...request,selection:{...selection,region:[-.1,0,1,1]}}])await assert.rejects(s.extract(sourceId,1,value));
  await assert.rejects(s.extract(sourceId,9,request));assert.equal(read,false);
  await assert.rejects(service().extract(sourceId,1,{...request,sha256:'0'.repeat(64)}),error(409,'STALE_REVISION'));
});

test('corrupt source, shifted crop, changed recipe and hidden PNG payload reject',async()=>{
  await assert.rejects(service({original:async()=>Buffer.from('changed')}).extract(sourceId,1,request),error(422,'PACKET_REGION_SOURCE_INTEGRITY'));
  const shifted=structuredClone(worker);shifted.transform.pixelRegion[0]++;
  await assert.rejects(service({inspect:async()=>({result:shifted,png})}).extract(sourceId,1,request),error(503,'PACKET_REGION_RESULT_INTEGRITY'));
  let recipes=0;
  await assert.rejects(service({recipe:async()=>++recipes===1?recipe:'4'.repeat(64)}).extract(sourceId,1,request),error(503,'PACKET_REGION_RESULT_INTEGRITY'));
  const hidden=Buffer.concat([png.subarray(0,png.length-12),chunk('tEXt',Buffer.from('NEVER_PRIVATE')),png.subarray(png.length-12)]);
  assert.throws(()=>assertCleanRegionPng(hidden,[2,2]),error(503,'PACKET_REGION_RESULT_INTEGRITY'));
  assert.throws(()=>assertCleanRegionPng(Buffer.concat([png,Buffer.from('NEVER_TRAILING')]),[2,2]),error(503,'PACKET_REGION_RESULT_INTEGRITY'));
});

test('one crop at a time and completed failures release the slot',async()=>{
  let release!:()=>void,started!:()=>void;
  const ready=new Promise<void>(r=>started=r),hold=new Promise<void>(r=>release=r);
  const pending=service({inspect:async()=>{started();await hold;return {result:worker,png};}}).extract(sourceId,1,request);
  await ready;await assert.rejects(service().extract(sourceId,1,request),error(429,'PACKET_REGION_BUSY'));
  release();await pending;
  await assert.rejects(service({inspect:async()=>{throw new AppError(422,'PACKET_REGION_FRAME_MISMATCH','Technical wrong frame');}}).extract(sourceId,1,request));
  assert.equal((await service().extract(sourceId,1,request)).bytes.length,png.length);
});
