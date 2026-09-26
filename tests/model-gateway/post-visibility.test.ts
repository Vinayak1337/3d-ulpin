import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { AppError, conflict } from '@ulpin/server/infrastructure/errors';
import { digest, validateExtraction, PROMPT_VERSION, SCHEMA_VERSION } from '@ulpin/server/modules/ai/officer-ai-validation';
import { redactDerivative } from '@ulpin/server/modules/usp/ingest/redact';

// The review's isolated protocol reproduction: compile actual functions, stub only their
// IO/principal/snapshot seams. No source/property records, DB, provider or API qualification.
test('terminal extraction POST withholds prior output after repair authorization fails, retaining history/billing',async()=>{
  const source=readFileSync(new URL('../../packages/server/src/modules/ai/officer-ai.ts',import.meta.url),'utf8');
  const section=(start:string,end:string)=>{
    const first=source.indexOf(start),last=source.indexOf(end,first);
    assert(first>=0 && last>first);return source.slice(first,last).replace(/^export /gm,'');
  };
  const functions=[section('async function extract(','async function applyRun('),
    section('async function projectCurrentRun(','export async function listOfficerAiRuns('),
    section('export async function createOfficerAiRun(','export async function applyOfficerAiRun(')].join('\n');
  let revision=0,providerCalls=0;
  const history:any[]=[];
  const sandbox:any={AppError,conflict,randomUUID,digest,validateExtraction,PROMPT_VERSION,SCHEMA_VERSION,redactDerivative,
    uuid:{parse:(value:unknown)=>value},officerAiExtractSchema:{parse:(value:unknown)=>value},
    query:async(sql:string)=>({rows:[],rowCount:sql.startsWith('INSERT')?1:0}),
    getPackage:async()=>({revision}),snapshot:async()=>({fingerprint:digest('control-only-scope'),parts:[],entityIds:[],
      sourceHashes:[],partHashes:[],context:{operatorAnswers:[]},entities:[],frames:[],geometryFrames:[]}),
    saveRun:async(run:any)=>{history.push(JSON.parse(JSON.stringify(run)));if(run.calls.length===1)revision=1;},
    recoverInterruptedRun:async(run:any)=>redactDerivative(run),assertNoImageEgress:()=>{},assertCurrentGatewayPolicy:()=>{},
    localOperatorSubject:()=> 'control-only-principal',modelGatewayPolicyHash:()=>digest('control-only-policy'),
    aiBudget:()=>({maxCalls:2,maxOutputTokens:2048,timeoutMs:45000}),
    inspectModelGateway:async()=>({status:{state:'available',capabilities:{image:false}},model:{id:'sarvam-105b'}}),
    selectedImageCrops:async()=>[],extractionMessages:()=>[],extractionSchema:{},minimizeExtractionOutput:(value:unknown)=>value,
    localRequestContext:()=>({}),
    modelGatewayRuntime:async()=>({config:{policyVersion:'control-only-policy'},port:(trusted:any)=>({modelGateway:async()=>{
      await trusted.authorize();providerCalls++;
      return {state:'available',data:{output:{candidates:[{invalidCandidate:true}],questions:['control-only output']},
        receipt:{httpStatus:200,responseHash:digest('control-only-response'),actualMicroInr:'1',priceVersion:'control-only-price',callId:randomUUID()}}};
    }})}),
  };
  vm.runInNewContext(ts.transpileModule(functions+'\nglobalThis.controlCreate=createOfficerAiRun;',
    {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,sandbox);
  const result=await sandbox.controlCreate('control-only-scope',{partIds:[],requestKey:'control-only-invocation',expectedRevision:0,mode:'live'});
  assert.equal(result.state,'stale');assert.equal(providerCalls,1);assert.equal(revision,1);
  assert.equal(result.questions.length,0);assert.equal(result.validationErrors.length,0);assert.equal(result.candidates.length,0);
  assert.equal(result.calls.length,1);assert.equal(result.calls[0].actualMicroInr,'1');
  const retained=history.at(-1);
  assert.equal(retained.state,'stale');assert.equal(retained.questions.length,2);assert.equal(retained.validationErrors.length,1);
  assert.equal(retained.calls.length,1);assert.equal(retained.calls[0].actualMicroInr,'1');
});
