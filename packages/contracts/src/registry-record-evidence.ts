import {z} from 'zod';
import {RegistryDocumentEvidenceSchema} from './registry-document-evidence';

export const RegistryRecordEvidenceRevisionSchema=z.number().int().positive().max(2147483647);
export const RegistryRecordEvidenceRequestSchema=z.strictObject({
  recordId:z.uuid().transform(value=>value.toLowerCase()),revision:RegistryRecordEvidenceRevisionSchema,
});
export const RegistryRecordEvidenceSchema=z.strictObject({
  version:z.literal('registry-record-evidence/1'),
  recordId:z.uuid(),siteId:z.uuid(),recordKind:z.enum(['building','floor','space']),
  recordRevision:RegistryRecordEvidenceRevisionSchema,recordBodySha256:z.string().regex(/^[a-f0-9]{64}$/),
  siteRevision:z.number().int().nonnegative().max(2147483647),
  currentRecordRevision:RegistryRecordEvidenceRevisionSchema,
  currentSiteRevision:z.number().int().nonnegative().max(2147483647),
  snapshotState:z.enum(['current','historical']),
  citations:RegistryDocumentEvidenceSchema.shape.citations,
  associationState:z.literal('operator_selected'),qualification:z.literal('not_assessed'),
}).superRefine((value,ctx)=>{
  if(value.recordRevision>value.currentRecordRevision||value.siteRevision>value.currentSiteRevision||
    value.snapshotState!==(value.recordRevision===value.currentRecordRevision?'current':'historical'))
    ctx.addIssue({code:'custom',message:'Selected and current revision pins must describe the same exact history.'});
});
export type RegistryRecordEvidenceRequest=z.infer<typeof RegistryRecordEvidenceRequestSchema>;
export type RegistryRecordEvidence=z.infer<typeof RegistryRecordEvidenceSchema>;
