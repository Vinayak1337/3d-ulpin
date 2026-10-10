import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {access,realpath,rm,writeFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {DOCUMENT_PAGE_LIMITS as limits,DocumentPagePinSchema,DocumentPagesQuerySchema,
  DocumentPagesWorkerSchema,DocumentPagesSchema,type DocumentPagePin,type DocumentPagesWorker} from '../../../../../contracts/src/document-pages';
import {transaction} from '../../../infrastructure/db';
import {settings} from '../../../infrastructure/config';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {openObjectStream,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {documentSourceTx} from './document-context';
import {assertIngestionBinding} from './events';
import {privateOcrDirectory,readBoundedOcrArtifact} from './document-ocr';

export type DocumentPageAuthority={caseId:string;caseRevision:number;sourceId:string;sourceRevision:number;
  sourceSha256:string;sourceBytes:number;objectKey:string;name:string;authoritySha256:string};
type Selection={offset:number;limit:number;page?:number};
export type DocumentPageInspection={result:DocumentPagesWorker;png?:Buffer;execution?:z.infer<typeof executionSchema>&{receiptSha256:string}};
type Dependencies={authorize:(sourceId:string,pin:DocumentPagePin,deadline:number)=>Promise<DocumentPageAuthority>;
  original:(authority:DocumentPageAuthority,deadline:number)=>Promise<Uint8Array>;
  inspect:(authority:DocumentPageAuthority,bytes:Uint8Array,selection:Selection,deadline:number)=>Promise<DocumentPageInspection>};
const uuid=z.uuid().transform(value=>value.toLowerCase());
function fail(status:number,code:string,message:string):never{throw new AppError(status,code,message);}
function live(deadline:number){if(Date.now()>=deadline)fail(504,'DOCUMENT_PAGES_DEADLINE','Page inspection timed out. Retry the explicit selection.');}

/** Nonlocking source identity lookup followed by the canonical private authority.
 * No source/job/registry state is written and no reader result is reclassified. */
export async function documentPageAuthorityTx(client:PoolClient,sourceId:string,pin:DocumentPagePin){
  const lookup=(await client.query('SELECT case_id FROM sources WHERE id=$1',[sourceId])).rows[0]??notFound('Document source not found.');
  const ctx=await documentSourceTx(client,lookup.case_id,sourceId);
  if(!ctx.latest||ctx.source.revision!==pin.revision||ctx.source.sha256!==pin.sha256)
    conflict('Pin the current retained document revision and original hash.');
  if(ctx.source.inspection.documentOriginal.format!=='pdf')
    fail(422,'DOCUMENT_PAGES_PDF_REQUIRED','Page inspection supports retained PDF originals.');
  const bytes=Number(ctx.source.bytes);
  if(!Number.isSafeInteger(bytes)||bytes<1||bytes>limits.originalBytes)
    fail(413,'DOCUMENT_PAGES_SOURCE_LIMIT','This original exceeds the bounded PDF page profile.');
  assertIngestionBinding(ctx.binding);
  return {caseId:ctx.current.id,caseRevision:ctx.current.revision,sourceId:ctx.source.id,
    sourceRevision:ctx.source.revision,sourceSha256:ctx.source.sha256,sourceBytes:bytes,
    objectKey:ctx.source.object_key,name:ctx.source.name,
    authoritySha256:fingerprint({case:ctx.current,context:ctx.context,binding:{subject:ctx.binding.subject,access:ctx.binding.access},
      source:ctx.source,latest:ctx.latest})} satisfies DocumentPageAuthority;
}
async function authorize(sourceId:string,pin:DocumentPagePin,deadline:number){
  live(deadline);
  return transaction(client=>documentPageAuthorityTx(client,sourceId,pin),
    {deadlineAt:deadline},'repeatable_read_only');
}
async function original(authority:DocumentPageAuthority,deadline:number){
  live(deadline);
  const {body}=await openObjectStream(authority.objectKey,authority.sourceBytes,Math.max(1,deadline-Date.now()));
  const chunks:Buffer[]=[];let bytes=0;
  try{for await(const value of body){live(deadline);const chunk=Buffer.from(value);bytes+=chunk.length;
    if(bytes>authority.sourceBytes)fail(422,'DOCUMENT_PAGES_SOURCE_INTEGRITY','The original differs from its retained byte count.');
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
      cleanup=setTimeout(()=>{if(!settled){settled=true;reject(new Error('DOCUMENT_PAGES_CHILD_CLEANUP_UNRESOLVED'));}},3000);
    },timeout);
    child.on('error',()=>finish(null));child.on('close',finish);
  });
}
const executionSchema=z.object({version:z.literal('document-pages-execution/1'),seconds:z.number().int().min(1).max(25),
  memoryBytes:z.literal(limits.memoryBytes),resultSha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  worker:z.object({exitCode:z.number().int(),stopReason:z.string().nullable(),gatedStart:z.literal(true),
    elapsedSeconds:z.number().finite().nonnegative().max(30),peakObservedRssBytes:z.number().int().nonnegative().max(limits.memoryBytes),
    peakJobPrivateBytes:z.number().int().nonnegative().max(limits.memoryBytes)})});
