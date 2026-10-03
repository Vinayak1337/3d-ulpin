import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {RequestContext} from '@ulpin/contracts/usp';
import type {PacketPdfJobInput} from '../../../../../contracts/src/usp/packet-pdf-jobs';
import {RegistryRegionOriginalSchema} from '../../../../../contracts/src/registry-document-evidence';
import {PACKET_REGION_LIMITS,PacketRegionWorkerSchema} from '../../../../../contracts/src/packet-region';
import {transaction,type DbDeadline} from '../../../infrastructure/db';
import {AppError,conflict} from '../../../infrastructure/errors';
import {sha256} from '../../../infrastructure/storage';
import {canonical,fingerprint} from '../../cases/domain';
import {assertUspJobAttemptTx,type UspJobAttempt} from '../jobs';
import {enrolledPacketPdfJobTx,preparePacketPdfJobTx} from './pdf-job-authority';
import {pdfExecutionLive,type PreparedPdfExecution,type PdfPacketIo,type PdfCropRecovery} from './pdf-service';
import {assertCleanRegionPng} from './region-extract';

const hash=z.string().regex(/^[a-f0-9]{64}$/),text=z.string().min(1).max(512);
/** Private server receipt: no new public job input, recipe or plan hash. */
const identitySchema=z.strictObject({version:z.literal('packet-pdf-entry/1'),jobId:z.uuid(),jobInputSha256:hash,
  planId:z.uuid(),planVersion:z.number().int().positive(),planSha256:hash,confirmationId:z.uuid(),confirmationSha256:hash,
  entryIndex:z.number().int().min(0).max(3),entrySha256:hash,bindingId:hash,bindingSha256:hash,
  targetSha256:hash,targetBodySha256:hash,snapshotSha256:hash,original:RegistryRegionOriginalSchema,
  validation:PacketRegionWorkerSchema,actorSha256:hash,subject:text,accessViewId:text,policyVersion:text});
const checkpointSchema=z.strictObject({version:z.literal('packet-pdf-entry-checkpoint/1'),checkpointId:z.uuid(),
  identity:identitySchema,identitySha256:hash,objectKey:text,
  attempt:z.strictObject({number:z.number().int().positive(),fence:z.number().int().positive(),owner:text,
    inputSha256:hash,leaseUntil:z.iso.datetime({offset:true})}),acceptedAt:z.iso.datetime({offset:true})});
type Checkpoint=z.output<typeof checkpointSchema>;

function expectedIdentity(input:PacketPdfJobInput,first:PreparedPdfExecution,index:number){
  const entry=first.plan.entries[index],binding=first.bindings[index];
  if(!entry||!binding||entry.state!=='included')conflict('The exact required PDF entry is unavailable.');
  return identitySchema.parse({version:'packet-pdf-entry/1',jobId:input.jobId,jobInputSha256:fingerprint(input),
    planId:first.plan.planId,planVersion:first.plan.version,planSha256:first.plan.planSha256,
    confirmationId:first.confirmation.confirmationId,confirmationSha256:input.confirmationSha256,
    entryIndex:index,entrySha256:entry.entrySha256,bindingId:binding.id,bindingSha256:fingerprint(binding),
    targetSha256:fingerprint(first.plan.input.target),targetBodySha256:first.plan.targetBodySha256,
    snapshotSha256:fingerprint(first.plan.input.scope),original:binding.document,validation:binding.validation,
    actorSha256:input.actorSha256,subject:input.subject,accessViewId:input.accessViewId,policyVersion:input.policyVersion});
}
function checkpointKey(id:string,identity:z.output<typeof identitySchema>){
  return `usp/packets/jobs/${identity.jobId}/entries/${identity.entryIndex}/${id}/${identity.validation.output.sha256}`;
}
function decodeCheckpoint(row:Record<string,any>,identity:z.output<typeof identitySchema>):Checkpoint{
  if(Buffer.byteLength(canonical(row.body))>65536)conflict('The private PDF entry receipt exceeds its bound.');
  const parsed=checkpointSchema.safeParse(row.body);
  if(!parsed.success)conflict('The private PDF entry receipt is invalid.');
  const receipt=parsed.data,proof=receipt.identity.validation.output;
  if(canonical(receipt.identity)!==canonical(identity)||receipt.identitySha256!==fingerprint(identity)||
    row.id!==receipt.checkpointId||row.job_id!==identity.jobId||row.plan_id!==identity.planId||row.plan_version!==identity.planVersion||
    Number(row.entry_index)!==identity.entryIndex||row.identity_sha256!==receipt.identitySha256||row.body_sha256!==fingerprint(receipt)||
    row.object_key!==receipt.objectKey||receipt.objectKey!==checkpointKey(receipt.checkpointId,identity)||
    row.artifact_sha256!==proof.sha256||Number(row.artifact_bytes)!==proof.bytes||
    Number(row.accepted_attempt)!==receipt.attempt.number||Number(row.accepted_fence)!==receipt.attempt.fence||
    receipt.attempt.inputSha256!==identity.jobInputSha256||Date.parse(receipt.acceptedAt)>=Date.parse(receipt.attempt.leaseUntil))
    conflict('The accepted PDF entry differs from its immutable authority or bytes.');
  return receipt;
}
async function checkpointTx(client:PoolClient,identity:z.output<typeof identitySchema>){
  const row=(await client.query('SELECT * FROM usp_packet_pdf_entry_checkpoints WHERE job_id=$1 AND entry_index=$2 FOR SHARE',
    [identity.jobId,identity.entryIndex])).rows[0];
  if(!row)return null;
  const receipt=decodeCheckpoint(row,identity);
  const attempt=(await client.query('SELECT * FROM usp_job_attempts WHERE job_id=$1 AND number=$2',
    [identity.jobId,receipt.attempt.number])).rows[0];
  if(!attempt||Number(attempt.fence)!==receipt.attempt.fence||attempt.owner!==receipt.attempt.owner||
    attempt.input_sha256!==identity.jobInputSha256||!['active','fenced','accepted'].includes(attempt.state))
    conflict('The accepted PDF entry lost its canonical attempt linkage.');
  return receipt;
}
function checkedCrop(bytes:Uint8Array,identity:z.output<typeof identitySchema>){
  const proof=identity.validation.output;
  if(proof.bytes>PACKET_REGION_LIMITS.pngBytes||bytes.length!==proof.bytes||sha256(bytes)!==proof.sha256)
    throw new AppError(422,'PACKET_PDF_CHECKPOINT_INTEGRITY','The accepted crop differs from its bounded byte receipt. Review a new plan.');
  const png=Buffer.from(bytes);assertCleanRegionPng(png,proof.pixels);return png;
}
/** Only committed exact crops are reused. Every I/O occurs outside SQL; one
 * canonical owned attempt accepts an immutable receipt in a short transaction. */
