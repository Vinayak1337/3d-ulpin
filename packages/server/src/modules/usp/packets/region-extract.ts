import {crc32} from 'node:zlib';
import {z} from 'zod';
import {PACKET_REGION_LIMITS as limits,PacketRegionRequestSchema,PacketRegionPageSchema,PacketRegionWorkerSchema,
  PacketRegionProvenanceSchema,type PacketRegionSelection,type PacketRegionWorker} from '../../../../../contracts/src/packet-region';
import {AppError,conflict} from '../../../infrastructure/errors';
import {openObjectStream,sha256} from '../../../infrastructure/storage';
import type {DocumentPageAuthority} from '../ingestion/document-pages';
import type {PacketRegionInspection} from './region-runtime';
import type {DocumentPagePin} from '../../../../../contracts/src/document-pages';

export type PacketRegionDependencies={authorize:(id:string,pin:DocumentPagePin,deadline:number)=>Promise<DocumentPageAuthority>;
  original:(authority:DocumentPageAuthority,deadline:number)=>Promise<Uint8Array>;
  inspect:(authority:DocumentPageAuthority,bytes:Uint8Array,page:number,selection:PacketRegionSelection,deadline:number)=>Promise<PacketRegionInspection>;
  recipe:()=>Promise<string>};
function fail(status:number,code:string,message:string):never{throw new AppError(status,code,message);}
function live(deadline:number){if(Date.now()>=deadline)fail(504,'PACKET_REGION_DEADLINE','Region extraction timed out. Retry the exact selection.');}
async function authorize(id:string,pin:DocumentPagePin,deadline:number){
  live(deadline);
  const [{transaction},{documentPageAuthorityTx}]=await Promise.all([
    import('../../../infrastructure/db'),import('../ingestion/document-pages')]);
  live(deadline);
  return transaction(client=>documentPageAuthorityTx(client,id,pin),
    {deadlineAt:deadline},'repeatable_read_only');
}
async function original(authority:DocumentPageAuthority,deadline:number){
  const {body}=await openObjectStream(authority.objectKey,authority.sourceBytes,Math.max(1,deadline-Date.now()));
  const chunks:Buffer[]=[];let size=0;
  try{for await(const value of body){live(deadline);const chunk=Buffer.from(value);size+=chunk.length;
    if(size>authority.sourceBytes)fail(422,'PACKET_REGION_SOURCE_INTEGRITY','The original differs from its retained size.');chunks.push(chunk);}
    return Buffer.concat(chunks);
  }finally{body.destroy();}
}
/** Same deterministic preallocation profile as the isolated PDFium leaf. */
export function packetRegionTransform(selection:PacketRegionSelection):PacketRegionWorker['transform']{
  const {frame,region}=selection,w=(region[2]-region[0])*frame.width,h=(region[3]-region[1])*frame.height;
  const scale=Math.min(3,(limits.side-2)/w,(limits.side-2)/h,
    (limits.pixels-4)/(w+h+Math.sqrt((w-h)**2+limits.pixels*w*h)));
  const canvasPixels:[number,number]=[Math.ceil(frame.width*scale),Math.ceil(frame.height*scale)];
  const pixelRegion:[number,number,number,number]=[Math.ceil(region[0]*canvasPixels[0]),Math.ceil(region[1]*canvasPixels[1]),
    Math.floor(region[2]*canvasPixels[0]),Math.floor(region[3]*canvasPixels[1])];
  const pw=pixelRegion[2]-pixelRegion[0],ph=pixelRegion[3]-pixelRegion[1];
  if(Math.min(pw,ph)<1||Math.max(pw,ph)>limits.side||pw*ph>limits.pixels)
    fail(422,'PACKET_REGION_PIXEL_LIMIT','The selected crop cannot contain complete pixels within this profile.');
  const sx=frame.width/canvasPixels[0],sy=frame.height/canvasPixels[1];
  return {canvasPixels,pixelRegion,pixelToDisplay:[sx,0,0,sy,pixelRegion[0]*sx,pixelRegion[1]*sy],
    includedNormalizedRegion:[pixelRegion[0]/canvasPixels[0],pixelRegion[1]/canvasPixels[1],pixelRegion[2]/canvasPixels[0],pixelRegion[3]/canvasPixels[1]],
    rounding:'inward_complete_pixels/1'};
}
/** Fresh RGB PNG only: reject ancillary payloads, trailing bytes and bad CRCs. */
export function assertCleanRegionPng(png:Buffer,pixels:[number,number]){
  const bad=()=>fail(503,'PACKET_REGION_RESULT_INTEGRITY','The region is not a clean bounded RGB PNG.');
  if(png.length<45||png.length>limits.pngBytes||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))bad();
  let offset=8,header=false,data=false,end=false;
  while(offset+12<=png.length){
    const length=png.readUInt32BE(offset),finish=offset+12+length;
    if(finish>png.length)bad();
    const type=png.toString('ascii',offset+4,offset+8);
    if(crc32(png.subarray(offset+4,finish-4))!==png.readUInt32BE(finish-4))bad();
    if(type==='IHDR'){
      if(header||offset!==8||length!==13||png.readUInt32BE(offset+8)!==pixels[0]||png.readUInt32BE(offset+12)!==pixels[1]||
        !png.subarray(offset+16,offset+21).equals(Buffer.from([8,2,0,0,0])))bad();header=true;
    }else if(type==='IDAT'){if(!header||end)bad();data=true;}
    else if(type==='IEND'){if(!data||length!==0||finish!==png.length)bad();end=true;}
    else bad();
    offset=finish;
  }
  if(!header||!data||!end||offset!==png.length)bad();
}
const defaults:PacketRegionDependencies={authorize,original,
  inspect:async(authority,bytes,page,selection,deadline)=>{
    live(deadline);const {inspectPrivatePacketRegion}=await import('./region-runtime');live(deadline);
    return inspectPrivatePacketRegion(authority,bytes,page,selection,deadline);
  },
  recipe:async()=>{const {packetRegionRecipeSha}=await import('./region-runtime');return packetRegionRecipeSha();}};
