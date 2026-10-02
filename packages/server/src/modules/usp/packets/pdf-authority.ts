import type {PoolClient} from 'pg';
import type {RequestContext} from '@ulpin/contracts/usp';
import {RegistryDocumentCitationsSchema,type RegistryRegionCitation} from '@ulpin/contracts';
import {UspPdfPacketPlanEntrySchema,type AnyPdfPacketPlanInput as PdfPacketPlanInput,
  type AnyPdfPacketPlan as PdfPacketPlan} from '../../../../../contracts/src/usp/packet-pdf';
import {canonical,fingerprint} from '../../cases/domain';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {assertLocalUsp} from '../snapshots';
import {scopedManifestTx} from '../commands';
import {equalPin} from '../declarations/authority';
import {lockRegistryDocumentCasesTx} from '../../registry/registry-document-locks';
import {registryRegionSourceTx,assertRegionCitation,regionCitationId} from '../../registry/registry-region-evidence';
import {documentSourceTx} from '../ingestion/document-context';

export function assertPdfPlanActor(ctx:RequestContext,plan:PdfPacketPlan){
  assertLocalUsp(ctx);
  if(canonical(ctx.principal)!==canonical(plan.creator)||ctx.accessViewId!==plan.accessViewId||ctx.policyVersion!==plan.policyVersion)
    throw new AppError(403,'PACKET_PLAN_ACCESS','Current access does not authorize this private plan.');
}
async function targetTx(client:PoolClient,ctx:RequestContext,input:PdfPacketPlanInput){
  assertLocalUsp(ctx);const manifest=await scopedManifestTx(client,ctx,input.scope);
  if(manifest.selection.kind!=='targets'||manifest.selection.pins.length!==1||!equalPin(manifest.selection.pins[0],input.target))
    throw new AppError(422,'PACKET_PLAN_SELECTION','Select one exact building, floor or space snapshot.');
  const captured=(await client.query(`SELECT body,body_sha256 FROM usp_snapshot_bodies WHERE manifest_id=$1
    AND namespace=$2 AND object_id=$3 AND revision=$4`,[input.scope.manifestId,'registry_record',input.target.ref.id,input.target.revision])).rows[0];
  if(!captured||fingerprint(captured.body)!==captured.body_sha256||
    !manifest.members.some(m=>equalPin(m.pin,input.target)&&m.bodySha256===captured.body_sha256))
    conflict('The exact captured target is unavailable.');
  const target=captured.body;
  if(target.id!==input.target.ref.id||target.site_id!==input.scope.scopeId||target.revision!==input.target.revision||
    !['building','floor','space'].includes(target.kind))
    throw new AppError(422,'PACKET_PLAN_TARGET','Use the exact recorded building, floor or space.');
  const citations=RegistryDocumentCitationsSchema.parse(target.body?.documentCitations??[]);
  const bindings=input.entries.map(entry=>{
    const binding=citations.find(p=>p.version==='registry-document-region-citation/1'&&p.id===entry.bindingId) as RegistryRegionCitation|undefined;
    if(binding&&(binding.target.recordId!==target.id||binding.target.revision>=target.revision||binding.purpose!==input.purpose))
      conflict('The exact region has not passed canonical commit for this target and purpose.');
    if(binding&&binding.id!==regionCitationId(binding))conflict('The exact committed region failed its integrity check.');
    return binding;
  });
  const supplied=bindings.filter((binding):binding is RegistryRegionCitation=>Boolean(binding));
  if(supplied.some(binding=>canonical(binding.document)!==canonical(supplied[0].document)))
    throw new AppError(422,'PACKET_PDF_ORIGINAL_SCOPE','Select committed regions from one exact unchanged original.');
  return {captured,target,bindings};
}
/** Discovery precedes all source/site/recording locks. Canonical-original only:
 * no parent ancestry is introduced after waiting with destination locks held. */