/** Uses the existing private scratch ACL, bounded artifact reader, PDF renderer
 * and gated Windows Job supervisor. The new helper is outside producer digests. */
export async function inspectPrivateDocumentPages(authority:DocumentPageAuthority,bytes:Uint8Array,
  selection:Selection,deadline:number):Promise<DocumentPageInspection>{
  if(process.platform!=='win32')fail(503,'DOCUMENT_PAGES_RUNTIME_UNAVAILABLE','This page profile requires the configured Windows PDF runtime.');
  const configured=process.env.ULPIN_DOCUMENT_PAGES_PYTHON??process.env.ULPIN_DOCUMENT_OCR_PYTHON;
  const scratch=process.env.ULPIN_DOCUMENT_PAGES_SCRATCH;
  if(!configured||!scratch||!isAbsolute(configured)||!isAbsolute(scratch))
    fail(503,'DOCUMENT_PAGES_RUNTIME_UNAVAILABLE','Configure the private local PDF runtime and scratch directory.');
  let python:string;
  try{python=await realpath(configured);await access(python);}catch{fail(503,'DOCUMENT_PAGES_RUNTIME_UNAVAILABLE','The configured local PDF runtime is unavailable.');}
  let seconds=Math.min(25,Math.floor((deadline-Date.now()-6000)/1000));
  if(seconds<1)fail(504,'DOCUMENT_PAGES_DEADLINE','Not enough time remains for bounded page inspection.');
  let dir:string|undefined,keepDirectory=false;
  try{
    try{dir=await privateOcrDirectory(scratch,randomUUID());}
    catch{fail(503,'DOCUMENT_PAGES_SCRATCH_UNAVAILABLE','Configure an available private PDF scratch directory outside the repository.');}
    const source=join(dir,'original.pdf'),output=join(dir,'output');
    await writeFile(source,bytes,{flag:'wx',mode:0o600});
    seconds=Math.min(25,Math.floor((deadline-Date.now()-6000)/1000));
    if(seconds<1)fail(504,'DOCUMENT_PAGES_DEADLINE','Not enough time remains for bounded page inspection.');
    const args=[join(settings.repositoryRoot,'scripts/usp/document-models/run_pdf_pages.py'),
      '--source',source,'--sha256',authority.sourceSha256,'--output',output,
      '--offset',String(selection.offset),'--limit',String(selection.limit),'--seconds',String(seconds)];
    if(selection.page!==undefined)args.push('--page',String(selection.page));
    let exit:number|null;
    try{exit=await execute(python!,args,Math.min((seconds+3)*1000,deadline-Date.now()));}
    catch{keepDirectory=true;runtimeBlocked=true;fail(503,'DOCUMENT_PAGES_CLEANUP_UNRESOLVED','Page inspection cleanup could not be confirmed; its private attempt was retained.');}
    live(deadline);
    let resultBytes:Buffer,receiptBytes:Buffer,execution:z.infer<typeof executionSchema>,outputValue:unknown;
    try{
      resultBytes=await readBoundedOcrArtifact(join(output,'result.json'),limits.metadataBytes);
      receiptBytes=await readBoundedOcrArtifact(join(output,'receipt.json'),16*1024);
      execution=executionSchema.parse(JSON.parse(receiptBytes.toString('utf8')));
      outputValue=JSON.parse(resultBytes.toString('utf8'));
    }catch{fail(503,'DOCUMENT_PAGES_RUNTIME_FAILED','The bounded PDF runtime did not produce a valid receipt.');}
    if(execution!.seconds!==seconds||execution!.resultSha256!==sha256(resultBytes!))
      fail(503,'DOCUMENT_PAGES_RUNTIME_FAILED','The PDF runtime receipt differs from its output.');
    if(exit!==0||execution!.worker.exitCode!==0||execution!.worker.stopReason!==null){
      const failure=z.strictObject({version:z.literal('document-pages-failure/1'),code:z.string().regex(/^DOCUMENT_PAGE(?:S)?_[A-Z_]+$/)}).safeParse(outputValue);
      if(failure.success)fail(422,failure.data.code,'The selected PDF page is unavailable under this bounded profile. The original remains retained.');
      fail(503,'DOCUMENT_PAGES_RUNTIME_FAILED','Page inspection failed or exceeded its process bounds.');
    }
    const parsed=DocumentPagesWorkerSchema.safeParse(outputValue);
    if(!parsed.success)fail(503,'DOCUMENT_PAGES_RUNTIME_FAILED','The PDF runtime returned invalid bounded page metadata.');
    const result=parsed.data;
    const png=selection.page===undefined?undefined:await readBoundedOcrArtifact(join(output,'page.png'),limits.pngBytes);
    return {result,png,execution:{...execution!,receiptSha256:sha256(receiptBytes!)}};
  }finally{if(dir&&!keepDirectory)await rm(dir,{recursive:true,force:true});}
}
const defaults:Dependencies={authorize,original,inspect:inspectPrivateDocumentPages};
let busy=false;
let runtimeBlocked=false;
function sameAuthority(before:DocumentPageAuthority,after:DocumentPageAuthority){
  if(fingerprint(before)!==fingerprint(after))conflict('The private document source or access context changed during page inspection.');
}
type ListedPage=DocumentPagesWorker['pages'][number];
/** A reduced picture is published only as reduced, at the scale its listing states; a picture at the normal
 * scale never carries the mark. The picture is for viewing: it leaves through `raster` to the HTTP answer
 * and is read by no OCR, measurement, packet or candidate path. */
