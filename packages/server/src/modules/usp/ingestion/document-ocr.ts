/** Optional, local-only OCR bridge. The request supplies a page, never a command or asset path. */
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {access,mkdtemp,mkdir,open,realpath,rm,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {z} from 'zod';
import {DocumentOcrSchema,DocumentOcrExecutionSchema,type DocumentInput,type DocumentResult} from '@ulpin/contracts/usp';
import {settings} from '../../../infrastructure/config';
import {sha256} from '../../../infrastructure/storage';
import {documentFormat} from './document-native';

const names=['ULPIN_DOCUMENT_OCR_PYTHON','ULPIN_DOCUMENT_OCR_MODELS','ULPIN_DOCUMENT_OCR_TESSERACT',
  'ULPIN_DOCUMENT_OCR_TESSDATA','ULPIN_DOCUMENT_OCR_SCRATCH'] as const;
const doclingMethod='ocr:docling-slim-2.131.0:tesseract-cli-5.5.1:heron-pinned' as const;
const sparseMethod='ocr:tesseract-cli-5.5.1:sparse-tsv-v1' as const;
const expectedMethod=(input:OcrInput)=>input.ocrSelection?.region?doclingMethod:sparseMethod;
const resultLimit=128*1024,receiptLimit=64*1024;
type OcrInput=Pick<DocumentInput,'jobId'|'sourceSha256'|'sourceRevision'|'sourceBytes'|'ocrSelection'>;
export function documentOcrConfigSha(){
  return sha256(JSON.stringify({strategy:'source-ocr/2',wholePage:sparseMethod,selectedRegion:doclingMethod,
    psm:11,language:'eng',minimumWordConfidence:60,paths:names.map(name=>process.env[name]??null)}));
}
const candidate=z.object({schemaVersion:z.literal('source-ocr-candidate/1'),sourceSha256:z.string(),sourceBytes:z.number(),
  sourcePage:z.number(),sourcePageFrame:DocumentOcrSchema.shape.sourcePageFrame.unwrap(),
  selection:z.object({kind:z.enum(['whole_page','selected_region']),sourcePageBox:z.array(z.number()).length(4),
    textCompleteness:z.literal('unverified')}),method:DocumentOcrSchema.shape.method,
  toolStatus:z.enum(['complete','partial','failed','unavailable']),outputStatus:z.enum(['complete','partial','failed']),
  issues:z.array(z.string()),items:z.array(DocumentOcrSchema.shape.items.element)});
const receiptSchema=z.object({schemaVersion:z.literal('source-ocr-attempt/1'),
  source:z.object({sha256:z.string(),bytes:z.number(),page:z.number(),region:z.array(z.number()).length(4).nullable()}),
  limits:z.object({workerSeconds:z.number(),memoryBytes:z.literal(6*1024**3),cpuThreads:z.literal(2),
    resultBytes:z.literal(resultLimit)}),worker:DocumentOcrExecutionSchema.shape.worker.unwrap().strip(),
  result:z.object({sha256:z.string().nullable(),method:DocumentOcrSchema.shape.method})});

/** Never echo an exception message: map known failure classes to a closed, content-free vocabulary. */
export function sanitizedOcrFailure(attemptId:string,log:string,stopReason:string|null){
  const tail=log.slice(-4096),match=tail.match(/(?:^|\n)([A-Za-z][A-Za-z0-9_]{0,79}(?:Error|Exception)):/g)?.at(-1);
  const parsed=match?.trim().split(':')[0];
  const checked=DocumentOcrExecutionSchema.shape.failure.unwrap().shape.class.safeParse(parsed);
  const failureClass=checked.success?checked.data:'UnknownWorkerFailure';
  const message=stopReason?'Worker terminated by resource bound':/0xC0000135|3221225781|DLL load failed/i.test(tail)
    ?'Native dependency unavailable':/ModuleNotFoundError:|ImportError:/.test(tail)?'Python dependency unavailable'
      :match?'Worker exception; sensitive detail withheld':'Worker failed before producing diagnostics';
  return DocumentOcrExecutionSchema.shape.failure.unwrap().parse({attemptId,class:failureClass,message});
}

/** Check the opened file before reading; growth still cannot exceed the fixed buffer. */
export async function readBoundedOcrArtifact(path:string,limit:number){
  const file=await open(path,'r');
  try{
    const info=await file.stat();
    if(!info.isFile()||info.size>limit)throw new Error('OCR_ARTIFACT_LIMIT');
    const buffer=Buffer.alloc(limit+1);let length=0;
    while(length<buffer.length){const {bytesRead}=await file.read(buffer,length,buffer.length-length,null);
      if(!bytesRead)break;length+=bytesRead;}
    if(length>limit)throw new Error('OCR_ARTIFACT_LIMIT');
    return buffer.subarray(0,length);
  }finally{await file.close();}
}
/** Restrict the new attempt directory before any retained bytes are written. */
export async function privateOcrDirectory(scratch:string,jobId:string){
  z.uuid().parse(jobId);
  const scratchPath=resolve(scratch),inRepo=relative(settings.repositoryRoot,scratchPath);
  const outside=(path:string)=>path==='..'||path.startsWith(`..${sep}`)||isAbsolute(path);
  if(!isAbsolute(scratch)||!outside(inRepo))throw new Error('OCR_PRIVATE_SCRATCH_REQUIRED');
  await mkdir(scratchPath,{recursive:true,mode:0o700});
  const actual=await realpath(scratchPath),actualRepo=await realpath(settings.repositoryRoot),location=relative(actualRepo,actual);
  if(!outside(location))throw new Error('OCR_PRIVATE_SCRATCH_REQUIRED');
  const dir=await mkdtemp(join(actual,`document-ocr-${jobId}-`));
  try{
    const system=join(process.env.SystemRoot??'C:\\Windows','System32');
    const options={windowsHide:true,timeout:5000,env:{SystemRoot:process.env.SystemRoot??'C:\\Windows'}};
    const sid=execFileSync(join(system,'whoami.exe'),['/user','/fo','csv','/nh'],options).toString().match(/S-1-5-\d+(?:-\d+)+/)?.[0];
    if(!sid)throw new Error('OCR_PRIVATE_DIRECTORY_FAILED');
    execFileSync(join(system,'icacls.exe'),[dir,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],options);
    return dir;
  }catch(error){await rm(dir,{recursive:true,force:true});throw error;}
}
function unavailable(input:OcrInput,code:string):NonNullable<DocumentResult['ocr']>{
  return DocumentOcrSchema.parse({sourceSha256:input.sourceSha256,sourceRevision:input.sourceRevision,
    sourcePage:input.ocrSelection!.page,requestedRegion:input.ocrSelection!.region??null,sourcePageFrame:null,
    method:expectedMethod(input),toolStatus:'unavailable',outputStatus:'failed',textCompleteness:'unverified',issues:[code],items:[]});
}
function failed(input:OcrInput,code:string):NonNullable<DocumentResult['ocr']>{
  return {...unavailable(input,code),toolStatus:'failed'};
}
function childEnv(tesseract:string,tessdata:string){
  const keys=['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'];
  const env:Record<string,string>={};for(const key of keys)if(process.env[key])env[key]=process.env[key]!;
  env.PATH=dirname(tesseract)+';'+(env.PATH??'');env.TESSDATA_PREFIX=tessdata;
  env.HF_HUB_OFFLINE='1';env.TRANSFORMERS_OFFLINE='1';env.DOCLING_ARTIFACTS_PATH=process.env.ULPIN_DOCUMENT_OCR_MODELS!;
  env.OMP_NUM_THREADS='2';env.MKL_NUM_THREADS='2';env.OPENBLAS_NUM_THREADS='2';env.TOKENIZERS_PARALLELISM='false';
  return env;
}
function execute(python:string,args:string[],env:Record<string,string>,seconds:number){
  return new Promise<number|null>((resolve,reject)=>{
    const child=spawn(python,args,{cwd:settings.repositoryRoot,env,windowsHide:true,stdio:'ignore'});
    let settled=false,timedOut=false,cleanupTimer:ReturnType<typeof setTimeout>|undefined;
    const finish=(code:number|null)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(cleanupTimer);resolve(code);};
    const timer=setTimeout(()=>{
      // The Python supervisor has the shorter deadline and a Windows Job. This
      // is a final tree stop if it fails to return after its own bound.
      timedOut=true;
      if(child.pid)spawnSync(join(process.env.SystemRoot??'C:\\Windows','System32','taskkill.exe'),
        ['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:3000,stdio:'ignore'});
      cleanupTimer=setTimeout(()=>{if(!settled){settled=true;reject(new Error('OCR_CHILD_CLEANUP_UNRESOLVED'));}},3000);
    },(seconds+5)*1000);
    child.on('error',()=>finish(null));child.on('close',code=>finish(timedOut?null:code));
  });
}
export async function runSourceOcr(input:OcrInput,original:Uint8Array,deadline:number):Promise<NonNullable<DocumentResult['ocr']>>{
  if(!input.ocrSelection)throw new Error('OCR_SELECTION_REQUIRED');
  if(process.platform!=='win32')return unavailable(input,'OCR_PLATFORM_UNAVAILABLE');
  if(documentFormat(original)!=='pdf')return unavailable(input,'OCR_PDF_REQUIRED');
  const [python,models,tesseract,tessdata,scratch]=names.map(name=>process.env[name]);
  if(!python||!models||!tesseract||!tessdata||!scratch)return unavailable(input,'OCR_RUNTIME_UNAVAILABLE');
  if([python,models,tesseract,tessdata,scratch].some(path=>! /^[A-Za-z]:[\\/]/.test(path)))
    return unavailable(input,'OCR_LOCAL_PATHS_REQUIRED');
  try{await Promise.all([python,join(models,'docling-project--docling-layout-heron','model.safetensors'),
    tesseract,join(tessdata,'eng.traineddata')].map(path=>access(path)));}
  catch{return unavailable(input,'OCR_RUNTIME_UNAVAILABLE');}
  let seconds=Math.min(90,Math.floor((deadline-Date.now()-12000)/1000));
  if(seconds<1)return failed(input,'OCR_DEADLINE');
  let dir:string|undefined,keepDirectory=false;
  let execution:NonNullable<DocumentResult['ocr']>['execution'];
  const finish=(value:NonNullable<DocumentResult['ocr']>)=>({...value,...(execution?{execution}:{})});
  try{
    dir=await privateOcrDirectory(scratch,input.jobId);
    const source=join(dir,'original.pdf'),output=join(dir,'output');
    await writeFile(source,original,{flag:'wx',mode:0o600});
    seconds=Math.min(90,Math.floor((deadline-Date.now()-12000)/1000));
    if(seconds<1)return failed(input,'OCR_DEADLINE');
    const args=[join(settings.repositoryRoot,'scripts/usp/document-models/run_source_ocr.py'),
      '--source',source,'--expected-source-sha256',input.sourceSha256,'--page',String(input.ocrSelection.page),
      '--models',models,'--tesseract',tesseract,'--tessdata',tessdata,'--output',output,
      '--max-seconds',String(seconds),'--max-items','64'];
    if(input.ocrSelection.region)args.push('--region',...input.ocrSelection.region.map(String));
    const exitCode=await execute(python,args,childEnv(tesseract,tessdata),seconds);
    execution={maxSeconds:seconds,exitCode,receiptSha256:null,candidateSha256:null,worker:null};
    let receipt:ReturnType<typeof receiptSchema.parse>|undefined;
    try{
      const receiptBytes=await readBoundedOcrArtifact(join(output,'receipt.json'),receiptLimit);
      const parsed=receiptSchema.parse(JSON.parse(receiptBytes.toString('utf8')));
      if(parsed.source.sha256!==input.sourceSha256||parsed.source.bytes!==input.sourceBytes||parsed.source.page!==input.ocrSelection.page||
        JSON.stringify(parsed.source.region)!==JSON.stringify(input.ocrSelection.region??null)||parsed.limits.workerSeconds!==seconds)
        throw new Error('OCR_RECEIPT_SCOPE');
      receipt=parsed;execution.receiptSha256=sha256(receiptBytes);execution.worker=parsed.worker;
    }catch{/* A failure before worker startup may have no receipt. Success requires it below. */}
    if(exitCode!==0){
      let log='';
      try{
        log=(await readBoundedOcrArtifact(join(output,'worker.log'),2*1024**2)).toString('utf8');
      }catch{/* bounded absence */}
      execution.failure=sanitizedOcrFailure(input.jobId,log,execution.worker?.stopReason??null);
    }
    const path=join(output,'result.json');let bytes:Buffer;
    try{bytes=await readBoundedOcrArtifact(path,resultLimit);}catch(error){
      return finish(error instanceof Error&&error.message==='OCR_ARTIFACT_LIMIT'?failed(input,'OCR_RESULT_LIMIT'):
        exitCode===2?unavailable(input,'OCR_RUNTIME_UNAVAILABLE'):failed(input,exitCode===null?'OCR_SUPERVISOR_TIMEOUT':'OCR_RESULT_MISSING'));}
    execution.candidateSha256=sha256(bytes);
    if(exitCode!==0){
      const failure=z.object({sourceSha256:z.string(),sourcePage:z.number(),toolStatus:z.enum(['unavailable','failed']),
        issues:z.array(z.string().regex(/^[a-z_]{1,80}$/)).min(1)}).safeParse(JSON.parse(bytes.toString('utf8')));
      if(failure.success && failure.data.sourceSha256===input.sourceSha256 && failure.data.sourcePage===input.ocrSelection.page){
        const code=`OCR_${failure.data.issues[0].toUpperCase()}`;
        return finish(failure.data.toolStatus==='unavailable'?unavailable(input,code):failed(input,code));
      }
      return finish(failed(input,'OCR_SUPERVISOR_FAILED'));
    }
    if(!receipt||receipt.result.sha256!==execution.candidateSha256||receipt.result.method!==expectedMethod(input)||
      receipt.worker.exitCode!==0||receipt.worker.stopReason!==null)
      return finish(failed(input,'OCR_RECEIPT_INVALID'));
    const raw=candidate.parse(JSON.parse(bytes.toString('utf8')));
    if(raw.method!==expectedMethod(input)||raw.sourceSha256!==input.sourceSha256||raw.sourceBytes!==input.sourceBytes||raw.sourcePage!==input.ocrSelection.page||
      JSON.stringify(raw.selection.sourcePageBox)!==JSON.stringify(input.ocrSelection.region??[0,0,raw.sourcePageFrame.width,raw.sourcePageFrame.height])||
      raw.selection.kind!==(input.ocrSelection.region?'selected_region':'whole_page')||
      raw.items.reduce((n,item)=>n+Buffer.byteLength(item.text,'utf8'),0)>32*1024)return finish(failed(input,'OCR_RESULT_SCOPE'));
    return DocumentOcrSchema.parse({sourceSha256:input.sourceSha256,sourceRevision:input.sourceRevision,
      sourcePage:raw.sourcePage,requestedRegion:input.ocrSelection.region??null,sourcePageFrame:raw.sourcePageFrame,
      method:raw.method,toolStatus:raw.toolStatus,outputStatus:raw.outputStatus,textCompleteness:'unverified',
      issues:raw.issues,items:raw.items,execution});
  }catch(error){
    const code=error instanceof Error?error.message:'';
    if(code==='OCR_CHILD_CLEANUP_UNRESOLVED')keepDirectory=true;
    return finish(failed(input,code==='OCR_CHILD_CLEANUP_UNRESOLVED'?code:
      code==='OCR_PRIVATE_SCRATCH_REQUIRED'?code:'OCR_BRIDGE_FAILED'));
  }
  finally{if(dir&&!keepDirectory)await rm(dir,{recursive:true,force:true});}
}