let busy=false;
export class PacketRegionService{
  constructor(private readonly dependencies:PacketRegionDependencies=defaults){}
  async extract(sourceValue:string,pageValue:number,raw:unknown,deadlineAt?:number){
    if(deadlineAt!==undefined&&!Number.isFinite(deadlineAt))
      fail(422,'PACKET_REGION_DEADLINE','Use a finite server operation deadline.');
    if(deadlineAt!==undefined)live(deadlineAt);
    const sourceId=z.uuid().transform(v=>v.toLowerCase()).parse(sourceValue),page=PacketRegionPageSchema.parse(pageValue);
    const request=PacketRegionRequestSchema.parse(raw),transform=packetRegionTransform(request.selection);
    const deadline=Math.min(Date.now()+limits.seconds*1000,deadlineAt??Infinity);live(deadline);
    // Load the authority/runtime graph after this leaf is initialized: the
    // registry may construct its own region service while these modules load.
    const [{assertPacketRegionRuntime},{fingerprint}]=await Promise.all([
      import('./region-runtime'),import('../../cases/domain')]);
    live(deadline);assertPacketRegionRuntime();
    if(busy)fail(429,'PACKET_REGION_BUSY','One region extraction is already running.');
    live(deadline);busy=true;
    try{
      const pin={revision:request.revision,sha256:request.sha256};
      const authority=await this.dependencies.authorize(sourceId,pin,deadline);
      if(authority.sourceId!==sourceId||authority.sourceRevision!==pin.revision||authority.sourceSha256!==pin.sha256)
        conflict('The retained source differs from the explicit selection.');
      if(!Number.isSafeInteger(authority.sourceBytes)||authority.sourceBytes<1||authority.sourceBytes>limits.sourceBytes)
        fail(413,'PACKET_REGION_SOURCE_LIMIT','The source exceeds the selected-region profile.');
      const recipe=await this.dependencies.recipe();live(deadline);
      const bytes=await this.dependencies.original(authority,deadline);
      if(bytes.length!==authority.sourceBytes||sha256(bytes)!==authority.sourceSha256)
        fail(422,'PACKET_REGION_SOURCE_INTEGRITY','The original failed its exact size or hash check.');
      const same=async()=>{live(deadline);const current=await this.dependencies.authorize(sourceId,pin,deadline);
        if(fingerprint(authority)!==fingerprint(current))conflict('The source or access context changed during extraction.');};
      await same();
      const inspected=await this.dependencies.inspect(authority,bytes,page,request.selection,deadline);
      const parsed=PacketRegionWorkerSchema.safeParse(inspected.result);
      if(!parsed.success)fail(503,'PACKET_REGION_RESULT_INTEGRITY','The renderer returned invalid bounded region metadata.');
      const result=parsed.data;
      if(result.sourceSha256!==authority.sourceSha256||result.sourceBytes!==bytes.length||result.page!==page||
        fingerprint(result.selection)!==fingerprint(request.selection)||fingerprint(result.transform)!==fingerprint(transform)||
        result.recipeSha256!==recipe||recipe!==await this.dependencies.recipe()||
        inspected.png.length!==result.output.bytes||sha256(inspected.png)!==result.output.sha256||
        result.output.pixels[0]!==transform.pixelRegion[2]-transform.pixelRegion[0]||
        result.output.pixels[1]!==transform.pixelRegion[3]-transform.pixelRegion[1])
        fail(503,'PACKET_REGION_RESULT_INTEGRITY','The derivative differs from its exact source, crop, recipe or bytes.');
      assertCleanRegionPng(inspected.png,result.output.pixels);
      const provenance=PacketRegionProvenanceSchema.parse({...result,version:'packet-region/1',caseId:authority.caseId,
        caseRevision:authority.caseRevision,sourceId,sourceRevision:authority.sourceRevision,purpose:request.purpose});
      await same();live(deadline);
      return {bytes:inspected.png,provenance};
    }finally{busy=false;}
  }
}