function rasterMatchesListing(page:ListedPage,render:NonNullable<DocumentPagesWorker['render']>){
  if(page.renderSupport==='reduced')return render.reduced===true&&render.scale===page.reducedScalePxPerPt;
  return page.renderSupport==='supported'&&render.reduced===undefined;
}
/** One metadata parser or raster worker at a time in this local API process. */
export class DocumentPagesService{
  constructor(private readonly dependencies:Dependencies=defaults){}
  private async inspect(sourceValue:string,rawPin:unknown,selection:Selection){
    const sourceId=uuid.parse(sourceValue),pin=DocumentPagePinSchema.parse(rawPin);
    if(runtimeBlocked)fail(503,'DOCUMENT_PAGES_CLEANUP_UNRESOLVED','An earlier PDF process cleanup is unresolved. Restore the owned runtime before retrying.');
    if(busy)fail(429,'DOCUMENT_PAGES_BUSY','A PDF page inspection is running. Retry when it finishes.');
    busy=true;const deadline=Date.now()+limits.seconds*1000;
    try{
      const authority=await this.dependencies.authorize(sourceId,pin,deadline);
      const bytes=await this.dependencies.original(authority,deadline);
      if(bytes.length!==authority.sourceBytes||sha256(bytes)!==authority.sourceSha256)
        fail(422,'DOCUMENT_PAGES_SOURCE_INTEGRITY','The retained original failed its exact hash or length check.');
      sameAuthority(authority,await this.dependencies.authorize(sourceId,pin,deadline));
      const inspected=await this.dependencies.inspect(authority,bytes,selection,deadline);
      const parsed=DocumentPagesWorkerSchema.safeParse(inspected.result);
      if(!parsed.success)fail(503,'DOCUMENT_PAGES_RESULT_INTEGRITY','The bounded PDF runtime returned invalid page metadata.');
      const result=parsed.data;
      const offset=selection.page===undefined?selection.offset:selection.page-1,limit=selection.page===undefined?selection.limit:1;
      if(result.sourceSha256!==authority.sourceSha256||result.sourceBytes!==authority.sourceBytes||result.offset!==offset||result.limit!==limit||
        result.pages.length!==Math.min(limit,result.pageCount-offset)||result.pages.some((p,i)=>p.page!==offset+i+1))
        fail(503,'DOCUMENT_PAGES_RESULT_INTEGRITY','Page metadata differs from the exact source or selection.');
      if(selection.page!==undefined){
        const png=inspected.png,render=result.render;
        if(!png||!render||render.page!==selection.page||render.bytes!==png.length||sha256(png)!==render.sha256||
          png.length<24||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
          png.toString('ascii',12,16)!=='IHDR'||png.readUInt32BE(16)!==render.pixels[0]||png.readUInt32BE(20)!==render.pixels[1]||
          render.pixels[0]*render.pixels[1]>limits.pixels||!rasterMatchesListing(result.pages[0],render))
          fail(503,'DOCUMENT_PAGES_RESULT_INTEGRITY','The bounded raster differs from its page receipt.');
      }else if(result.render!==null||inspected.png!==undefined)
        fail(503,'DOCUMENT_PAGES_RESULT_INTEGRITY','A metadata selection cannot publish a raster.');
      sameAuthority(authority,await this.dependencies.authorize(sourceId,pin,deadline));live(deadline);
      return {authority,result,png:inspected.png};
    }finally{busy=false;}
  }
  async pages(sourceId:string,raw:unknown){
    const query=DocumentPagesQuerySchema.parse(raw);
    const {authority,result}=await this.inspect(sourceId,{revision:String(query.revision),sha256:query.sha256},query);
    const parameters=new URLSearchParams({revision:String(authority.sourceRevision),sha256:authority.sourceSha256});
    return DocumentPagesSchema.parse({version:'document-pages/1',caseId:authority.caseId,caseRevision:authority.caseRevision,
      sourceId:authority.sourceId,sourceRevision:authority.sourceRevision,sourceSha256:authority.sourceSha256,
      sourceBytes:authority.sourceBytes,name:authority.name,
      revision:String(authority.sourceRevision),pageCount:result.pageCount,offset:result.offset,limit:result.limit,
      hasMore:result.offset+result.pages.length<result.pageCount,
      pages:result.pages.map(page=>({...page,url:page.renderSupport==='unsupported'?null:
        `/api/v1/sources/${authority.sourceId}/pages/${page.page}/raster?${parameters}`,
        locator:{kind:'pdf_page',page:page.page},calibration:null})),
      anchors:result.pages.map(page=>({locator:`page:${page.page}`,page:page.page,region:null}))});
  }
  async raster(sourceId:string,page:number,raw:unknown){
    const selected=z.number().int().min(1).max(400).parse(page);
    const result=await this.inspect(sourceId,raw,{offset:selected-1,limit:1,page:selected});
    return {bytes:result.png!,sourceRevision:result.authority.sourceRevision,sourceSha256:result.authority.sourceSha256,
      page:selected,frame:result.result.pages[0].frame,render:result.result.render!};
  }
}
