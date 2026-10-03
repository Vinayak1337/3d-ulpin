import type {PoolClient} from 'pg';
import type {RequestContext} from '@ulpin/contracts/usp';
import {PacketPdfJobInputSchema,PACKET_PDF_JOB_OPERATION,type PacketPdfJobInput} from '../../../../../contracts/src/usp/packet-pdf-jobs';
import {canonical,fingerprint} from '../../cases/domain';
import {conflict,notFound} from '../../../infrastructure/errors';
import {localRequestContext} from '../principal';
import {protectPdfExecutionPlanTx,preparePdfExecutionTx} from './pdf-service';
import {loadPdfPlanTx,validateConfirmation,validateExecution} from './plan-store';

export function packetPdfJobContext(input:PacketPdfJobInput):RequestContext{
  const ctx=localRequestContext(input.jobId);
  if(ctx.principal.subject!==input.subject||fingerprint(ctx.principal)!==input.actorSha256||
    ctx.accessViewId!==input.accessViewId||ctx.policyVersion!==input.policyVersion)
    conflict('Current server access does not authorize the queued PDF plan.');
  return ctx;
}
export async function capturePacketPdfJobTx(client:PoolClient,ctx:RequestContext,input:PacketPdfJobInput){
  const plan=await loadPdfPlanTx(client,input.command.planId,input.command.version);
  await protectPdfExecutionPlanTx(client,ctx,plan);
  const row=(await client.query('SELECT body FROM usp_packet_plan_confirmations WHERE plan_id=$1 AND version=$2',
    [plan.planId,plan.version])).rows[0]??notFound('The confirmed PDF plan is unavailable.');
  const confirmation=validateConfirmation(plan,row.body);
  const anchor=plan.entries.map(e=>e.binding?.document).filter((v):v is NonNullable<typeof v>=>Boolean(v))
    .sort((a,b)=>a.sourceId.localeCompare(b.sourceId))[0];
  if(plan.planSha256!==input.planSha256||confirmation.confirmationId!==input.command.confirmationId||
    fingerprint(confirmation)!==input.confirmationSha256||canonical(plan.input.scope)!==canonical(input.scope)||
    fingerprint(plan.entries)!==input.bindingsSha256||canonical(anchor)!==canonical(input.anchor)||
    fingerprint(ctx.principal)!==input.actorSha256||ctx.principal.subject!==input.subject||
    ctx.accessViewId!==input.accessViewId||ctx.policyVersion!==input.policyVersion)
    conflict('The exact queued PDF plan, confirmation, bindings or access pins changed.');
  return {plan,confirmation};
}
export function assertPacketPdfJobRow(job:Record<string,any>,input:PacketPdfJobInput){
  const digest=fingerprint(input);
  if(job.operation!==PACKET_PDF_JOB_OPERATION||job.id!==input.jobId||job.case_id!==input.anchor.caseId||
    job.source_id!==input.anchor.sourceId||job.case_revision!==input.anchor.caseRevision||
    job.input_fingerprint!==digest||job.input_sha256!==digest||job.input_manifest_id!==input.scope.manifestId||
    canonical(job.scope)!==canonical(input.scope)||canonical(PacketPdfJobInputSchema.parse(job.payload))!==canonical(input))
    conflict('The queued PDF job differs from its canonical enrollment.');
  if(job.logical_state&&job.logical_state!=='succeeded'&&(job.result_ref||job.accepted_fence!==null&&job.accepted_fence!==undefined))
    conflict('An unaccepted PDF job cannot expose a result.');
}
export async function enrolledPacketPdfJobTx(client:PoolClient,ctx:RequestContext,jobId:string){
  // Discovery does not lock a job before the complete canonical source/plan set.
  const sql=`SELECT j.*,m.input_manifest_id,m.input_sha256,m.scope,m.logical_state,m.version,
    m.result_ref,m.accepted_fence FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id
    WHERE j.id=$1 AND j.operation='packet-pdf'`;
  const job=(await client.query(sql,[jobId])).rows[0]??notFound('The private PDF job is unavailable.');
  const input=PacketPdfJobInputSchema.parse(job.payload);assertPacketPdfJobRow(job,input);
  const captured=await capturePacketPdfJobTx(client,ctx,input);
  const current=(await client.query(sql,[jobId])).rows[0]??notFound('The private PDF job is unavailable.');
  assertPacketPdfJobRow(current,input);return {job:current,input,...captured};
}
export async function preparePacketPdfJobTx(client:PoolClient,ctx:RequestContext,input:PacketPdfJobInput){
  await capturePacketPdfJobTx(client,ctx,input);
  return preparePdfExecutionTx(client,ctx,input.command,true);
}
export async function acceptedPacketPdfExecutionTx(client:PoolClient,plan:Awaited<ReturnType<typeof loadPdfPlanTx>>,job:Record<string,any>){
  const execution=(await client.query('SELECT body FROM usp_packet_plan_executions WHERE plan_id=$1 AND version=$2',
    [plan.planId,plan.version])).rows[0]??notFound('The accepted PDF execution is unavailable.');
  const result=validateExecution(plan,execution.body),asset=result.packet.artifact;
  if(result.packet.format!=='pdf')conflict('The accepted PDF job belongs to another execution profile.');
  const accepted=(await client.query("SELECT * FROM usp_job_attempts WHERE job_id=$1 AND fence=$2 AND state='accepted'",
    [job.id,job.accepted_fence])).rows[0];
  if(job.status!=='succeeded'||job.logical_state!=='succeeded'||canonical(job.result_ref)!==canonical(asset)||
    !accepted||accepted.input_sha256!==job.input_sha256||accepted.completion_sha256!==asset.sha256||
    Number(accepted.fence)!==Number(job.accepted_fence))conflict('The accepted PDF job linkage changed.');
  return result;
}
