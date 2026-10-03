import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {RequestContext} from '@ulpin/contracts/usp';
import {PacketPdfJobInputSchema,PacketPdfJobStatusSchema,PacketPdfJobControlSchema,PacketPdfJobChangedSchema,
  UspEnqueuePacketPdfJobSchema,type PacketPdfJobInput} from '../../../../../contracts/src/usp/packet-pdf-jobs';
import {transaction} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {canonical,fingerprint} from '../../cases/domain';
import {registerUspJobInputTx,USP_JOB_LIMITS} from '../jobs';
import {requestReceiptTx} from '../commands';
import {appendUspOutboxTx} from '../outbox';
import {preparePdfExecutionTx,protectPdfExecutionPlanTx,readPacketPdf,type PdfPacketIo} from './pdf-service';
import {loadPdfPlanTx,validateConfirmation,savePlanReceiptTx} from './plan-store';
import {enrolledPacketPdfJobTx,acceptedPacketPdfExecutionTx,capturePacketPdfJobTx,assertPacketPdfJobRow} from './pdf-job-authority';

export async function appendPacketPdfJobTx(client:PoolClient,input:PacketPdfJobInput,status:'queued'|'running'|'succeeded'|'failed'|'cancelled',packetId:string|null=null){
  return appendUspOutboxTx(client,`packet-job:${input.jobId}`,PacketPdfJobChangedSchema.parse({type:'packet.pdf.job.changed',
    jobId:input.jobId,scope:input.scope,planId:input.command.planId,planVersion:input.command.version,status,packetId}));
}
async function statusTx(client:PoolClient,ctx:RequestContext,jobId:string){
  const {job,input,plan}=await enrolledPacketPdfJobTx(client,ctx,jobId);
  const attempt=(await client.query('SELECT * FROM usp_job_attempts WHERE job_id=$1 ORDER BY number DESC LIMIT 1',[jobId])).rows[0];
  const accepted=job.logical_state==='succeeded'?await acceptedPacketPdfExecutionTx(client,plan,job):null;
  if(accepted&&accepted.confirmationId!==input.command.confirmationId)conflict('The accepted PDF confirmation changed.');
  return PacketPdfJobStatusSchema.parse({jobId,version:Number(job.version),planId:plan.planId,planVersion:plan.version,scope:input.scope,
    status:job.logical_state,attempt:{number:Number(attempt?.number??0),fence:Number(attempt?.fence??0),
      leaseUntil:attempt?new Date(attempt.lease_until).toISOString():null},
    errorCode:job.error&&/^PACKET_[A-Z_]{1,80}$/.test(job.error)?job.error:job.error?'PACKET_PDF_PROCESSING_FAILED':null,
    result:accepted?{packetId:accepted.packet.packetId,artifact:accepted.packet.artifact}:null});
}
export async function enqueuePacketPdfJob(ctx:RequestContext,raw:unknown){
  const command=UspEnqueuePacketPdfJobSchema.parse(raw),hash=fingerprint(command);
  return transaction(async client=>{
    const plan=await loadPdfPlanTx(client,command.planId,command.version);await protectPdfExecutionPlanTx(client,ctx,plan);
    const replay=await requestReceiptTx(client,ctx,plan.input.scope.scopeId,'packet_pdf_enqueue',command.guard.requestKey,hash);
    if(replay)return statusTx(client,ctx,z.uuid().parse((replay as {jobId:string}).jobId));
    await preparePdfExecutionTx(client,ctx,command,true);
    const confirmation=validateConfirmation(plan,(await client.query('SELECT body FROM usp_packet_plan_confirmations WHERE plan_id=$1 AND version=$2',
      [plan.planId,plan.version])).rows[0]?.body);
    const existing=(await client.query(`SELECT id FROM jobs WHERE operation='packet-pdf' AND payload->'command'->>'planId'=$1
      AND payload->'command'->>'version'=$2 ORDER BY created_at LIMIT 1`,[plan.planId,String(plan.version)])).rows[0];
    const jobId=existing?.id??randomUUID();
    if(!existing){
      const anchor=plan.entries.map(e=>e.binding!.document).sort((a,b)=>a.sourceId.localeCompare(b.sourceId))[0];
      const input=PacketPdfJobInputSchema.parse({version:'packet-pdf-job/1',jobId,command,planSha256:plan.planSha256,
        confirmationSha256:fingerprint(confirmation),scope:plan.input.scope,anchor,bindingsSha256:fingerprint(plan.entries),
        actorSha256:fingerprint(ctx.principal),subject:ctx.principal.subject,accessViewId:ctx.accessViewId,policyVersion:ctx.policyVersion});
      await capturePacketPdfJobTx(client,ctx,input);
      await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload)
        VALUES($1,$2,$3,'packet-pdf',$4,$5,$6)`,[jobId,anchor.caseId,anchor.sourceId,anchor.caseRevision,fingerprint(input),input]);
      await registerUspJobInputTx(client,jobId,input.scope,input.scope.manifestId,fingerprint(input));
      await appendPacketPdfJobTx(client,input,'queued');
    }
    const status=await statusTx(client,ctx,jobId);
    await savePlanReceiptTx(client,ctx,plan.input.scope.scopeId,'packet_pdf_enqueue',command.guard.requestKey,hash,{jobId});
    return status;
  },{deadlineAt:Date.now()+30_000});
}
export async function readPacketPdfJob(ctx:RequestContext,jobValue:string){
  const jobId=z.uuid().parse(jobValue);return transaction(client=>statusTx(client,ctx,jobId),{deadlineAt:Date.now()+30_000});
}
export async function readPacketPdfJobResult(ctx:RequestContext,jobValue:string,io?:PdfPacketIo){
  const before=await readPacketPdfJob(ctx,jobValue);
  if(before.status!=='succeeded'||!before.result)throw new AppError(409,'PACKET_PDF_NOT_READY','The queued PDF has no accepted complete result.');
  const output=await readPacketPdf(ctx,before.result.packetId,io);
  const after=await readPacketPdfJob(ctx,jobValue);
  if(canonical(after)!==canonical(before)||canonical(output.receipt.artifact)!==canonical(after.result?.artifact))
    conflict('The accepted PDF job changed during its private read.');
  return output;
}
export async function controlPacketPdfJob(ctx:RequestContext,raw:unknown){
  const command=PacketPdfJobControlSchema.parse(raw),hash=fingerprint(command);
  return transaction(async client=>{
    const {input,plan}=await enrolledPacketPdfJobTx(client,ctx,command.jobId);
    const replay=await requestReceiptTx(client,ctx,input.scope.scopeId,'packet_pdf_control',command.requestKey,hash);
    if(replay)return statusTx(client,ctx,command.jobId);
    const job=(await client.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE',[command.jobId])).rows[0];
    const meta=(await client.query('SELECT * FROM usp_job_metadata WHERE job_id=$1 FOR UPDATE',[command.jobId])).rows[0];
    assertPacketPdfJobRow({...job,...meta,id:job.id},input);
    if(Number(meta.version)!==command.expectedVersion)conflict('The queued PDF job changed.');
    if(meta.logical_state==='succeeded')conflict('An accepted PDF result cannot be cancelled or retried.');
    if(command.action==='retry'){
      if(meta.logical_state!=='failed')conflict('Retry only a failed PDF job.');
      const latest=(await client.query('SELECT * FROM usp_job_attempts WHERE job_id=$1 ORDER BY number DESC LIMIT 1 FOR UPDATE',[command.jobId])).rows[0];
      if(Number(latest?.number??0)>=USP_JOB_LIMITS.maxAttempts)
        throw new AppError(422,'PACKET_PDF_ATTEMPTS','Review a fresh plan version after this finite attempt allowance.');
      await preparePdfExecutionTx(client,ctx,input.command,true);
      await client.query("UPDATE usp_job_metadata SET logical_state='queued',version=version+1 WHERE job_id=$1",[command.jobId]);
      await client.query("UPDATE jobs SET status='queued',error=NULL,completed_at=NULL,next_attempt_at=now() WHERE id=$1",[command.jobId]);
    }else{
      await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND state='active'",[command.jobId]);
      await client.query("UPDATE usp_job_metadata SET logical_state='cancelled',version=version+1 WHERE job_id=$1",[command.jobId]);
      await client.query("UPDATE jobs SET status='failed',error='PACKET_PDF_CANCELLED',completed_at=now() WHERE id=$1",[command.jobId]);
    }
    await appendPacketPdfJobTx(client,input,command.action==='retry'?'queued':'cancelled');
    await savePlanReceiptTx(client,ctx,plan.input.scope.scopeId,'packet_pdf_control',command.requestKey,hash,{jobId:command.jobId});
    return statusTx(client,ctx,command.jobId);
  },{deadlineAt:Date.now()+30_000});
}
