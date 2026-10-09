import {appendFileSync,mkdirSync,readdirSync,readFileSync,statSync,openSync,closeSync,existsSync,realpathSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {hash,type GatewayConfig} from './config';
import {cost} from './pricing';
import type {ProviderFailure,ProviderResult,RetainedReplay} from './adapter';

export const DEFAULT_TEACHER_RECORDINGS='E:/BhuAayam-data/runtime/teacher-recordings/';
/** Also reject OTHER checkouts and existing symlink ancestors, not just this worktree. */
export function assertTeacherOutputOutsideGit(path:string){
  let existing=resolve(path);
  while(!existsSync(existing)){const parent=dirname(existing);if(parent===existing)throw new Error('TEACHER_OUTPUT_UNAVAILABLE');existing=parent;}
  let cursor=realpathSync(existing);
  for(;;){
    if(existsSync(join(cursor,'.git')))throw new Error('TEACHER_OUTPUT_IN_GIT');
    const parent=dirname(cursor);if(parent===cursor)break;cursor=parent;
  }
}
export type TeacherRecording={version:'teacher-recording/1';recordedAt:string;adapterKind:'sarvam'|'control'|'replay';templateVersion:string;model:string;
  requestHash:string;profileHash:string;replayKey:string;attempt:number;latencyMs:number;
  rawResponse:unknown;responseHash:string|null;response?:ProviderResult;responseIntegrity?:string;parsedPlan:unknown;validation:unknown;
  tokens:ProviderResult['usage']|null;costMicroInr:string|null;priceVersion:string;failureCode?:string};
/** Adds a unique session JSONL; never overwrites/appends an existing session or puts responses in Git. */
export class TeacherRecordings {
  readonly directory:string;
  private file?:string;
  constructor(directory=process.env.ULPIN_TEACHER_RECORDINGS_DIR??DEFAULT_TEACHER_RECORDINGS){
    this.directory=resolve(directory);
    assertTeacherOutputOutsideGit(this.directory);
  }
  prepare(){
    if(this.file)return;
    assertTeacherOutputOutsideGit(this.directory);
    mkdirSync(this.directory,{recursive:true});
    const path=resolve(this.directory,`teacher-${randomUUID()}.jsonl`);
    const fd=openSync(path,'wx',0o600);closeSync(fd);this.file=path;
  }
  async record(event:{adapterKind:'sarvam'|'control'|'replay';templateVersion:string;model:string;profileHash:string;replayKey:string;attempt:number;
    inputHash:string;latencyMs:number;result?:ProviderResult;failure?:ProviderFailure;parsedPlan:unknown;
    validation:unknown;price:GatewayConfig['price']}){
    this.prepare();let actual:string|null=null;
    try{if(event.result?.usage)actual=cost(event.result.usage,event.price).toString();}catch{/* conservative ledger exposure, not zero */}
    const entry:TeacherRecording={version:'teacher-recording/1',recordedAt:new Date().toISOString(),adapterKind:event.adapterKind,
      templateVersion:event.templateVersion,model:event.model,requestHash:event.inputHash,profileHash:event.profileHash,
      replayKey:event.replayKey,attempt:event.attempt,latencyMs:event.latencyMs,
      rawResponse:event.result?.rawResponse??event.result?.output??event.failure?.rawResponse??null,
      responseHash:event.result?.responseHash??event.failure?.responseHash??null,
      ...(event.result?{response:event.result,responseIntegrity:hash(event.result)}:{}),parsedPlan:event.parsedPlan,
      validation:event.validation,tokens:event.result?.usage??null,costMicroInr:actual,priceVersion:event.price.version,
      ...(event.failure?{failureCode:event.failure.kind}:{})};
    appendFileSync(this.file!,JSON.stringify({...entry,recordHash:hash(entry)})+'\n',{encoding:'utf8',mode:0o600});
  }
  async replay(key:string,allowedAdapters:readonly string[]=['sarvam','control']):Promise<RetainedReplay|undefined>{
    let files:string[];try{files=readdirSync(this.directory).filter(name=>/^teacher-[a-f0-9-]+\.jsonl$/.test(name)).sort();}catch{return undefined;}
    let retained:RetainedReplay|undefined;
    for(const name of files){
      const path=resolve(this.directory,name);if(statSync(path).size>16*1024*1024)continue;
      for(const line of readFileSync(path,'utf8').split('\n').filter(Boolean)){
        try{
          const {recordHash,...entry}=JSON.parse(line) as TeacherRecording&{recordHash:string};
          if(entry.version!=='teacher-recording/1'||!allowedAdapters.includes(entry.adapterKind)||hash(entry)!==recordHash||entry.replayKey!==key
            ||entry.replayKey!==hash({template:entry.templateVersion,profileHash:entry.profileHash,model:entry.model})
            ||!entry.response||hash(entry.response)!==entry.responseIntegrity||entry.response.semanticError
            ||!(entry.validation as {success?:boolean})?.success||!entry.parsedPlan)continue;
          retained={inputHash:entry.requestHash,sourceHashes:[entry.profileHash],replayKey:key,
            responseHash:entry.responseIntegrity!,response:entry.response,eligible:true};
        }catch{/* a broken or partial line is not replayable */}
      }
    }
    return retained;
  }
}
