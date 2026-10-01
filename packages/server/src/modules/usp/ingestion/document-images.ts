import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {access,realpath,rm,writeFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {DOCUMENT_IMAGE_LIMITS as limits,DocumentImagePinSchema,DocumentImageWorkerSchema,
  DocumentImageSchema,type DocumentImagePin,type DocumentImageInfo,type DocumentImageWorker} from '../../../../../contracts/src/document-images';
import {transaction} from '../../../infrastructure/db';
import {settings} from '../../../infrastructure/config';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {openObjectStream,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {documentSourceTx} from './document-context';
import {assertIngestionBinding} from './events';
import {privateOcrDirectory,readBoundedOcrArtifact} from './document-ocr';

export type DocumentImageAuthority={caseId:string;caseRevision:number;sourceId:string;sourceRevision:number;
  sourceSha256:string;sourceBytes:number;objectKey:string;name:string;format:'png'|'jpeg';authoritySha256:string};
export type DocumentImageInspection={result:DocumentImageWorker;png?:Buffer;
  execution?:z.infer<typeof executionSchema>&{receiptSha256:string}};
type Dependencies={authorize:(sourceId:string,pin:DocumentImagePin,deadline:number)=>Promise<DocumentImageAuthority>;
  original:(authority:DocumentImageAuthority,deadline:number)=>Promise<Uint8Array>;
  inspect:(authority:DocumentImageAuthority,bytes:Uint8Array,raster:boolean,deadline:number)=>Promise<DocumentImageInspection>};
function fail(status:number,code:string,message:string):never{throw new AppError(status,code,message);}
function live(deadline:number){if(Date.now()>=deadline)fail(504,'DOCUMENT_IMAGE_DEADLINE','Image inspection timed out. Retry the exact original selection.');}

/** The canonical document authority, without a new source/job/derivative store. */
export async function documentImageAuthorityTx(client:PoolClient,sourceId:string,pin:DocumentImagePin){
  const lookup=(await client.query('SELECT case_id FROM sources WHERE id=$1',[sourceId])).rows[0]??notFound('Document source not found.');
  const ctx=await documentSourceTx(client,lookup.case_id,sourceId);
  if(!ctx.latest||ctx.source.revision!==pin.revision||ctx.source.sha256!==pin.sha256)
    conflict('Pin the current retained image revision and original hash.');
  const format=ctx.source.inspection.documentOriginal.format;
  if(format!=='png'&&format!=='jpeg')fail(422,'DOCUMENT_IMAGE_FORMAT_REQUIRED','Image inspection supports retained PNG and JPEG originals.');
  const bytes=Number(ctx.source.bytes);
  if(!Number.isSafeInteger(bytes)||bytes<1||bytes>limits.originalBytes)
    fail(413,'DOCUMENT_IMAGE_SOURCE_LIMIT','This original exceeds the bounded image profile.');
  assertIngestionBinding(ctx.binding);
  return {caseId:ctx.current.id,caseRevision:ctx.current.revision,sourceId:ctx.source.id,
    sourceRevision:ctx.source.revision,sourceSha256:ctx.source.sha256,sourceBytes:bytes,format,
    objectKey:ctx.source.object_key,name:ctx.source.name,
    authoritySha256:fingerprint({case:ctx.current,context:ctx.context,
      binding:{subject:ctx.binding.subject,access:ctx.binding.access},source:ctx.source,latest:ctx.latest})} satisfies DocumentImageAuthority;
}
async function authorize(sourceId:string,pin:DocumentImagePin,deadline:number){
  live(deadline);
  return transaction(async client=>{
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    return documentImageAuthorityTx(client,sourceId,pin);
  },{deadlineAt:deadline});
}
async function original(authority:DocumentImageAuthority,deadline:number){
  live(deadline);
  const {body}=await openObjectStream(authority.objectKey,authority.sourceBytes,Math.max(1,deadline-Date.now()));
  const chunks:Buffer[]=[];let bytes=0;
  try{for await(const value of body){live(deadline);const chunk=Buffer.from(value);bytes+=chunk.length;
    if(bytes>authority.sourceBytes)fail(422,'DOCUMENT_IMAGE_SOURCE_INTEGRITY','The original differs from its retained byte count.');
    chunks.push(chunk);}
    return Buffer.concat(chunks);
  }finally{body.destroy();}
}
function childEnvironment(){
  const env:Record<string,string>={};
  for(const key of ['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'])
    if(process.env[key])env[key]=process.env[key]!;
  return {...env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',CUDA_VISIBLE_DEVICES:'',
    OMP_NUM_THREADS:'2',MKL_NUM_THREADS:'2',OPENBLAS_NUM_THREADS:'2',TOKENIZERS_PARALLELISM:'false'};
}
function execute(python:string,args:string[],timeout:number){
  return new Promise<number|null>((resolve,reject)=>{
    const child=spawn(python,args,{cwd:settings.repositoryRoot,env:childEnvironment(),windowsHide:true,stdio:'ignore'});
    let settled=false,timedOut=false,cleanup:ReturnType<typeof setTimeout>|undefined;
    const finish=(code:number|null)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(cleanup);resolve(timedOut?null:code);};
    const timer=setTimeout(()=>{
      timedOut=true;
      if(child.pid)spawnSync(join(process.env.SystemRoot??'C:\\Windows','System32','taskkill.exe'),
        ['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:3000,stdio:'ignore'});
      cleanup=setTimeout(()=>{if(!settled){settled=true;reject(new Error('DOCUMENT_IMAGE_CHILD_CLEANUP_UNRESOLVED'));}},3000);
    },timeout);
    child.on('error',()=>finish(null));child.on('close',finish);
  });
}
const executionSchema=z.object({version:z.literal('document-image-execution/1'),seconds:z.number().int().min(1).max(25),
  memoryBytes:z.literal(limits.memoryBytes),resultSha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  worker:z.object({exitCode:z.number().int(),stopReason:z.string().nullable(),gatedStart:z.literal(true),
    elapsedSeconds:z.number().finite().nonnegative().max(30),peakObservedRssBytes:z.number().int().nonnegative().max(limits.memoryBytes),
    peakJobPrivateBytes:z.number().int().nonnegative().max(limits.memoryBytes)})});

/** Native decoding is performed only by the gated worker, never in Node. */
export async function inspectPrivateDocumentImage(authority:DocumentImageAuthority,bytes:Uint8Array,
  raster:boolean,deadline:number):Promise<DocumentImageInspection>{
  if(process.platform!=='win32')fail(503,'DOCUMENT_IMAGE_RUNTIME_UNAVAILABLE','This image profile requires the configured Windows runtime.');
  const configured=process.env.ULPIN_DOCUMENT_IMAGES_PYTHON??process.env.ULPIN_DOCUMENT_OCR_PYTHON;
  const scratch=process.env.ULPIN_DOCUMENT_IMAGES_SCRATCH;
  if(!configured||!scratch||!isAbsolute(configured)||!isAbsolute(scratch))
    fail(503,'DOCUMENT_IMAGE_RUNTIME_UNAVAILABLE','Configure the private local image runtime and scratch directory.');
  let python:string;
  try{python=await realpath(configured);await access(python);}catch{fail(503,'DOCUMENT_IMAGE_RUNTIME_UNAVAILABLE','The configured image runtime is unavailable.');}
  let dir:string|undefined,keepDirectory=false;
  try{
    try{dir=await privateOcrDirectory(scratch,randomUUID());}
    catch{fail(503,'DOCUMENT_IMAGE_SCRATCH_UNAVAILABLE','Configure an available private image scratch directory outside the repository.');}
    const source=join(dir,'original.image'),output=join(dir,'output');
    await writeFile(source,bytes,{flag:'wx',mode:0o600});
    const seconds=Math.min(25,Math.floor((deadline-Date.now()-6000)/1000));
    if(seconds<1)fail(504,'DOCUMENT_IMAGE_DEADLINE','Not enough time remains for bounded image inspection.');
    const args=[join(settings.repositoryRoot,'scripts/usp/document-models/run_image_inspection.py'),
      '--source',source,'--sha256',authority.sourceSha256,'--format',authority.format,'--output',output,'--seconds',String(seconds)];
    if(raster)args.push('--raster');
    let exit:number|null;
    try{exit=await execute(python!,args,Math.min((seconds+3)*1000,deadline-Date.now()));}
    catch{keepDirectory=true;runtimeBlocked=true;fail(503,'DOCUMENT_IMAGE_CLEANUP_UNRESOLVED','Image process cleanup could not be confirmed; its private attempt was retained.');}
    live(deadline);
    let resultBytes:Buffer,receiptBytes:Buffer,execution:z.infer<typeof executionSchema>,outputValue:unknown;
    try{
      resultBytes=await readBoundedOcrArtifact(join(output,'result.json'),limits.metadataBytes);
      receiptBytes=await readBoundedOcrArtifact(join(output,'receipt.json'),16*1024);
      execution=executionSchema.parse(JSON.parse(receiptBytes.toString('utf8')));
      outputValue=JSON.parse(resultBytes.toString('utf8'));
    }catch{fail(503,'DOCUMENT_IMAGE_RUNTIME_FAILED','The bounded image runtime did not produce a valid receipt.');}
    if(execution!.seconds!==seconds||execution!.resultSha256!==sha256(resultBytes!))
      fail(503,'DOCUMENT_IMAGE_RUNTIME_FAILED','The image receipt differs from its output.');
    if(exit!==0||execution!.worker.exitCode!==0||execution!.worker.stopReason!==null){
      const failure=z.strictObject({version:z.literal('document-image-failure/1'),code:z.string().regex(/^DOCUMENT_IMAGE_[A-Z_]+$/)}).safeParse(outputValue);
      if(failure.success)fail(422,failure.data.code,'This image is unavailable under the bounded display profile. Its original remains retained.');
      fail(503,'DOCUMENT_IMAGE_RUNTIME_FAILED','Image inspection failed or exceeded its process bounds.');
    }
    const parsed=DocumentImageWorkerSchema.safeParse(outputValue);
    if(!parsed.success)fail(503,'DOCUMENT_IMAGE_RUNTIME_FAILED','The image runtime returned invalid bounded metadata.');
    const png=raster?await readBoundedOcrArtifact(join(output,'image.png'),limits.pngBytes):undefined;
    return {result:parsed.data,png,execution:{...execution!,receiptSha256:sha256(receiptBytes!)}};
  }finally{if(dir&&!keepDirectory)await rm(dir,{recursive:true,force:true});}
}

function assertImage(info:DocumentImageInfo){
  const {width:w,height:h}=info.frame,o=info.orientation,display=info.display;
  const reason=info.color.embeddedIcc||info.color.declaredSrgb===false?'unsupported_color_profile':
    !['RGB','RGBA','L','LA','P','1'].includes(info.mode)?'unsupported_pixel_mode':null;
  if(w*h>limits.sourcePixels||o.applied!==(o.exifValue??1)||
    o.provenance!==(o.exifValue===null?'specification_default':'source_exif')||info.unsupportedReason!==reason||
    (!!display)!==(reason===null))fail(503,'DOCUMENT_IMAGE_RESULT_INTEGRITY','Image metadata differs from its bounded source profile.');
  if(!display)return;
  const orientation=o.applied,ow=orientation>=5?h:w,oh=orientation>=5?w:h;
  const scale=Math.min(1,limits.side/ow,limits.side/oh,Math.sqrt(limits.pixels/(ow*oh)));
  const rw=Math.max(1,Math.floor(ow*scale)),rh=Math.max(1,Math.floor(oh*scale));
  const matrices:{[key:number]:number[]}={1:[1,0,0,0,1,0],2:[-1,0,w,0,1,0],3:[-1,0,w,0,-1,h],
    4:[1,0,0,0,-1,h],5:[0,1,0,1,0,0],6:[0,-1,h,1,0,0],7:[0,-1,h,-1,0,w],8:[0,1,0,-1,0,w]};
  const expected=matrices[orientation].map((v,i)=>v*(i<3?rw/ow:rh/oh));
  if(display.frame.width!==rw||display.frame.height!==rh||rw*rh>limits.pixels||
    display.sourceToRaster.some((v,i)=>Math.abs(v-expected[i])>1e-9)||
    display.mode!==(info.color.transparency==='supplied'?'RGBA':'RGB')||
    display.resampling!==((rw===ow&&rh===oh)?'none':'lanczos'))
    fail(503,'DOCUMENT_IMAGE_RESULT_INTEGRITY','The display transform differs from the source pixel/orientation frame.');
}
const defaults:Dependencies={authorize,original,inspect:inspectPrivateDocumentImage};
let busy=false,runtimeBlocked=false;
export class DocumentImagesService{
  constructor(private readonly dependencies:Dependencies=defaults){}
  private async inspect(sourceValue:string,raw:unknown,raster:boolean){
    const sourceId=z.uuid().transform(value=>value.toLowerCase()).parse(sourceValue),pin=DocumentImagePinSchema.parse(raw);
    if(runtimeBlocked)fail(503,'DOCUMENT_IMAGE_CLEANUP_UNRESOLVED','Earlier image process cleanup is unresolved. Restore the owned runtime before retrying.');
    if(busy)fail(429,'DOCUMENT_IMAGE_BUSY','An image inspection is running. Retry when it finishes.');
    busy=true;const deadline=Date.now()+limits.seconds*1000;
    try{
      const authority=await this.dependencies.authorize(sourceId,pin,deadline);
      const same=(after:DocumentImageAuthority)=>{if(fingerprint(authority)!==fingerprint(after))
        conflict('The private image source or access context changed during inspection.');};
      const bytes=await this.dependencies.original(authority,deadline);
      if(bytes.length!==authority.sourceBytes||sha256(bytes)!==authority.sourceSha256)
        fail(422,'DOCUMENT_IMAGE_SOURCE_INTEGRITY','The original failed its exact hash or length check.');
      same(await this.dependencies.authorize(sourceId,pin,deadline));
      const inspected=await this.dependencies.inspect(authority,bytes,raster,deadline);
      const parsed=DocumentImageWorkerSchema.safeParse(inspected.result);
      if(!parsed.success)fail(503,'DOCUMENT_IMAGE_RESULT_INTEGRITY','The image worker returned invalid metadata.');
      const result=parsed.data;
      if(result.sourceSha256!==authority.sourceSha256||result.sourceBytes!==authority.sourceBytes||result.image.format!==authority.format)
        fail(503,'DOCUMENT_IMAGE_RESULT_INTEGRITY','Image metadata differs from the exact retained source.');
      assertImage(result.image);
      if(raster){const png=inspected.png,render=result.render,display=result.image.display;
        if(!png||!render||!display||png.length!==render.bytes||sha256(png)!==render.sha256||png.length<24||
          !png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||png.toString('ascii',12,16)!=='IHDR'||
          png.readUInt32BE(16)!==display.frame.width||png.readUInt32BE(20)!==display.frame.height)
          fail(503,'DOCUMENT_IMAGE_RESULT_INTEGRITY','The bounded raster differs from its image receipt.');
      }else if(result.render!==null||inspected.png!==undefined)
        fail(503,'DOCUMENT_IMAGE_RESULT_INTEGRITY','A metadata request cannot publish a raster.');
      same(await this.dependencies.authorize(sourceId,pin,deadline));live(deadline);
      return {authority,result,png:inspected.png};
    }finally{busy=false;}
  }
  async image(sourceId:string,raw:unknown){
    const {authority,result}=await this.inspect(sourceId,raw,false);
    const pin=new URLSearchParams({revision:String(authority.sourceRevision),sha256:authority.sourceSha256});
    return DocumentImageSchema.parse({version:'document-image/1',sourceId:authority.sourceId,caseId:authority.caseId,
      caseRevision:authority.caseRevision,sourceRevision:authority.sourceRevision,sourceSha256:authority.sourceSha256,
      sourceBytes:authority.sourceBytes,name:authority.name,image:result.image,
      url:result.image.display?`/api/v1/sources/${authority.sourceId}/image/raster?${pin}`:null,
      calibration:null,locator:{kind:'original_image',frame:0}});
  }
  async raster(sourceId:string,raw:unknown){
    const {authority,result,png}=await this.inspect(sourceId,raw,true);
    return {bytes:png!,sourceRevision:authority.sourceRevision,sourceSha256:authority.sourceSha256,
      display:result.image.display!,orientation:result.image.orientation,sourceFrame:result.image.frame,render:result.render!};
  }
}
