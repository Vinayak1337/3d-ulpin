import { z } from 'zod';

const label = z.string().min(1).max(120).refine(value => value.trim().length > 0);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const region = z.tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative(),
  z.number().finite().positive(), z.number().finite().positive()]).refine(box => box[0] < box[2] && box[1] < box[3]);

export const SourceSpaceEvidenceSchema = z.strictObject({
  sourceId: z.uuid(), sourceRevision: z.number().int().positive(), page: z.number().int().min(1).max(400),
  region, literal: label,
});
const statement = z.strictObject({ label, evidence: SourceSpaceEvidenceSchema }).refine(
  value => value.label === value.evidence.literal, 'The label must equal the officer-transcribed literal.',
);
export const SourceSpaceRequestSchema = z.strictObject({
  requestKey: z.uuid(), expectedCanonicalRevision: hash, level: statement, space: statement,
  reason: z.string().trim().min(3).max(2000),
});
export const SourceSpaceReceiptSchema = z.strictObject({
  requestKey: z.uuid(), buildingId: z.uuid(), recordRevision: z.number().int().positive(),
  floorId: z.uuid(), spaceId: z.uuid(), floorCreated: z.boolean(),
  floorRevision: z.number().int().positive(), spaceRevision: z.literal(1),
  scheduleLevelId: z.uuid().nullable(), actor: z.string().min(1).max(256), time: z.iso.datetime(),
});
export const SourceStatedRecordSchema = z.strictObject({
  id: z.uuid(), siteId: z.uuid(), identifier: z.string().min(1).max(256), revision: z.number().int().positive(),
  alias: label, name: label, kind: z.enum(['floor', 'space']), footprint: z.array(z.never()).length(0),
  placement: z.literal('unknown'), rights: z.array(z.never()).length(0), synthetic: z.literal(false),
  classification: z.literal('test_only'),
  links: z.array(z.strictObject({ targetId: z.uuid(), type: z.enum(['within', 'floor']) })).length(1),
  evidence: z.array(z.strictObject({ sourceId: z.uuid(), locator: z.string().min(1).max(500) })).length(1),
  sourceOnly: z.strictObject({
    version: z.literal('source-stated-space/1'), buildingId: z.uuid(), parentId: z.uuid(),
    scheduleLevelId: z.uuid().nullable(), evidence: SourceSpaceEvidenceSchema.extend({ sourceSha256: hash }),
    transcription: z.literal('officer_entered'),
    decision: z.strictObject({ actor: z.string().min(1).max(256), reason: z.string().min(3).max(2000),
      time: z.iso.datetime() }),
  }),
}).superRefine((record, ctx) => {
  const link = record.links[0];
  if (record.name !== record.alias || record.name !== record.sourceOnly.evidence.literal
    || link.targetId !== record.sourceOnly.parentId || link.type !== (record.kind === 'floor' ? 'within' : 'floor')
    || (record.kind === 'floor' && record.sourceOnly.parentId !== record.sourceOnly.buildingId)
    || record.evidence[0].sourceId !== record.sourceOnly.evidence.sourceId) {
    ctx.addIssue({ code: 'custom', message: 'Source-only labels, evidence and exact parent must agree.' });
  }
});
export type SourceSpaceRequest = z.infer<typeof SourceSpaceRequestSchema>;
export type SourceSpaceReceipt = z.infer<typeof SourceSpaceReceiptSchema>;
export type SourceStatedRecord = z.infer<typeof SourceStatedRecordSchema>;
export type SourceSpaceEvidence = z.infer<typeof SourceSpaceEvidenceSchema>;