export function packetPdfCropRecovery(ctx:RequestContext,input:PacketPdfJobInput,owned:UspJobAttempt,
  first:PreparedPdfExecution,io:PdfPacketIo,bounds:DbDeadline):PdfCropRecovery{
  const live=()=>{bounds.signal?.throwIfAborted();pdfExecutionLive(bounds.deadlineAt);};
  const capture=async(client:PoolClient)=>{
    live();const current=await preparePacketPdfJobTx(client,ctx,input);
    if(!current.replay&&canonical(current)!==canonical(first))conflict('The exact PDF entry context changed.');
    const enrollment=await enrolledPacketPdfJobTx(client,ctx,input.jobId);
    if(canonical(enrollment.input)!==canonical(input)||owned.inputSha256!==fingerprint(input))
      conflict('The accepted crop belongs to another enrolled PDF input.');
    await assertUspJobAttemptTx(client,owned);
    if(!(await client.query("SELECT to_regclass('usp_packet_pdf_entry_checkpoints') IS NOT NULL AS available")).rows[0]?.available)
      throw new AppError(503,'PACKET_PDF_CHECKPOINT_UNAVAILABLE','Apply the registered PDF entry checkpoint migration before queued execution.');
    live();
  };
  const recipe=async(identity:z.output<typeof identitySchema>)=>{
    live();if(!io.recipe)throw new AppError(503,'PACKET_PDF_CHECKPOINT_RECIPE_UNAVAILABLE','Configure current recipe authority before accepted crop recovery.');
    const current=await io.recipe(identity.original.sourceId,bounds.deadlineAt);live();
    if(current!==identity.validation.recipeSha256)
      throw new AppError(409,'PACKET_PDF_CHECKPOINT_STALE','The current extraction recipe differs from the accepted crop. Review a new binding.');
  };
  return async(index,extract)=>{
    const identity=expectedIdentity(input,first,index);
    const before=await transaction(async client=>{await capture(client);return checkpointTx(client,identity);},bounds);
    if(before){
      await recipe(identity);
      const png=checkedCrop(await io.read(before.objectKey,identity.validation.output.bytes,identity.validation.output.sha256,bounds.deadlineAt),identity);
      live();await recipe(identity);
      await transaction(async client=>{await capture(client);const after=await checkpointTx(client,identity);
        if(canonical(after)!==canonical(before))conflict('The accepted crop changed during its private read.');live();},bounds);
      return png;
    }
    // The existing extraction/provenance preflight runs unchanged for a miss.
    live();const png=checkedCrop(await extract(),identity);live();await recipe(identity);
    const checkpointId=randomUUID(),key=checkpointKey(checkpointId,identity),remaining=bounds.deadlineAt-Date.now();
    const signal=AbortSignal.timeout(remaining);
    await io.put(key,png,'image/png',bounds.signal?AbortSignal.any([signal,bounds.signal]):signal);live();
    checkedCrop(await io.read(key,png.length,identity.validation.output.sha256,bounds.deadlineAt),identity);live();await recipe(identity);
    await transaction(async client=>{
      await capture(client);const winner=await checkpointTx(client,identity);
      if(winner)return;
      const receipt=checkpointSchema.parse({version:'packet-pdf-entry-checkpoint/1',checkpointId,identity,
        identitySha256:fingerprint(identity),objectKey:key,attempt:{number:owned.number,fence:owned.fence,
          owner:owned.owner,inputSha256:owned.inputSha256,leaseUntil:owned.leaseUntil},acceptedAt:new Date().toISOString()});
      if(Buffer.byteLength(canonical(receipt))>65536)conflict('The private PDF entry receipt exceeds its bound.');
      await client.query(`INSERT INTO usp_packet_pdf_entry_checkpoints(id,job_id,plan_id,plan_version,entry_index,
        identity_sha256,artifact_sha256,artifact_bytes,object_key,accepted_attempt,accepted_fence,body,body_sha256)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[checkpointId,input.jobId,identity.planId,identity.planVersion,index,
        receipt.identitySha256,identity.validation.output.sha256,png.length,key,owned.number,owned.fence,receipt,fingerprint(receipt)]);
      await assertUspJobAttemptTx(client,owned);live();
    },bounds);
    // Failed/unknown commits preserve staged immutable bytes; no cleanup here.
    return png;
  };
}
