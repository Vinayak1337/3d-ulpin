import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {CITYJSON_VERSION,CITYJSON_LIMITS,CityJSONInputSchema,CityJSONSummarySchema,
  CityJSONResultSchema,type CityJSONInput} from '@ulpin/contracts/usp';
import {query,transaction} from '../../../infrastructure/db';
import {settings} from '../../../infrastructure/config';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {putOriginal,readObject,sha256} from '../../../infrastructure/storage';
import {fingerprint} from '../../cases/domain';
import {claimUspJobAttempt,acceptUspJobAttempt,assertUspJobAttemptTx,type UspJobAttempt} from '../jobs';
import {appendCaseIngestionTx} from './events';
import {assertCityJSONInputTx,cityjsonArtifactKey,cityjsonResultKey,readCityJSONResult,boundedCityJSONObject} from './cityjson';

const reply=z.strictObject({summary:CityJSONSummarySchema,readerSha256:z.string().regex(/^[a-f0-9]{64}$/),artifactBase64:z.string().max(Math.ceil(CITYJSON_LIMITS.artifactBytes/3)*4),
  artifactSha256:z.string().regex(/^[a-f0-9]{64}$/),artifactBytes:z.number().int().positive().max(CITYJSON_LIMITS.artifactBytes)});
async function putExact(key:string,bytes:Buffer,mediaType:string){
  try{await putOriginal(key,bytes,mediaType);}catch(error){
    const prior=Buffer.from(await readObject(key).catch(()=>{throw error;}));
    if(prior.length!==bytes.length||sha256(prior)!==sha256(bytes))throw error;
  }
}
async function nativeCityJSON(input:CityJSONInput){
  const response=await fetch(`${settings.geoUrl}/internal/cityjson/native`,{method:'POST',headers:{
    Authorization:`Bearer ${settings.geoToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({sourceId:input.sourceId,objectKey:input.objectKey,sha256:input.sourceSha256,
      bytes:input.sourceBytes,readerSha256:input.readerSha256,selection:input.selection}),signal:AbortSignal.timeout(80_000)});
  const limit=Math.ceil(CITYJSON_LIMITS.artifactBytes/3)*4+CITYJSON_LIMITS.resultBytes;
  const body=response.body?.getReader();if(!body)throw new AppError(503,'CITYJSON_PROCESSOR_UNAVAILABLE','Native reader returned no body.');
  const parts:Uint8Array[]=[];let size=0;
  try{while(true){const item=await body.read();if(item.done)break;size+=item.value.length;
    if(size>limit)throw new AppError(413,'CITYJSON_REPLY_LIMIT','Native response exceeds its private profile.');parts.push(item.value);}}
  finally{await body.cancel();}
  const decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
  if(response.status===422){const code=typeof decoded.detail==='string'&&/^CITYJSON_[A-Z_]{1,60}$/.test(decoded.detail)?decoded.detail:'CITYJSON_MALFORMED';
    throw new AppError(422,code,'Native reading failed; unchanged original is retained and can be retried.');}
  if(!response.ok)throw new AppError(503,'CITYJSON_PROCESSOR_UNAVAILABLE','The native reader is unavailable; retry the retained original.');
  const parsed=reply.parse(decoded),bytes=Buffer.from(parsed.artifactBase64,'base64');
  if(parsed.readerSha256!==input.readerSha256||parsed.summary.sourceSha256!==input.sourceSha256||parsed.summary.sourceBytes!==input.sourceBytes
    ||bytes.length!==parsed.artifactBytes||sha256(bytes)!==parsed.artifactSha256)
    throw new AppError(422,'CITYJSON_ARTIFACT_INTEGRITY','The native result does not match the pinned reader and original.');
  return {summary:parsed.summary,bytes,hash:parsed.artifactSha256};
}
export async function failCityJSONJob(jobId:string,code:string,attempt?:UspJobAttempt){
  await transaction(async client=>{
    const job=(await client.query("SELECT * FROM jobs WHERE id=$1 AND operation='cityjson-native' FOR UPDATE",[jobId])).rows[0];
    if(!job||!['queued','running'].includes(job.status))return;
    if(attempt){try{await assertUspJobAttemptTx(client,attempt);}catch{return;}}
    const stale=code==='CITYJSON_INPUT_STALE';
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'",[jobId]);
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",[jobId]);
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[jobId,stale?'stale':'failed',code]);
    if(job.payload.subject===process.env.ULPIN_LOCAL_OPERATOR_SUBJECT)
      await appendCaseIngestionTx(client,job.case_id,{kind:'cityjson-native.changed',sourceId:job.source_id,
        sourceRevision:job.payload.sourceRevision,jobId,status:stale?'stale':'failed'},job.payload.subject);
  });
}
export async function runCityJSONJob(jobId:string){
  const job=(await query("SELECT * FROM jobs WHERE id=$1 AND operation='cityjson-native'",[jobId])).rows[0]??notFound('CityJSON job not found.');
  if(!['queued','running'].includes(job.status))return;
  const input=CityJSONInputSchema.parse(job.payload);
  if(input.jobId!==jobId||input.caseId!==job.case_id||input.sourceId!==job.source_id||fingerprint(input)!==job.input_fingerprint)
    throw new AppError(422,'CITYJSON_JOB_INTEGRITY','Stored job input is not its enrolled payload.');
  const beforeLocks=async(client:Parameters<typeof assertCityJSONInputTx>[0])=>{await assertCityJSONInputTx(client,input,true);};
  let attempt:UspJobAttempt;
  try{attempt=await claimUspJobAttempt(jobId,`cityjson:${randomUUID()}`,beforeLocks);}
  catch(error){
    const active=(await query("SELECT 1 FROM usp_job_attempts WHERE job_id=$1 AND state='active' AND lease_until>now() LIMIT 1",[jobId])).rowCount;
    if(active)return;
    await failCityJSONJob(jobId,error instanceof AppError&&error.status===409?'CITYJSON_INPUT_STALE':'CITYJSON_CONTEXT_UNAVAILABLE');return;
  }
  try{
    await transaction(async client=>{await beforeLocks(client);await assertUspJobAttemptTx(client,attempt);
      await appendCaseIngestionTx(client,input.caseId,{kind:'cityjson-native.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId,status:'running'},input.subject);});
    const native=await nativeCityJSON(input);
    const artifact={key:cityjsonArtifactKey(jobId,native.hash),sha256:native.hash,bytes:native.bytes.length,
      mediaType:'application/json' as const,profile:'source-native-cityjson/1' as const};
    await putExact(artifact.key,native.bytes,artifact.mediaType);
    const result=CityJSONResultSchema.parse({version:CITYJSON_VERSION,input,summary:native.summary,
      artifact,createdAt:new Date().toISOString()});
    const bytes=Buffer.from(JSON.stringify(result));
    if(bytes.length>CITYJSON_LIMITS.resultBytes)throw new AppError(413,'CITYJSON_RESULT_LIMIT','The native summary exceeds the bounded result budget.');
    const hash=sha256(bytes),asset={assetId:`cityjson:${jobId}`,version:1,sha256:hash};
    await putExact(cityjsonResultKey(jobId,hash),bytes,'application/json');
    await acceptUspJobAttempt(attempt,asset,async(client,current,accepted)=>{
      if(current.operation!=='cityjson-native'||fingerprint(current.payload)!==fingerprint(input)||current.input_fingerprint!==attempt.inputSha256)
        conflict('The CityJSON job input changed before publication.');
      const verified=await readCityJSONResult(input,accepted.sha256);
      const stored=await boundedCityJSONObject(verified.artifact.key,verified.artifact.bytes);
      if(stored.length!==verified.artifact.bytes||sha256(stored)!==verified.artifact.sha256)
        throw new AppError(422,'CITYJSON_ARTIFACT_INTEGRITY','The staged native artifact differs from its receipt.');
      await assertCityJSONInputTx(client,input);
    },beforeLocks,async client=>{
      await appendCaseIngestionTx(client,input.caseId,{kind:'cityjson-native.changed',sourceId:input.sourceId,
        sourceRevision:input.sourceRevision,jobId,status:'completed'},input.subject);
    });
  }catch(error){
    await failCityJSONJob(jobId,error instanceof AppError&&error.status===409?'CITYJSON_INPUT_STALE':
      error instanceof AppError?error.code:'CITYJSON_PROCESSING_FAILED',attempt);
  }
}
