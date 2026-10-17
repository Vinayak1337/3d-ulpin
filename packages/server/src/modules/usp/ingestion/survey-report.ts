import {DOCUMENT_LIMITS,type DocumentInput,type DocumentResult,type RequestContext} from '@ulpin/contracts/usp';
import {HeadObjectCommand,S3Client} from '@aws-sdk/client-s3';
import {SURVEY_REPORT_LIMITS,SurveyReportRequestSchema,type SurveyReportRequest} from '../../../../../contracts/src/survey-report';
import {transaction} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {settings} from '../../../infrastructure/config';
import {openObjectStream} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {lockSourceCaseDestinationTx} from '../../cases/source-case-lock';
import {assertLocalUsp} from '../snapshots';
import {associationDocumentInputTx} from './document-association-authority';
import {documentResultKey} from './documents';
import {readFusionResult,readFusionObject,fusionLive,type FusionBudget} from './source-fusion-authority';
import {surveyReportProjection} from './survey-report-parser';

type Capture={input:DocumentInput;acceptedFence:number;resultRefSha256:string};
type Budget=FusionBudget;
type CaptureDependencies={transaction:typeof transaction;source:typeof associationDocumentInputTx;gate:typeof lockSourceCaseDestinationTx};
const captureDefaults:CaptureDependencies={transaction,source:associationDocumentInputTx,gate:lockSourceCaseDestinationTx};
/** The same canonical document authority, in a short deadline-aware capture.
 * No storage I/O under these locks. The complete capture is repeated before disclosure. */
export async function captureSurveyDocument(ctx:RequestContext,pin:SurveyReportRequest['document'],budget:Budget,
  expected?:Capture,deps:CaptureDependencies=captureDefaults):Promise<Capture>{
  assertLocalUsp(ctx);fusionLive(budget);
  return deps.transaction(async client=>{
    await deps.gate(client,pin.caseId);
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE',[pin.caseId]);
    await client.query('SELECT id FROM sources WHERE id=$1 FOR SHARE',[pin.sourceId]);
    const input=await deps.source(client,ctx,pin,expected?.input,true);
    const row=(await client.query('SELECT accepted_fence,result_ref FROM usp_job_metadata WHERE job_id=$1',[pin.jobId])).rows[0];
    const fence=Number(row?.accepted_fence);
    if(row?.result_ref?.sha256!==pin.resultSha256||!Number.isSafeInteger(fence)||fence<1)
      throw new AppError(422,'SURVEY_REPORT_RESULT_PIN','The accepted document needs an exact result/attempt receipt.');
    const capture={input,acceptedFence:fence,resultRefSha256:fingerprint(row.result_ref)};
    if(expected&&fingerprint(capture)!==fingerprint(expected))conflict('The complete accepted survey document context changed.');
    fusionLive(budget);assertLocalUsp(ctx);return capture;
  },{deadlineAt:budget.deadlineAt,signal:budget.signal});
}

// Accepted document AssetRef has no byte count. Like the existing bounded
// raster/point leaves, HEAD only its canonical content-addressed key, outside
// locks. The temporary metadata client is always closed, and GET pins its ETag.
async function surveyResultHead(key:string,budget:Budget){
  fusionLive(budget);
  const client=new S3Client({endpoint:settings.s3Endpoint,region:settings.s3Region,forcePathStyle:true,
    credentials:{accessKeyId:settings.s3AccessKey,secretAccessKey:settings.s3SecretKey}});
  try{
    const response=await client.send(new HeadObjectCommand({Bucket:settings.s3Bucket,Key:key}),
      {abortSignal:AbortSignal.any([budget.signal,AbortSignal.timeout(Math.max(1,budget.deadlineAt-Date.now()))])});
    fusionLive(budget);return {bytes:response.ContentLength,etag:response.ETag};
  }catch(error){fusionLive(budget);throw error;}finally{client.destroy();}
}

/** readDocumentResult checks size only AFTER unbounded buffering and has no
 * cancellation input. Reuse the existing bounded document adapter, which uses
 * its schema/key/input/part/unit integrity conventions, without changing that
 * shared reader or its recipe. All extra read pins below are server captured. */
export async function readSurveyDocument(request:SurveyReportRequest,capture:Capture,budget:Budget,
  deps:{head:typeof surveyResultHead;open:typeof openObjectStream}={head:surveyResultHead,open:openObjectStream}):Promise<DocumentResult>{
  const key=documentResultKey(request.document.jobId,request.document.resultSha256);
  const head=await deps.head(key,budget),size=head.bytes;
  if(size===undefined||!Number.isSafeInteger(size)||size<1||size>DOCUMENT_LIMITS.resultBytes||!head.etag)
    throw new AppError(413,'SURVEY_REPORT_RESULT_LIMIT','The stored extraction must have bounded exact size and streaming metadata.');
  const pin={...request.document,readerSha256:capture.input.readerSha256,inputSha256:fingerprint(capture.input),
    acceptedFence:capture.acceptedFence,resultBytes:size};
  const read=await readFusionResult({kind:'document',pin,partIds:[]},
    {kind:'document',input:capture.input,acceptedFence:capture.acceptedFence},budget,
    (selectedKey,bytes,hash,bounds)=>readFusionObject(selectedKey,bytes,hash,bounds,
      (k,n,timeout,_etag,signal)=>deps.open(k,n,timeout,head.etag,signal)));
  if(read.kind!=='document')throw new AppError(422,'SURVEY_REPORT_RESULT_PIN','The exact result must be a native document.');
  return read.result;
}
type Dependencies={source:typeof captureSurveyDocument;result:typeof readSurveyDocument};
const defaults:Dependencies={source:captureSurveyDocument,result:readSurveyDocument};
export async function inspectSurveyReport(ctx:RequestContext,raw:unknown,deps:Dependencies=defaults){
  const request=SurveyReportRequestSchema.parse(raw);assertLocalUsp(ctx);
  const controller=new AbortController(),deadlineAt=Date.now()+SURVEY_REPORT_LIMITS.deadlineMs;
  const timer=setTimeout(()=>controller.abort(),SURVEY_REPORT_LIMITS.deadlineMs);timer.unref();
  const budget:Budget={deadlineAt,signal:controller.signal,reservedBytes:0};
  try{
    const captured=await deps.source(ctx,request.document,budget);
    if(captured.input.mode!=='native_only'||captured.input.ocrSelection||captured.input.archiveSelection)
      throw new AppError(422,'SURVEY_REPORT_LAYOUT','Choose a native-only document result without OCR or archive selection.');
    const result=await deps.result(request,captured,budget);fusionLive(budget);
    if(fingerprint(result.input)!==fingerprint(captured.input))conflict('The accepted report input changed.');
    const context=surveyReportProjection(request,result);fusionLive(budget);
    if(Buffer.byteLength(JSON.stringify(context))>SURVEY_REPORT_LIMITS.responseBytes-4096)
      throw new AppError(413,'SURVEY_REPORT_RESPONSE_LIMIT','The cited report exceeds the bounded response profile; no rows were truncated.');
    const current=await deps.source(ctx,request.document,budget,captured);
    if(fingerprint(current)!==fingerprint(captured))conflict('The accepted survey document context changed before disclosure.');
    fusionLive(budget);assertLocalUsp(ctx);return context;
  }finally{clearTimeout(timer);controller.abort();}
}
export class SurveyReportService{
  inspect(ctx:RequestContext,input:unknown){return inspectSurveyReport(ctx,input);}
}
