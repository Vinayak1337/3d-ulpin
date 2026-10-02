import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {RequestContext} from '@ulpin/contracts/usp';
import {UspCreatePacketPlanSchema,UspRevisePacketPlanSchema,UspReadPacketPlanSchema,UspConfirmPacketPlanSchema,
  UspExecutePacketPlanSchema,UspPacketPlanConfirmationSchema} from '../../../../../contracts/src/usp/packets';
import {UspPdfPacketPlanInputSchema,UspPdfPacketPlanSchema,UspPdfPacketPlanExecutionSchema,UspPacketPdfReceiptSchema,
  PACKET_PDF_LIMITS,type PdfPacketPlan,type PdfPacketPlanInput} from '../../../../../contracts/src/usp/packet-pdf';
import {transaction} from '../../../infrastructure/db';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {openObjectStream,putOriginal,sha256} from '../../../infrastructure/storage';
import {canonical,fingerprint} from '../../cases/domain';
import {assertLocalUsp} from '../snapshots';
import {requestReceiptTx} from '../commands';
import {appendUspOutboxTx} from '../outbox';
import {PacketRegionService} from './region-extract';
import {prepareRegistryRegion} from '../../registry/registry-region-evidence';
import {registryRegionSourceTx} from '../../registry/registry-region-evidence';
import {assemblePacketPdf} from './pdf-render';
import {protectPdfPlanTx,protectPdfPlanInputsTx,authorizePdfPlanTx,assessPdfPlanTx,assertPdfAssessment,assertPdfPlanActor} from './pdf-authority';
import {loadPdfPlanTx,validatePlan,validateConfirmation,validateExecution,livePlanTx,planHeadTx,savePlanReceiptTx} from './plan-store';

/** Internal I/O seam only. Each byte read is bounded by the immutable receipt. */
export type PdfPacketIo={extract:PacketRegionService['extract'];put:typeof putOriginal;
  read:(key:string,bytes:number,hash:string)=>Promise<Uint8Array>};
async function boundedPdfRead(key:string,bytes:number,hash:string){
  if(!Number.isSafeInteger(bytes)||bytes<1||bytes>PACKET_PDF_LIMITS.bytes)
    throw new AppError(422,'PACKET_PDF_ARTIFACT_INTEGRITY','The saved PDF exceeds its bounded receipt.');
  const object=await openObjectStream(key,bytes,30_000),chunks:Buffer[]=[];let size=0;
  try{for await(const value of object.body){const chunk=Buffer.from(value);size+=chunk.length;
    if(size>bytes)throw new AppError(422,'PACKET_PDF_ARTIFACT_INTEGRITY','The saved PDF exceeds its receipt.');chunks.push(chunk);}
    const result=Buffer.concat(chunks,size);
    if(size!==bytes||sha256(result)!==hash)throw new AppError(422,'PACKET_PDF_ARTIFACT_INTEGRITY','The saved PDF differs from its receipt.');
    return result;
  }finally{object.body.destroy();}
}
const regionService=new PacketRegionService();
const storage:PdfPacketIo={extract:regionService.extract.bind(regionService),read:boundedPdfRead,
  put:(key,bytes,type)=>putOriginal(key,bytes,type,AbortSignal.timeout(30_000))};
