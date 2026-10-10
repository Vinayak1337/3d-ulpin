import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {RequestContext} from '@ulpin/contracts/usp';
import {UspPacketPlanSchema,UspPacketPlanConfirmationSchema,UspPacketPlanExecutionSchema,
  UspTextPacketPlanSchema,type AnyPacketPlan,type PacketPlan} from '../../../../../contracts/src/usp/packets';
import {UspAnyPdfPacketPlanSchema,UspAnyPdfPacketPlanExecutionSchema,
  type AnyPdfPacketPlan as PdfPacketPlan} from '../../../../../contracts/src/usp/packet-pdf';
import {canonical,fingerprint} from '../../cases/domain';
import {conflict,notFound} from '../../../infrastructure/errors';

export function isPdfPlan(plan:AnyPacketPlan):plan is PdfPacketPlan{return plan.input.format==='pdf';}
export function textPlan(plan:AnyPacketPlan):PacketPlan{return UspTextPacketPlanSchema.parse(plan);}
export function validatePlan(raw:unknown){
  const plan=UspPacketPlanSchema.parse(raw),{planSha256,...body}=plan;
  if(fingerprint(body)!==planSha256||plan.previousVersion!==(plan.version===1?null:plan.version-1))
    conflict('The immutable plan failed its integrity check.');
  for(const entry of plan.entries){const {entrySha256,...body}=entry;
    if(fingerprint(body)!==entrySha256)conflict('The immutable entry failed its integrity check.');}
  return plan;
}
export function validateConfirmation(plan:AnyPacketPlan,raw:unknown){
  const c=UspPacketPlanConfirmationSchema.parse(raw);
  if(c.planId!==plan.planId||c.version!==plan.version||c.planSha256!==plan.planSha256||
    canonical(c.reviewer)!==canonical(plan.creator))conflict('The confirmation does not match its immutable plan.');
  return c;
}
export function validateExecution(plan:AnyPacketPlan,raw:unknown){
  const execution=UspPacketPlanExecutionSchema.parse(raw),packet=execution.packet;
  if(execution.planId!==plan.planId||execution.version!==plan.version||canonical(packet.target)!==canonical(plan.input.target)||
    canonical(packet.scope)!==canonical(plan.input.scope)||packet.format!==plan.input.format||packet.status!=='complete')
    conflict('The execution does not match its immutable selection.');
  if(isPdfPlan(plan)){
    const pdf=UspAnyPdfPacketPlanExecutionSchema.parse(execution),p=pdf.packet;
    if(plan.entries.some(entry=>!entry.binding||entry.state!=='included')||plan.requiredContext!=='available'||
      p.planId!==plan.planId||p.planVersion!==plan.version||p.planSha256!==plan.planSha256||
      p.confirmationId!==pdf.confirmationId||p.artifact.assetId!==p.packetId||
      p.artifact.version!==1||p.artifact.sha256!==p.assembly.output.sha256)
      conflict('The PDF execution does not match its exact committed region and assembly.');
    if(plan.input.recipe!==p.assembly.recipe)conflict('The PDF recipe differs from its confirmed plan.');
    if(p.version==='packet-mixed-pdf/1'){
      const expectedEntries=plan.entries.map((entry,index)=>({kind:entry.binding!.version==='registry-image-region-citation/1'?'original_image_region':'pdf_page_region',
        bindingId:entry.binding!.id,entrySha256:entry.entrySha256,outputPage:index+1}));
      const expectedAssembly=plan.entries.map(entry=>({kind:entry.binding!.version==='registry-image-region-citation/1'?'original_image_region':'pdf_page_region',
        original:entry.binding!.document,derivative:entry.binding!.validation}));
      if(canonical(p.entries)!==canonical(expectedEntries)||canonical(p.assembly.entries)!==canonical(expectedAssembly))
        conflict('The mixed execution does not match both exact ordered original-region bindings.');
    }else if(p.version==='packet-pdf/1'||p.version==='packet-image-pdf/1'){
      const entry=plan.entries[0];
      if(plan.entries.length!==1||p.bindingId!==entry.binding!.id||p.entrySha256!==entry.entrySha256||
        canonical(p.assembly.region)!==canonical(entry.binding!.validation))
        conflict('The PDF execution does not match its exact committed region and assembly.');
    }else if(p.entries.length!==plan.entries.length||canonical(p.entries)!==canonical(plan.entries.map((entry,index)=>({
      bindingId:entry.binding!.id,entrySha256:entry.entrySha256,outputPage:index+1})))||
      canonical(p.assembly.regions)!==canonical(plan.entries.map(entry=>entry.binding!.validation)))
      conflict('The PDF execution does not match every ordered required region.');
    if(p.version==='packet-pdf/3'&&canonical(p.assembly.originals)!==canonical(plan.entries.map(entry=>entry.binding!.document)))
      conflict('The PDF execution does not match every exact ordered original.');
    return pdf;
  }
  if(packet.format==='pdf')conflict('The PDF execution belongs to another plan kind.');
  const included=plan.entries.filter(e=>e.state==='included').map(e=>e.selection.pointer);
  const omissions=plan.entries.filter(e=>e.state==='omitted_optional').map(e=>({entrySha256:e.entrySha256,reasonCode:e.reasonCode!}));
  if(packet.unavailable.length||canonical(packet.included)!==canonical(included)||canonical(execution.omissions)!==canonical(omissions))
    conflict('The execution does not match its immutable selection.');
  return execution;
}
export async function loadPlanTx(client:PoolClient,planId:string,version:number){
  const row=(await client.query('SELECT body FROM usp_packet_plans WHERE id=$1 AND version=$2',[planId,version])).rows[0]
    ??notFound('The exact packet plan version is unavailable.');
  const plan=validatePlan(row.body);
  if(plan.planId!==planId||plan.version!==version)conflict('The stored plan version changed.');return plan;
}
export async function loadPdfPlanTx(client:PoolClient,id:string,version:number){return UspAnyPdfPacketPlanSchema.parse(await loadPlanTx(client,id,version));}
export async function livePlanTx(client:PoolClient,expiresAt:string){
  if(!(await client.query('SELECT clock_timestamp() < $1::timestamptz AS live',[expiresAt])).rows[0]?.live)
    conflict('The unexecuted packet plan expired.');
}
export async function planHeadTx(client:PoolClient,plan:AnyPacketPlan){
  if(Number((await client.query('SELECT max(version) AS version FROM usp_packet_plans WHERE id=$1',[plan.planId])).rows[0]?.version)!==plan.version)
    conflict('A newer immutable plan version exists.');
}
export async function savePlanReceiptTx(client:PoolClient,ctx:RequestContext,siteId:string,operation:string,requestKey:string,hash:string,body:object){
  await client.query(`INSERT INTO usp_command_receipts(id,subject,scope_key,operation,request_key,command_sha256,body)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[randomUUID(),ctx.principal.subject,siteId,operation,requestKey,hash,body]);
}
