import {randomUUID} from 'node:crypto';
import {PacketPdfJobInputSchema} from '../../../../../contracts/src/usp/packet-pdf-jobs';
import {PACKET_PDF_MULTI_LIMITS} from '../../../../../contracts/src/usp/packet-pdf';
import {query,transaction,DbCommitOutcomeUnknown,type DbDeadline} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {claimUspJobAttempt,acceptUspJobAttempt,assertUspJobAttemptTx,type UspJobAttempt} from '../jobs';
import {requestReceiptTx} from '../commands';
import {savePlanReceiptTx} from './plan-store';
import {pdfPacketStorage,stagePdfExecution,publishPdfExecutionTx,pdfExecutionLive,type PdfPacketIo} from './pdf-service';
import {packetPdfJobContext,capturePacketPdfJobTx,assertPacketPdfJobRow,preparePacketPdfJobTx} from './pdf-job-authority';
import {appendPacketPdfJobTx} from './pdf-jobs';

function failureCode(error:unknown){
  if(error instanceof AppError){
    if(error.code==='DB_DEADLINE'||/DEADLINE|TIMEOUT/.test(error.code))return 'PACKET_PDF_DEADLINE';
    if(error.status===403||error.status===404)return 'PACKET_PDF_ACCESS_REVOKED';
    if(error.status===409)return 'PACKET_PDF_INPUT_STALE';
    if(/^PACKET_[A-Z_]{1,80}$/.test(error.code))return error.code;
  }
  return 'PACKET_PDF_PROCESSING_FAILED';
}
/** Bookkeeping never destroys output, rewrites an ambiguous commit, or fences a newer owner. */
export async function failPacketPdfJob(jobId:string,code:string,attempt?:UspJobAttempt){
  return transaction(async client=>{
    const job=(await client.query("SELECT * FROM jobs WHERE id=$1 AND operation='packet-pdf' FOR UPDATE",[jobId])).rows[0];
    if(!job||!['queued','running'].includes(job.status))return;
    const meta=(await client.query('SELECT * FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE',[jobId])).rows[0];
    if(!meta||['succeeded','cancelled','paused'].includes(meta.logical_state))return;
    const latest=(await client.query('SELECT * FROM usp_job_attempts WHERE job_id=$1 ORDER BY number DESC LIMIT 1 FOR UPDATE',[jobId])).rows[0];
    if(attempt&&(!latest||Number(latest.fence)!==attempt.fence||latest.owner!==attempt.owner||latest.state!=='active'||
      latest.input_sha256!==attempt.inputSha256||meta.input_sha256!==attempt.inputSha256))return;
    if(!attempt&&latest?.state==='active'&&new Date(latest.lease_until).getTime()>Date.now())return;
    await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'",[jobId]);
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",[jobId]);
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',[jobId,'failed',code]);
    // Do not emit private plan context after source/access denial.
  },{deadlineAt:Date.now()+2000});
}
export async function runPacketPdfJob(jobId:string,io:PdfPacketIo=pdfPacketStorage,options:{deadlineAt?:number;signal?:AbortSignal}={}){
  if(options.deadlineAt!==undefined&&!Number.isFinite(options.deadlineAt))
    throw new AppError(422,'PACKET_PDF_DEADLINE','Use a finite server operation deadline.');
  const deadlineAt=Math.min(Date.now()+PACKET_PDF_MULTI_LIMITS.seconds*1000,options.deadlineAt??Infinity),
    bounds:DbDeadline={deadlineAt,signal:options.signal};
  const live=()=>{options.signal?.throwIfAborted();pdfExecutionLive(deadlineAt);};
  let attempt:UspJobAttempt|undefined;
  try{
    live();const job=(await query(`SELECT j.*,m.input_manifest_id,m.input_sha256,m.scope,m.logical_state FROM jobs j
      JOIN usp_job_metadata m ON m.job_id=j.id WHERE j.id=$1 AND j.operation='packet-pdf'`,[jobId],bounds)).rows[0];
    if(!job||!['queued','running'].includes(job.status))return;
    const input=PacketPdfJobInputSchema.parse(job.payload);assertPacketPdfJobRow(job,input);
    const ctx=packetPdfJobContext(input);
    const beforeLocks=async(client:Parameters<typeof capturePacketPdfJobTx>[0])=>{live();await capturePacketPdfJobTx(client,ctx,input);};
    attempt=await claimUspJobAttempt(jobId,`packet:${randomUUID()}`,beforeLocks,bounds);
    if(attempt.inputSha256!==fingerprint(input))conflict('Claimed PDF metadata differs from enrolled input.');
    const owned=attempt;
    const first=await transaction(async client=>{await beforeLocks(client);await assertUspJobAttemptTx(client,owned);
      const prepared=await preparePacketPdfJobTx(client,ctx,input);await appendPacketPdfJobTx(client,input,'running');return prepared;},bounds);
    // The worker is owned by the independent dispatcher, never an HTTP promise.
    const staged=first.replay?null:await stagePdfExecution(first,io,deadlineAt);live();
    const asset=first.replay?.packet.artifact??{assetId:staged!.packetId,version:1,sha256:staged!.assembled.manifest.output.sha256};
    await acceptUspJobAttempt(owned,asset,async(client,lockedJob)=>{
      const meta=(await client.query('SELECT * FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE',[jobId])).rows[0];
      assertPacketPdfJobRow({...lockedJob,...meta,id:jobId},input);
      await capturePacketPdfJobTx(client,ctx,input);live();
      let result;
      if(first.replay){const current=await preparePacketPdfJobTx(client,ctx,input);
        if(!current.replay)conflict('The previously completed PDF is unavailable.');result=current.replay;
      }else result=await publishPdfExecutionTx(client,ctx,input.command,first,staged!,deadlineAt,true);
      const prior=await requestReceiptTx(client,ctx,input.scope.scopeId,'packet_plan_execute',input.command.guard.requestKey,fingerprint(input.command));
      if(!prior)await savePlanReceiptTx(client,ctx,input.scope.scopeId,'packet_plan_execute',input.command.guard.requestKey,fingerprint(input.command),result);
      await appendPacketPdfJobTx(client,input,'succeeded',result.packet.packetId);live();
      return result.packet.artifact;
    },beforeLocks,()=>live(),bounds);
  }catch(error){
    if(error instanceof DbCommitOutcomeUnknown)return;
    // An unavailable authoritative read/failed claim cannot overwrite a live owner.
    try{await failPacketPdfJob(jobId,failureCode(error),attempt);}catch{/* Durable lease/fence recovery remains available. */}
  }
}