export async function protectPdfPlanTx(client:PoolClient,ctx:RequestContext,input:PdfPacketPlanInput){
  return (await protectPdfPlanInputsTx(client,ctx,[input]))[0];
}
export async function protectPdfPlanInputsTx(client:PoolClient,ctx:RequestContext,inputs:readonly PdfPacketPlanInput[]){
  const before=[];for(const input of inputs)before.push(await targetTx(client,ctx,input));
  const cases=[...new Set(before.flatMap(item=>item.bindings.flatMap(binding=>binding?[binding.document.caseId.toLowerCase()]:[])))].sort();
  await lockRegistryDocumentCasesTx(client,cases,cases);
  const after=[];for(const input of inputs)after.push(await targetTx(client,ctx,input));
  if(canonical(after)!==canonical(before))conflict('The exact region context changed while acquiring protection.');
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))");
  for(const id of [...new Set(inputs.map(input=>input.scope.scopeId))].sort())
    await client.query('SELECT id FROM registry_sites WHERE id=$1 FOR SHARE',[id]);
  const bindings=before.flatMap(item=>item.bindings.filter((binding):binding is RegistryRegionCitation=>Boolean(binding)))
    .sort((a,b)=>a.document.sourceId.localeCompare(b.document.sourceId));
  for(const binding of bindings){
    const source=(await client.query('SELECT id,case_id,inspection FROM sources WHERE id=$1 FOR SHARE',[binding.document.sourceId])).rows[0];
    if(!source||source.case_id!==binding.document.caseId||Object.hasOwn(source.inspection??{},'copiedFrom'))
      throw new AppError(403,'PACKET_PDF_SOURCE_ACCESS','The canonical original source is unavailable.');
  }
  return after;
}
async function committedTargetTx(client:PoolClient,input:PdfPacketPlanInput,captured:Record<string,any>,bindings:(RegistryRegionCitation|undefined)[]){
  const current=(await client.query(`SELECT r.*,c.status AS project_status FROM registry_records r
    LEFT JOIN usp_project_codes c ON c.record_id=r.id WHERE r.id=$1 AND r.site_id=$2 FOR SHARE OF r`,
    [input.target.ref.id,input.scope.scopeId])).rows[0]??notFound('The selected target is unavailable.');
  if(current.kind!==captured.kind||['retired','cancelled_error'].includes(current.project_status))
    throw new AppError(403,'PACKET_PLAN_TARGET_ACCESS','The selected target is unavailable.');
  const stored=current.revision===input.target.revision?current:
    (await client.query('SELECT body FROM registry_revisions WHERE record_id=$1 AND revision=$2',[input.target.ref.id,input.target.revision])).rows[0];
  if(!stored||fingerprint(stored.body)!==fingerprint(captured.body))conflict('The committed target revision is unavailable.');
  for(const binding of bindings)if(binding){
    const history=(await client.query('SELECT body FROM registry_revisions WHERE record_id=$1 AND revision=$2',
      [binding.target.recordId,binding.target.revision])).rows[0];
    if(!history||fingerprint(history.body)!==binding.target.bodySha256)conflict('The original selected target history changed.');
  }
  return current;
}
async function sourceAccessTx(client:PoolClient,ctx:RequestContext,siteId:string,binding:RegistryRegionCitation){
  if(binding.selection.subject!==ctx.principal.subject)
    throw new AppError(403,'PACKET_PDF_SOURCE_ACCESS','This region is unavailable to the current operator.');
  const original=binding.document,current=await documentSourceTx(client,original.caseId,original.sourceId);
  if(current.current.site_id!==siteId||Object.hasOwn(current.source.inspection??{},'copiedFrom')||
    current.binding.access!==binding.selection.accessSha256)
    throw new AppError(403,'PACKET_PDF_SOURCE_ACCESS','Current access does not authorize this original region.');
  if(current.source.revision!==original.sourceRevision||current.source.sha256!==original.sourceSha256||
    Number(current.source.bytes)!==original.sourceBytes)conflict('The retained original bytes changed.');
}
export async function authorizePdfPlanTx(client:PoolClient,ctx:RequestContext,plan:PdfPacketPlan){
  assertPdfPlanActor(ctx,plan);const {captured,target,bindings}=await targetTx(client,ctx,plan.input);
  if(captured.body_sha256!==plan.targetBodySha256||canonical(bindings.map(binding=>binding??null))!==canonical(plan.entries.map(entry=>entry.binding)))
    conflict('The immutable PDF plan binding changed.');
  await committedTargetTx(client,plan.input,target,bindings);
  for(const binding of bindings)if(binding)await sourceAccessTx(client,ctx,plan.input.scope.scopeId,binding);
  assertPdfPlanActor(ctx,plan);
}
/** New generation is exact-current; disclosure above preserves committed
 * historical target/crop pins while independently checking current access. */
