import type {PoolClient} from 'pg';
import {DocumentInputSchema,DocumentOriginalSchema,DOCUMENT_POLICY,RetainedDocumentFreshnessSchema,
  type DocumentInput,type RetainedDocumentFreshness} from '@ulpin/contracts/usp';
import {AppError,conflict,notFound} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {ingestionBinding,assertIngestionBinding} from './events';
import {documentReaderSha} from './document-native';
import {modelGatewayPolicyHash} from '../../model-gateway/runtime';
import {documentOcrConfigSha} from './document-ocr';
import {compareSourcePins} from './source-pin';

export function documentLayoutCap(){
  const value=process.env.ULPIN_DOCUMENT_MODEL_LAYOUT_CAP;
  if(value===undefined)return null;
  return /^(0|[1-9]\d?)$|^100$/.test(value)?Number(value):null;
}
export function documentGatewayHash(){
  try{return modelGatewayPolicyHash()??null;}catch{return fingerprint({invalidGateway:process.env.ULPIN_MODEL_GATEWAY_CONFIG??'',enabled:process.env.ULPIN_MODEL_GATEWAY_ENABLED??''});}
}
export async function documentCaseTx(client:PoolClient,caseId:string,lock=false){
  const binding=ingestionBinding(caseId);
  const current=(await client.query(`SELECT id,revision,archived,frame,context,site_id FROM cases WHERE id=$1${lock?' FOR UPDATE':''}`,[caseId])).rows[0]??notFound('Source case not found.');
  if(current.archived)throw new AppError(403,'DOCUMENT_DENIED','This source context is unavailable.');
  assertIngestionBinding(binding);
  return {current,binding,context:fingerprint({frame:current.frame,context:current.context,siteId:current.site_id})};
}
export async function documentSourceTx(client:PoolClient,caseId:string,sourceId:string,lock=false){
  const scope=await documentCaseTx(client,caseId,lock);
  const source=(await client.query('SELECT * FROM sources WHERE case_id=$1 AND id=$2',[caseId,sourceId])).rows[0]??notFound('Source not found in this case.');
  const original=DocumentOriginalSchema.safeParse(source.inspection?.documentOriginal);
  if(!original.success || original.data.subject!==scope.binding.subject)throw new AppError(403,'DOCUMENT_DENIED','This source context is unavailable.');
  if(original.data.sha256!==source.sha256 || original.data.bytes!==Number(source.bytes))throw new AppError(422,'DOCUMENT_SOURCE_INTEGRITY','The original receipt differs from its canonical source.');
  const latest=Number((await client.query('SELECT max(revision) revision FROM sources WHERE case_id=$1 AND family_id=$2',[caseId,source.family_id])).rows[0].revision)===source.revision;
  return {...scope,source,latest};
}
export function documentInput(ctx:Awaited<ReturnType<typeof documentSourceTx>>,jobId:string,mode:DocumentInput['mode'],
  ocrSelection?:DocumentInput['ocrSelection'],archiveSelection?:DocumentInput['archiveSelection']):DocumentInput{
  return DocumentInputSchema.parse({version:'source-document/1',jobId,caseId:ctx.current.id,caseRevision:ctx.current.revision,
    caseContextSha256:ctx.context,sourceId:ctx.source.id,familyId:ctx.source.family_id,sourceRevision:ctx.source.revision,
    sourceSha256:ctx.source.sha256,sourceBytes:Number(ctx.source.bytes),objectKey:ctx.source.object_key,
    subject:ctx.binding.subject,accessSha256:ctx.binding.access,policyVersion:DOCUMENT_POLICY,readerSha256:documentReaderSha(),
    gatewayPolicySha256:mode==='propose'?documentGatewayHash():null,layoutCap:mode==='propose'?documentLayoutCap():null,mode,
    ...(ocrSelection?{ocrSelection,ocrConfigSha256:documentOcrConfigSha()}: {}),...(archiveSelection?{archiveSelection}:{})});
}
type DocumentSourceContext=Awaited<ReturnType<typeof documentSourceTx>>;
/** What moved on since a retained input was pinned. Private scope and the immutable original are checked elsewhere. */
export function documentInputFreshness(ctx:DocumentSourceContext,input:DocumentInput):RetainedDocumentFreshness{
  const now=documentInput(ctx,input.jobId,input.mode,input.ocrSelection,input.archiveSelection);
  const pins=compareSourcePins(now,input);
  const moved=(...fields:(keyof DocumentInput)[])=>fields.some(field=>pins.moved.includes(field));
  const reasons:RetainedDocumentFreshness['reasons'][number][]=[];
  if(moved('caseContextSha256'))reasons.push('case_advanced');
  if(moved('readerSha256'))reasons.push('reader_changed');
  if(moved('policyVersion','gatewayPolicySha256','layoutCap','ocrConfigSha256'))reasons.push('policy_changed');
  if(!ctx.latest)reasons.push('source_superseded');
  return RetainedDocumentFreshnessSchema.parse({current:pins.current&&ctx.latest,reasons});
}
/** Authorize and locate a retained input for a read or a capture of what is already recorded. An archived case,
 * another operator's context or a changed original still refuses; a moved-on case, reader or policy is reported
 * as freshness and never grants authority to derive or write. */
export async function locateDocumentInputTx(client:PoolClient,input:DocumentInput){
  const ctx=await documentSourceTx(client,input.caseId,input.sourceId);
  if(input.subject!==ctx.binding.subject||input.accessSha256!==ctx.binding.access)
    throw new AppError(403,'DOCUMENT_DENIED','This source context is unavailable.');
  if(input.sourceRevision!==ctx.source.revision||input.familyId!==ctx.source.family_id
    ||input.sourceSha256!==ctx.source.sha256||input.sourceBytes!==Number(ctx.source.bytes)
    ||input.objectKey!==ctx.source.object_key)
    throw new AppError(422,'DOCUMENT_SOURCE_INTEGRITY','The retained input differs from its canonical source.');
  return {ctx,freshness:documentInputFreshness(ctx,input)};
}
/** Require current pins: every path that derives or writes something new under this input. */
export async function assertDocumentInputTx(client:PoolClient,input:DocumentInput,lock=false){
  const ctx=await documentSourceTx(client,input.caseId,input.sourceId,lock);
  const pins=compareSourcePins(documentInput(ctx,input.jobId,input.mode,input.ocrSelection,input.archiveSelection),input);
  if(!ctx.latest || !pins.current)
    conflict('The document source, case context, reader, access or model policy changed; retry under current pins.');
  const job=(await client.query(`SELECT payload,input_fingerprint FROM jobs
    WHERE id=$1 AND case_id=$2 AND source_id=$3 AND operation='document-extraction'`,[input.jobId,input.caseId,input.sourceId])).rows[0];
  if((input.archiveSelection || job?.payload?.archiveSelection) &&
    (!job || job.input_fingerprint!==fingerprint(input) || fingerprint(job.payload)!==fingerprint(input)))
    conflict('The archive selection differs from its registered document job input.');
  return ctx;
}
