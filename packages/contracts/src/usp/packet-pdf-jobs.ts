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
export const PacketPdfJobStatusSchema=z.strictObject({jobId:z.uuid(),version:z.number().int().positive(),
  planId:z.uuid(),planVersion:z.number().int().positive(),scope:UspSnapshotScopeSchema,
  status:z.enum(['queued','running','succeeded','failed','cancelled']),
  attempt:z.strictObject({number:z.number().int().nonnegative(),fence:z.number().int().nonnegative(),leaseUntil:z.iso.datetime({offset:true}).nullable()}),
  errorCode:CoreIdSchema.nullable(),result:z.strictObject({packetId:z.uuid(),artifact:UspAssetRefSchema}).nullable()}).readonly();
export const PacketPdfJobControlSchema=z.strictObject({jobId:z.uuid(),action:z.enum(['cancel','retry']),
  expectedVersion:z.number().int().positive(),requestKey:z.uuid()}).readonly();
export const PacketPdfJobChangedSchema=z.strictObject({type:z.literal('packet.pdf.job.changed'),jobId:z.uuid(),
  scope:UspSnapshotScopeSchema,planId:z.uuid(),planVersion:z.number().int().positive(),
  status:PacketPdfJobStatusSchema.unwrap().shape.status,packetId:z.uuid().nullable()});
export type PacketPdfJobInput=z.output<typeof PacketPdfJobInputSchema>;