export async function assessPdfPlanTx(client:PoolClient,ctx:RequestContext,input:PdfPacketPlanInput){
  const {captured,target,bindings}=await targetTx(client,ctx,input);
  const current=await committedTargetTx(client,input,target,bindings);
  if(current.revision!==input.target.revision||fingerprint(current.body)!==fingerprint(target.body))
    conflict('The current target changed. Create a fresh selection.');
  // Match the full capture projection, including sourced identity/aliases.
  const projected=(await client.query(`SELECT r.*,c.code AS project_code,c.status AS project_status,s.location AS project_location
    FROM registry_records r LEFT JOIN usp_project_codes c ON c.record_id=r.id
    LEFT JOIN usp_project_identity_state s ON s.record_id=r.id WHERE r.id=$1 AND r.site_id=$2 FOR SHARE OF r`,
    [input.target.ref.id,input.scope.scopeId])).rows[0];
  const aliases=(await client.query('SELECT alias FROM registry_aliases WHERE site_id=$1 AND record_id=$2 ORDER BY alias',
    [input.scope.scopeId,input.target.ref.id])).rows.map(r=>r.alias);
  const successors=(await client.query(`SELECT successor_id FROM usp_project_lineage WHERE scope_id=$1 AND predecessor_id=$2
    AND kind IN ('split','merge') ORDER BY successor_id`,[input.scope.scopeId,input.target.ref.id])).rows.map(r=>r.successor_id);
  const full={...projected,projectIdentity:projected.project_code?{code:projected.project_code,status:projected.project_status,
    location:projected.project_location,successors}:null,historicalAliases:aliases};
  if(fingerprint(JSON.parse(JSON.stringify(full)))!==captured.body_sha256)conflict('The captured target context changed.');
  const entries=[];
  for(const [index,selection] of input.entries.entries()){
    const binding=bindings[index];
    if(binding){
      await sourceAccessTx(client,ctx,input.scope.scopeId,binding);
      assertRegionCitation(binding,await registryRegionSourceTx(client,input.scope.scopeId,binding.document,true));
    }
    const body={selection,binding:binding??null,targetPath:[input.target],
      applicabilitySha256:binding?fingerprint({binding,target:input.target,purpose:input.purpose}):null,
      state:binding?'included':'blocked_required_context',reasonCode:binding?null:'committed_region_binding_unavailable'};
    entries.push(UspPdfPacketPlanEntrySchema.parse({...body,entrySha256:fingerprint(body)}));
  }
  return {targetBodySha256:captured.body_sha256 as string,targetLabel:target.body?.name??target.identifier,
    entries,requiredContext:bindings.every(Boolean)?'available' as const:'blocked' as const};
}
export function assertPdfAssessment(plan:PdfPacketPlan,assessment:Awaited<ReturnType<typeof assessPdfPlanTx>>){
  if(assessment.targetBodySha256!==plan.targetBodySha256||assessment.targetLabel!==plan.targetLabel||
    canonical(assessment.entries)!==canonical(plan.entries)||assessment.requiredContext!==plan.requiredContext)
    conflict('The exact PDF plan context changed. Create a fresh selection.');
}