const boundedTx=<T>(work:(client:PoolClient)=>Promise<T>)=>transaction(work,{deadlineAt:Date.now()+30_000});
async function protectTx(client:PoolClient,ctx:RequestContext,plan:PdfPacketPlan){
  assertPdfPlanActor(ctx,plan);await protectPdfPlanTx(client,ctx,plan.input);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`packet-plan:${plan.planId}`]);
  await authorizePdfPlanTx(client,ctx,plan);
}
async function versionTx(client:PoolClient,ctx:RequestContext,input:PdfPacketPlanInput,id:string,version:number){
  const expiry=Date.parse(input.expiresAt)-Date.now();
  if(expiry<=0||expiry>24*60*60*1000)throw new AppError(422,'PACKET_PLAN_EXPIRY','Use an expiry within the next 24 hours.');
  const assessment=await assessPdfPlanTx(client,ctx,input),body={planId:id,version,previousVersion:version===1?null:version-1,
    input,creator:ctx.principal,accessViewId:ctx.accessViewId,policyVersion:ctx.policyVersion,...assessment,createdAt:new Date().toISOString()};
  const plan=UspPdfPacketPlanSchema.parse({...body,planSha256:fingerprint(body)});
  await authorizePdfPlanTx(client,ctx,plan);await livePlanTx(client,input.expiresAt);
  await client.query(`INSERT INTO usp_packet_plans(id,version,site_id,manifest_id,subject,body)
    VALUES($1,$2,$3,$4,$5,$6)`,[id,version,input.scope.scopeId,input.scope.manifestId,ctx.principal.subject,plan]);return plan;
}
export async function createPdfPacketPlan(ctx:RequestContext,raw:unknown,_io?:PdfPacketIo){
  assertLocalUsp(ctx);const command=UspCreatePacketPlanSchema.parse(raw),input=UspPdfPacketPlanInputSchema.parse(command.input),hash=fingerprint(command);
  return boundedTx(async client=>{
    await protectPdfPlanTx(client,ctx,input);
    const replay=await requestReceiptTx(client,ctx,input.scope.scopeId,'packet_plan_create',command.guard.requestKey,hash);
    if(replay){const plan=UspPdfPacketPlanSchema.parse(validatePlan(replay));await authorizePdfPlanTx(client,ctx,plan);return plan;}
    const plan=await versionTx(client,ctx,input,randomUUID(),1);
    await savePlanReceiptTx(client,ctx,input.scope.scopeId,'packet_plan_create',command.guard.requestKey,hash,plan);
    await appendUspOutboxTx(client,`packet-plan:${plan.planId}`,{type:'packet.plan.created',scope:input.scope,
      planId:plan.planId,version:plan.version,planSha256:plan.planSha256,correlationId:ctx.requestId});return plan;
  });
}
export async function revisePdfPacketPlan(ctx:RequestContext,raw:unknown,_io?:PdfPacketIo){
  assertLocalUsp(ctx);const command=UspRevisePacketPlanSchema.parse(raw),input=UspPdfPacketPlanInputSchema.parse(command.input),hash=fingerprint(command);
  return boundedTx(async client=>{
    const old=await loadPdfPlanTx(client,command.planId,command.guard.expectedVersion);
    if(canonical(old.input.target)!==canonical(input.target)||old.input.scope.scopeId!==input.scope.scopeId)
      throw new AppError(422,'PACKET_PLAN_RETARGET','Create a separate plan for another exact target.');
    // Both versions can contribute distinct cases; protect the complete set
    // before either version takes destination or receipt locks.
    await protectPdfPlanInputsTx(client,ctx,[old.input,input]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`packet-plan:${old.planId}`]);
    const replay=await requestReceiptTx(client,ctx,input.scope.scopeId,'packet_plan_revise',command.guard.requestKey,hash);
    await authorizePdfPlanTx(client,ctx,old);
    if(replay){const plan=UspPdfPacketPlanSchema.parse(validatePlan(replay));await authorizePdfPlanTx(client,ctx,plan);return plan;}
    if(command.guard.expectedManifestId!==old.input.scope.manifestId)conflict('The revision guard names another snapshot.');
    await planHeadTx(client,old);const plan=await versionTx(client,ctx,input,old.planId,old.version+1);
    await savePlanReceiptTx(client,ctx,input.scope.scopeId,'packet_plan_revise',command.guard.requestKey,hash,plan);
    await appendUspOutboxTx(client,`packet-plan:${plan.planId}`,{type:'packet.plan.revised',scope:input.scope,
      planId:plan.planId,version:plan.version,planSha256:plan.planSha256,correlationId:ctx.requestId});return plan;
  });
}
async function viewTx(client:PoolClient,ctx:RequestContext,id:string,version:number){
  const plan=await loadPdfPlanTx(client,id,version);await protectTx(client,ctx,plan);
  const c=(await client.query('SELECT body FROM usp_packet_plan_confirmations WHERE plan_id=$1 AND version=$2',[id,version])).rows[0]?.body;
  const e=(await client.query('SELECT body FROM usp_packet_plan_executions WHERE plan_id=$1 AND version=$2',[id,version])).rows[0]?.body;
  const confirmation=c?validateConfirmation(plan,c):null,execution=e?UspPdfPacketPlanExecutionSchema.parse(validateExecution(plan,e)):null;
  if(execution&&execution.confirmationId!==confirmation?.confirmationId)conflict('The execution confirmation is unavailable.');
  await authorizePdfPlanTx(client,ctx,plan);return {plan,confirmation,execution};
}
export async function readPdfPacketPlan(ctx:RequestContext,raw:unknown){
  assertLocalUsp(ctx);const c=UspReadPacketPlanSchema.parse(raw);
  return boundedTx(client=>viewTx(client,ctx,c.planId,c.version));
}
export async function confirmPdfPacketPlan(ctx:RequestContext,raw:unknown){
  assertLocalUsp(ctx);const command=UspConfirmPacketPlanSchema.parse(raw),hash=fingerprint(command);
  return boundedTx(async client=>{
    const plan=await loadPdfPlanTx(client,command.planId,command.version);await protectTx(client,ctx,plan);
    const replay=await requestReceiptTx(client,ctx,plan.input.scope.scopeId,'packet_plan_confirm',command.guard.requestKey,hash);
    if(replay)return validateConfirmation(plan,replay);
    if(command.guard.expectedVersion!==plan.version||command.guard.expectedManifestId!==plan.input.scope.manifestId||
      command.planSha256!==plan.planSha256)conflict('Review the exact immutable plan and snapshot.');
    await planHeadTx(client,plan);
    if((await client.query('SELECT body FROM usp_packet_plan_confirmations WHERE plan_id=$1 AND version=$2',[plan.planId,plan.version])).rows[0])
      conflict('This exact version is already confirmed; reuse its request key.');
    const assessment=await assessPdfPlanTx(client,ctx,plan.input);assertPdfAssessment(plan,assessment);
    if(plan.requiredContext!=='available'||!plan.entries[0].binding)throw new AppError(422,'PACKET_PLAN_BLOCKED','A committed region binding is required.');
    await livePlanTx(client,plan.input.expiresAt);
    const confirmation=UspPacketPlanConfirmationSchema.parse({confirmationId:randomUUID(),planId:plan.planId,version:plan.version,
      planSha256:plan.planSha256,reviewer:ctx.principal,reviewed:true,confirmedAt:new Date().toISOString()});
    await authorizePdfPlanTx(client,ctx,plan);
    await client.query('INSERT INTO usp_packet_plan_confirmations(id,plan_id,version,subject,body) VALUES($1,$2,$3,$4,$5)',
      [confirmation.confirmationId,plan.planId,plan.version,ctx.principal.subject,confirmation]);
    await savePlanReceiptTx(client,ctx,plan.input.scope.scopeId,'packet_plan_confirm',command.guard.requestKey,hash,confirmation);
    await appendUspOutboxTx(client,`packet-plan:${plan.planId}`,{type:'packet.plan.confirmed',scope:plan.input.scope,
      planId:plan.planId,version:plan.version,confirmationId:confirmation.confirmationId,correlationId:ctx.requestId});return confirmation;
  });
}
export async function executePdfPacketPlan(ctx:RequestContext,raw:unknown,io:PdfPacketIo=storage){
  assertLocalUsp(ctx);const command=UspExecutePacketPlanSchema.parse(raw),hash=fingerprint(command);
  const prepare=async(client:PoolClient)=>{
    const plan=await loadPdfPlanTx(client,command.planId,command.version);await protectTx(client,ctx,plan);
    const replay=await requestReceiptTx(client,ctx,plan.input.scope.scopeId,'packet_plan_execute',command.guard.requestKey,hash);
    if(replay)return {replay:UspPdfPacketPlanExecutionSchema.parse(validateExecution(plan,replay))};
    if((await client.query('SELECT body FROM usp_packet_plan_executions WHERE plan_id=$1 AND version=$2',[plan.planId,plan.version])).rows[0])
      conflict('This version already executed; reuse its original request key.');
    await planHeadTx(client,plan);
    const row=(await client.query('SELECT body FROM usp_packet_plan_confirmations WHERE plan_id=$1 AND version=$2',[plan.planId,plan.version])).rows[0]
      ??notFound('Confirm this exact version before execution.');
    const confirmation=validateConfirmation(plan,row.body);
    if(confirmation.confirmationId!==command.confirmationId)conflict('The confirmation does not cover this plan.');
    await livePlanTx(client,plan.input.expiresAt);
    const assessment=await assessPdfPlanTx(client,ctx,plan.input);assertPdfAssessment(plan,assessment);
    const binding=plan.entries[0].binding;
    if(plan.requiredContext!=='available'||!binding)throw new AppError(422,'PACKET_PLAN_BLOCKED','A committed region binding is required.');
    const source=await registryRegionSourceTx(client,plan.input.scope.scopeId,binding.document,true);
    return {plan,confirmation,binding,source};
  };
  const first=await boundedTx(prepare);if(first.replay)return first.replay;
  // No transaction or mutation lock spans native execution or object I/O.
  const {plan,confirmation,binding,source}=first;
  const crop=await io.extract(binding.document.sourceId,binding.page,{revision:String(binding.document.sourceRevision),
    sha256:binding.document.sourceSha256,purpose:'private_source_preview',selection:binding.region});
  const proof=await prepareRegistryRegion({document:binding.document,page:binding.page,region:binding.region,purpose:binding.purpose},source,
    async()=>crop);
  if(canonical(proof.validation)!==canonical(binding.validation))conflict('The exact bound crop or renderer recipe changed. Review a fresh binding.');
  const assembled=assemblePacketPdf(proof.validation,crop.bytes),packetId=randomUUID(),key=`usp/packets/${packetId}/${assembled.manifest.output.sha256}`;
  await io.put(key,assembled.bytes,'application/pdf');
  const saved=await io.read(key,assembled.bytes.length,assembled.manifest.output.sha256);
  if(saved.length!==assembled.bytes.length||sha256(saved)!==assembled.manifest.output.sha256)
    throw new AppError(422,'PACKET_PDF_ARTIFACT_INTEGRITY','The staged PDF failed byte verification.');
  // Final same-client publication is atomic with execution/command/outbox.
  // Failed or uncertain publication retains an unreferenced derivative; never
  // delete a possibly committed object or any original on cancellation.
  return boundedTx(async client=>{
    const final=await prepare(client);if(final.replay)return final.replay;
    if(canonical(final)!==canonical(first))conflict('The confirmed plan or original authority changed during generation.');
    const packet=UspPacketPdfReceiptSchema.parse({version:'packet-pdf/1',packetId,target:plan.input.target,scope:plan.input.scope,
      format:'pdf',artifact:{assetId:packetId,version:1,sha256:assembled.manifest.output.sha256},planId:plan.planId,planVersion:plan.version,
      planSha256:plan.planSha256,confirmationId:confirmation.confirmationId,bindingId:binding.id,entrySha256:plan.entries[0].entrySha256,
      assembly:assembled.manifest,contentType:'application/pdf',status:'complete',createdAt:new Date().toISOString(),commandSha256:hash});
    const result=UspPdfPacketPlanExecutionSchema.parse({planId:plan.planId,version:plan.version,confirmationId:confirmation.confirmationId,packet,omissions:[]});
    await authorizePdfPlanTx(client,ctx,plan);await livePlanTx(client,plan.input.expiresAt);
    await client.query(`INSERT INTO usp_packets(id,manifest_id,target_namespace,target_id,artifact_hash,object_key,body)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[packetId,plan.input.scope.manifestId,plan.input.target.ref.namespace,plan.input.target.ref.id,
      packet.artifact.sha256,key,packet]);
    await client.query('INSERT INTO usp_packet_plan_executions(plan_id,version,confirmation_id,packet_id,body) VALUES($1,$2,$3,$4,$5)',
      [plan.planId,plan.version,confirmation.confirmationId,packetId,result]);
    await savePlanReceiptTx(client,ctx,plan.input.scope.scopeId,'packet_plan_execute',command.guard.requestKey,hash,result);
    await appendUspOutboxTx(client,`packet-plan:${plan.planId}`,{type:'packet.plan.executed',scope:plan.input.scope,
      planId:plan.planId,version:plan.version,packetId,artifactSha256:packet.artifact.sha256,correlationId:ctx.requestId});return result;
  });
}
export async function readPacketPdf(ctx:RequestContext,packetValue:string,io:PdfPacketIo=storage){
  assertLocalUsp(ctx);const packetId=z.uuid().parse(packetValue);
  const capture=async(client:PoolClient)=>{
    const row=(await client.query('SELECT body,object_key,artifact_hash FROM usp_packets WHERE id=$1',[packetId])).rows[0]
      ??notFound('The exact private PDF packet is unavailable.');
    const receipt=UspPacketPdfReceiptSchema.parse(row.body);
    if(receipt.packetId!==packetId||row.artifact_hash!==receipt.artifact.sha256||
      row.object_key!==`usp/packets/${packetId}/${receipt.artifact.sha256}`)conflict('The saved PDF linkage changed.');
    const view=await viewTx(client,ctx,receipt.planId,receipt.planVersion);
    if(!view.execution||canonical(view.execution.packet)!==canonical(receipt))conflict('The PDF does not match its immutable plan execution.');
    const execution=(await client.query('SELECT body FROM usp_packet_plan_executions WHERE packet_id=$1',[packetId])).rows[0]?.body;
    if(canonical(execution)!==canonical(view.execution))conflict('The saved PDF execution linkage changed.');
    await authorizePdfPlanTx(client,ctx,view.plan);return {receipt,key:row.object_key as string,view};
  };
  const before=await boundedTx(capture),output=before.receipt.assembly.output;
  const bytes=await io.read(before.key,output.bytes,output.sha256);
  if(bytes.length!==output.bytes||bytes.length>PACKET_PDF_LIMITS.bytes||sha256(bytes)!==output.sha256)
    throw new AppError(422,'PACKET_PDF_ARTIFACT_INTEGRITY','The saved PDF differs from its exact receipt.');
  const after=await boundedTx(capture);
  if(canonical(after)!==canonical(before))conflict('The saved PDF changed during its private read.');
  return {bytes,receipt:after.receipt};
}
