import {readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {crc32} from 'node:zlib';
import {z} from 'zod';
import {PACKET_IMAGE_REGION_LIMITS as limits,PacketImageRegionRequestSchema,PacketImageRegionWorkerSchema,
  PacketImageRegionProvenanceSchema,type PacketImageRegionSelection,type PacketImageRegionRecipe,
  type PacketImageRegionWorker} from '../../../../../contracts/src/packet-image-region';
import type {DocumentImagePin} from '../../../../../contracts/src/document-images';
import {AppError,conflict} from '../../../infrastructure/errors';
import {settings} from '../../../infrastructure/config';
import {sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {authorizePrivateDocumentImage,readPrivateDocumentImageOriginal,runPrivateDocumentImageWorker,
  withPrivateDocumentImageOperation,type DocumentImageAuthority,type DocumentImageExecution} from '../ingestion/document-images';

export type PacketImageRegionInspection={result:PacketImageRegionWorker;png:Buffer;execution?:DocumentImageExecution};
export type PacketImageRegionDependencies={
  authorize:(id:string,pin:DocumentImagePin,deadline:number)=>Promise<DocumentImageAuthority>;
  original:(authority:DocumentImageAuthority,deadline:number)=>Promise<Uint8Array>;
  inspect:(authority:DocumentImageAuthority,bytes:Uint8Array,selection:PacketImageRegionSelection,deadline:number)=>Promise<PacketImageRegionInspection>;
  recipe:()=>Promise<{recipe:PacketImageRegionRecipe;pythonSha256:string}>;
};
function fail(status:number,code:string,message:string):never{throw new AppError(status,code,message);}
function live(deadline:number){if(Date.now()>=deadline)fail(504,'DOCUMENT_IMAGE_DEADLINE','Image region extraction timed out. Retry the exact selection.');}

/** Exact code/interpreter pins, recaptured around native I/O; no mutable profile is created. */
export async function packetImageRegionRecipe(){
  const configured=process.env.ULPIN_DOCUMENT_IMAGES_PYTHON??process.env.ULPIN_DOCUMENT_OCR_PYTHON;
  if(!configured)fail(503,'DOCUMENT_IMAGE_RUNTIME_UNAVAILABLE','Configure the private local image runtime.');
  const directory=join(settings.repositoryRoot,'scripts/usp/document-models');
  try{
    const [worker,decoder,supervisor,python]=await Promise.all([
      readFile(join(directory,'run_image_region.py')),readFile(join(directory,'run_image_inspection.py')),
      readFile(join(directory,'run_trial.py')),realpath(configured).then(readFile)]);
    return {recipe:{version:'packet-image-region-recipe/1',workerSha256:sha256(worker),decoderSha256:sha256(decoder),
      supervisorSha256:sha256(supervisor),crop:'oriented_original_before_resampling/1',rounding:'inward_complete_pixels/1',
      metadataPolicy:'fresh_rgb_or_rgba_pixels_only/1'} satisfies PacketImageRegionRecipe,pythonSha256:sha256(python)};
  }catch{fail(503,'DOCUMENT_IMAGE_RUNTIME_UNAVAILABLE','The pinned image runtime or recipe is unavailable.');}
}
export async function inspectPrivatePacketImageRegion(authority:DocumentImageAuthority,bytes:Uint8Array,
  selection:PacketImageRegionSelection,deadline:number):Promise<PacketImageRegionInspection>{
  const result=await runPrivateDocumentImageWorker(authority,bytes,true,deadline,
    {script:'run_image_region.py',schema:PacketImageRegionWorkerSchema,selection});
  return {...result,png:result.png!};
}

/** Apply orientation, inward whole-pixel crop, then independent actual output ratios. */
export function packetImageRegionTransform(selection:PacketImageRegionSelection){
  const {frame,region}=selection,o=frame.orientation.applied;
  const w=o>=5?frame.height:frame.width,h=o>=5?frame.width:frame.height;
  const [x0,y0,x1,y1]=[Math.ceil(region[0]),Math.ceil(region[1]),Math.floor(region[2]),Math.floor(region[3])];
  const cw=x1-x0,ch=y1-y0;
  if(Math.min(cw,ch)<1)fail(422,'DOCUMENT_IMAGE_REGION_EMPTY','Select at least one complete original pixel.');
  const scale=Math.min(1,limits.side/cw,limits.side/ch,Math.sqrt(limits.pixels/(cw*ch)));
  const rw=Math.max(1,Math.floor(cw*scale)),rh=Math.max(1,Math.floor(ch*scale)),sx=rw/cw,sy=rh/ch;
  const matrices:Record<number,[number,number,number,number,number,number]>={
    1:[1,0,0,0,1,0],2:[-1,0,w,0,1,0],3:[-1,0,w,0,-1,h],4:[1,0,0,0,-1,h],
    5:[0,1,0,1,0,0],6:[0,-1,h,1,0,0],7:[0,-1,h,-1,0,w],8:[0,1,0,-1,0,w]};
  const matrix=matrices[o],[a,b,c,d,e,f]=matrix;
  const bounds:[number,number,number,number]=[x0,y0,x1,y1];
  return {pixels:[rw,rh] as [number,number],transform:{includedPixelBounds:bounds,includedOrientedRegion:bounds,
    sourceToOriented:matrix,orientedToOutput:[sx,0,-x0*sx,0,sy,-y0*sy],
    sourceToOutput:[a*sx,b*sx,(c-x0)*sx,d*sy,e*sy,(f-y0)*sy],outputToOriented:[1/sx,0,x0,0,1/sy,y0],
    coordinateConvention:'pixel_edges/1',rounding:'inward_complete_pixels/1',
    resampling:rw===cw&&rh===ch?'none':'lanczos'} as PacketImageRegionWorker['transform']};
}

/** No decoding in Node: verify only bounded framing, CRCs and a metadata-free RGB(A) chunk allowlist. */
export function assertCleanImageRegionPng(png:Buffer,pixels:[number,number],mode:'RGB'|'RGBA'){
  const bad=()=>fail(503,'DOCUMENT_IMAGE_REGION_RESULT_INTEGRITY','The excerpt is not a clean bounded RGB/RGBA PNG.');
  if(png.length<45||png.length>limits.pngBytes||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))bad();
  let offset=8,header=false,data=false,end=false;
  while(offset+12<=png.length){
    const length=png.readUInt32BE(offset),finish=offset+12+length;
    if(finish>png.length)bad();
    const type=png.toString('latin1',offset+4,offset+8);
    if(crc32(png.subarray(offset+4,finish-4))!==png.readUInt32BE(finish-4))bad();
    if(type==='IHDR'){
      if(header||offset!==8||length!==13||png.readUInt32BE(offset+8)!==pixels[0]||png.readUInt32BE(offset+12)!==pixels[1]||
        !png.subarray(offset+16,offset+21).equals(Buffer.from([8,mode==='RGBA'?6:2,0,0,0])))bad();header=true;
    }else if(type==='IDAT'){if(!header||end)bad();data=true;}
    else if(type==='IEND'){if(!data||length!==0||finish!==png.length)bad();end=true;}
    else bad();
    offset=finish;
  }
  if(!header||!data||!end||offset!==png.length)bad();
}
const defaults:PacketImageRegionDependencies={authorize:authorizePrivateDocumentImage,original:readPrivateDocumentImageOriginal,
  inspect:inspectPrivatePacketImageRegion,recipe:packetImageRegionRecipe};

export class PacketImageRegionService{
  constructor(private readonly dependencies:PacketImageRegionDependencies=defaults){}
  async extract(sourceValue:string,raw:unknown){
    const sourceId=z.uuid().transform(v=>v.toLowerCase()).parse(sourceValue),request=PacketImageRegionRequestSchema.parse(raw);
    const expected=packetImageRegionTransform(request.selection);
    return withPrivateDocumentImageOperation(async()=>{
      const deadline=Date.now()+limits.seconds*1000,pin={revision:request.revision,sha256:request.sha256};
      const authority=await this.dependencies.authorize(sourceId,pin,deadline);live(deadline);
      if(authority.sourceId!==sourceId||authority.sourceRevision!==pin.revision||authority.sourceSha256!==pin.sha256)
        conflict('The retained image differs from the explicit selection.');
      if(!Number.isSafeInteger(authority.sourceBytes)||authority.sourceBytes<1||authority.sourceBytes>limits.originalBytes)
        fail(413,'DOCUMENT_IMAGE_SOURCE_LIMIT','The original exceeds the bounded image profile.');
      const recipe=await this.dependencies.recipe();live(deadline);
      const bytes=await this.dependencies.original(authority,deadline);live(deadline);
      if(bytes.length!==authority.sourceBytes||sha256(bytes)!==authority.sourceSha256)
        fail(422,'DOCUMENT_IMAGE_SOURCE_INTEGRITY','The original failed its exact hash or length check.');
      const same=async()=>{live(deadline);const current=await this.dependencies.authorize(sourceId,pin,deadline);live(deadline);
        if(fingerprint(current)!==fingerprint(authority))conflict('The image source or access context changed during extraction.');};
      await same();
      const inspected=await this.dependencies.inspect(authority,bytes,request.selection,deadline);live(deadline);
      const parsed=PacketImageRegionWorkerSchema.safeParse(inspected.result);
      if(!parsed.success)fail(503,'DOCUMENT_IMAGE_REGION_RESULT_INTEGRITY','The image worker returned invalid bounded provenance.');
      const result=parsed.data,info=result.sourceImage,orientation=info.orientation,o=orientation.applied,
        ow=o>=5?info.frame.height:info.frame.width,oh=o>=5?info.frame.width:info.frame.height;
      if(ow!==request.selection.frame.width||oh!==request.selection.frame.height||
        fingerprint(orientation)!==fingerprint(request.selection.frame.orientation))
        fail(422,'DOCUMENT_IMAGE_REGION_FRAME_MISMATCH','Pin the oriented original pixel frame and its exact orientation state.');
      if(info.frame.width*info.frame.height>limits.sourcePixels||info.format!==authority.format||
        info.color.embeddedIcc||info.color.declaredSrgb===false||!['RGB','RGBA','L','LA','P','1'].includes(info.mode)||
        result.output.mode!==(info.color.transparency==='supplied'?'RGBA':'RGB'))
        fail(503,'DOCUMENT_IMAGE_REGION_RESULT_INTEGRITY','The excerpt differs from the supported image profile.');
      if(result.sourceSha256!==authority.sourceSha256||result.sourceBytes!==bytes.length||
        fingerprint(result.selection)!==fingerprint(request.selection)||fingerprint(result.recipe)!==fingerprint(recipe.recipe)||
        result.runtime.launcherSha256!==recipe.pythonSha256||fingerprint(recipe)!==fingerprint(await this.dependencies.recipe())||
        fingerprint(result.transform)!==fingerprint(expected.transform)||fingerprint(result.output.pixels)!==fingerprint(expected.pixels)||
        result.output.pixels[0]*result.output.pixels[1]>limits.pixels||
        inspected.png.length!==result.output.bytes||sha256(inspected.png)!==result.output.sha256)
        fail(503,'DOCUMENT_IMAGE_REGION_RESULT_INTEGRITY','The excerpt differs from its exact original, selection, transform, recipe or bytes.');
      assertCleanImageRegionPng(inspected.png,result.output.pixels,result.output.mode);
      const provenance=PacketImageRegionProvenanceSchema.parse({...result,version:'packet-image-region/1',
        caseId:authority.caseId,caseRevision:authority.caseRevision,sourceId,sourceRevision:authority.sourceRevision,
        purpose:request.purpose,locator:{kind:'original_image',frame:0},calibration:null,applicability:'not_assessed'});
      if(Buffer.byteLength(JSON.stringify(provenance))>limits.provenanceBytes)
        fail(503,'DOCUMENT_IMAGE_METADATA_LIMIT','The excerpt provenance exceeds its bounded transport profile.');
      await same();live(deadline);
      return {bytes:inspected.png,provenance};
    });
  }
}
