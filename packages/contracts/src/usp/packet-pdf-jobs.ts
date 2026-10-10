import {z} from 'zod';
import {CoreIdSchema,CoreSha256Schema} from '../spatial/core/scalars';
import {RegistryRegionOriginalSchema} from '../registry-document-evidence';
import {UspAssetRefSchema,UspSnapshotScopeSchema} from './common';
import {UspExecutePacketPlanSchema} from './packets';

export const PACKET_PDF_JOB_OPERATION='packet-pdf' as const;
export const UspEnqueuePacketPdfJobSchema=UspExecutePacketPlanSchema;
/** Server-derived immutable job input. Actor roles are never queued authority. */
export const PacketPdfJobInputSchema=z.strictObject({version:z.literal('packet-pdf-job/1'),jobId:z.uuid(),
  command:UspExecutePacketPlanSchema,planSha256:CoreSha256Schema,confirmationSha256:CoreSha256Schema,
  scope:UspSnapshotScopeSchema,anchor:RegistryRegionOriginalSchema,
  bindingsSha256:CoreSha256Schema,actorSha256:CoreSha256Schema,subject:CoreIdSchema,
  accessViewId:CoreIdSchema,policyVersion:CoreIdSchema}).readonly();
/** Committed checkpoint work only. Neither current crop reuse nor final packet
 * acceptance follows from this projection; status does no artifact/profile I/O. */
export const PacketPdfJobEntryProgressSchema=z.strictObject({
  checkpointCapability:z.enum(['available','unavailable']),requiredCount:z.number().int().min(1).max(4),
  acceptedCount:z.number().int().min(0).max(4).nullable(),currentReuseEligibility:z.literal('not_assessed'),
  entries:z.array(z.strictObject({index:z.number().int().min(0).max(3),required:z.literal(true),
    state:z.enum(['pending','accepted_checkpoint','checkpoint_unavailable'])})).min(1).max(4),
}).superRefine((value,ctx)=>{
  const available=value.checkpointCapability==='available';
  if(value.entries.length!==value.requiredCount||value.entries.some((entry,index)=>entry.index!==index||
    (available?entry.state==='checkpoint_unavailable':entry.state!=='checkpoint_unavailable'))||
    (available?value.acceptedCount!==value.entries.filter(entry=>entry.state==='accepted_checkpoint').length:value.acceptedCount!==null))
    ctx.addIssue({code:'custom',message:'Entry progress must describe the exact ordered checkpoint population and capability.'});
}).readonly();
export const PacketPdfJobStatusSchema=z.strictObject({jobId:z.uuid(),version:z.number().int().positive(),
  planId:z.uuid(),planVersion:z.number().int().positive(),scope:UspSnapshotScopeSchema,
  status:z.enum(['queued','running','succeeded','failed','cancelled']),
  attempt:z.strictObject({number:z.number().int().nonnegative(),fence:z.number().int().nonnegative(),leaseUntil:z.iso.datetime({offset:true}).nullable()}),
  errorCode:CoreIdSchema.nullable(),result:z.strictObject({packetId:z.uuid(),artifact:UspAssetRefSchema}).nullable(),
  entryProgress:PacketPdfJobEntryProgressSchema}).readonly();
export const PacketPdfJobControlSchema=z.strictObject({jobId:z.uuid(),action:z.enum(['cancel','retry']),
  expectedVersion:z.number().int().positive(),requestKey:z.uuid()}).readonly();
export const PacketPdfJobChangedSchema=z.strictObject({type:z.literal('packet.pdf.job.changed'),jobId:z.uuid(),
  scope:UspSnapshotScopeSchema,planId:z.uuid(),planVersion:z.number().int().positive(),
  status:PacketPdfJobStatusSchema.unwrap().shape.status,packetId:z.uuid().nullable()});
export type PacketPdfJobInput=z.output<typeof PacketPdfJobInputSchema>;
