import { z } from 'zod';
import {
  CoreIdSchema, CoreNumberValueSchema, CorePositiveRevisionSchema, CoreRefSchema,
  CoreRevisionRefSchema, CoreSha256Schema, coreRefKey, coreText,
} from '../spatial/core/scalars';
import {
  UspAssetRefSchema, UspEvidencePointerSchema, UspMutationGuardSchema,
  UspProposalSelectionSchema, UspScopeSchema, UspSnapshotScopeSchema, UspTargetPinSchema,
} from './common';

const pin = CoreRevisionRefSchema;
const orderedPins = z.array(pin).max(10000).readonly();
const timestamp = z.iso.datetime({ offset: true });

export const UspIdentifierAssertionSchema = z.strictObject({
  scheme: CoreIdSchema, value: coreText(512), issuer: coreText(512).nullable(),
  source: pin.nullable(), state: z.enum(['supplied', 'reviewed', 'disputed', 'retired']),
}).readonly();
export const UspResolvedTargetSchema = z.strictObject({
  pin: UspTargetPinSchema, scope: UspSnapshotScopeSchema,
  backing: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('registry'), siteId: CoreIdSchema, recordId: CoreIdSchema }).readonly(),
    z.strictObject({ kind: z.literal('area_feature'), areaId: CoreIdSchema, featureId: CoreIdSchema }).readonly(),
    z.strictObject({ kind: z.literal('retained_dataset'), datasetId: CoreIdSchema, objectId: CoreIdSchema }).readonly(),
    z.strictObject({ kind: z.literal('case_draft'), caseId: CoreIdSchema, candidateId: CoreIdSchema }).readonly(),
  ]),
  kind: z.enum(['parcel', 'building', 'floor', 'space', 'source_only']),
  label: coreText(512), identifiers: z.array(UspIdentifierAssertionSchema).max(64).readonly(),
  relations: z.array(z.strictObject({ kind: z.enum(['within', 'floor', 'serves', 'crosses']),
    target: UspTargetPinSchema }).readonly()).max(100).readonly(),
  representations: orderedPins, evidence: z.array(UspEvidencePointerSchema).max(256).readonly(),
  recordState: z.enum(['draft', 'recorded', 'retained']), capabilities: z.array(CoreIdSchema).max(64).readonly(),
}).readonly();

export const UspAuthorizedAssetSchema = z.strictObject({
  asset: UspAssetRefSchema, pointer: UspEvidencePointerSchema,
  action: z.enum(['preview', 'extract', 'original']),
  mediaType: coreText(255), bytes: z.number().int().nonnegative(),
  disposition: z.enum(['attachment', 'safe_inline']),
  accessViewId: CoreIdSchema,
}).readonly();

export const UspSnapshotMemberSchema = z.strictObject({
  pin, bodySha256: CoreSha256Schema, bodyRef: CoreIdSchema,
  authority: z.enum(['registry', 'area_feature', 'source', 'source_part', 'relationship', 'review']),
}).readonly();
export const UspSnapshotManifestSchema = z.strictObject({
  schemaVersion: z.literal('usp/1'), id: CoreIdSchema, digest: CoreSha256Schema,
  scope: UspSnapshotScopeSchema, capturedAt: timestamp,
  selection: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('site'), pins: z.tuple([]) }).readonly(),
    z.strictObject({ kind: z.literal('targets'), pins: z.array(pin).min(1).max(100).readonly() }).readonly(),
  ]),
  members: z.array(UspSnapshotMemberSchema).max(20000).readonly(),
  frame: z.strictObject({ horizontal: coreText(512).nullable(), vertical: coreText(512).nullable(),
    unit: coreText(64).nullable(), transform: pin.nullable() }).readonly(),
  policyVersion: CoreIdSchema, accessViewId: CoreIdSchema,
  validAt: timestamp.nullable(), asOf: timestamp.nullable(),
  coverage: z.strictObject({ state: z.enum(['complete', 'partial']),
    reasonCodes: z.array(CoreIdSchema).max(64).readonly() }).readonly(),
}).superRefine((manifest, ctx) => {
  if (manifest.scope.manifestId !== manifest.id || manifest.scope.snapshotDigest !== manifest.digest) {
    ctx.addIssue({ code: 'custom', path: ['scope'], message: 'Scope does not pin this manifest' });
  }
  const keys = manifest.members.map(member => `${coreRefKey(member.pin.ref)}@${member.pin.revision}`);
  if (keys.some((key, index) => index > 0 && key <= keys[index - 1])) {
    ctx.addIssue({ code: 'custom', path: ['members'], message: 'Members must be sorted and unique' });
  }
}).readonly();
export const UspScopePageSchema = z.strictObject({
  items: z.array(UspResolvedTargetSchema).max(100).readonly(), nextCursor: coreText(4096).nullable(),
  manifestId: CoreIdSchema, coverage: UspSnapshotManifestSchema.unwrap().shape.coverage,
}).readonly();
export const UspVerticalSelectionSchema = z.strictObject({
  scope: UspSnapshotScopeSchema, building: UspTargetPinSchema,
  floor: UspTargetPinSchema, space: UspTargetPinSchema,
}).readonly();
export const UspVerticalContextSchema = z.strictObject({
  building: UspResolvedTargetSchema, floor: UspResolvedTargetSchema,
  space: UspResolvedTargetSchema,
}).readonly();

export const UspRegistryChangeSchema = z.strictObject({
  kind: z.literal('registry_draft'), draftId: CoreIdSchema,
  expectedDraftRevision: CorePositiveRevisionSchema,
}).readonly();
export const UspRelationshipChangeSchema = z.strictObject({
  kind: z.literal('relationship'), from: UspTargetPinSchema, to: UspTargetPinSchema,
  relation: z.enum(['within', 'floor', 'serves', 'crosses']),
}).readonly();
export const UspProposalChangeSchema = z.discriminatedUnion('kind', [UspRegistryChangeSchema, UspRelationshipChangeSchema]);
export const UspPrepareProposalSchema = z.intersection(
  z.strictObject({ kind: z.enum(['registry', 'relationship']), scope: UspSnapshotScopeSchema,
    changes: z.array(UspProposalChangeSchema).min(1).max(100).readonly(),
    evidence: z.array(UspEvidencePointerSchema).max(256).readonly(), guard: UspMutationGuardSchema }).readonly(),
  UspProposalSelectionSchema,
);
export const UspCommitProposalSchema = z.strictObject({
  kind: z.enum(['registry', 'relationship']), proposalId: CoreIdSchema, reviewId: CoreIdSchema,
  scope: UspSnapshotScopeSchema, guard: UspMutationGuardSchema,
  acknowledgement: z.string().trim().max(2048),
}).readonly();
export const UspCommitReceiptSchema = z.strictObject({
  receiptId: CoreIdSchema, operation: CoreIdSchema, requestKey: coreText(128),
  commandSha256: CoreSha256Schema, proposalId: CoreIdSchema, reviewId: CoreIdSchema,
  before: orderedPins, after: orderedPins, snapshot: UspSnapshotScopeSchema,
  event: z.strictObject({ streamId: CoreIdSchema, sequence: z.string().regex(/^[1-9][0-9]*$/) }).readonly(),
  committedAt: timestamp,
}).readonly();

export const UspJobProjectionSchema = z.strictObject({
  jobId: CoreIdSchema, version: CorePositiveRevisionSchema, operation: CoreIdSchema,
  status: z.enum(['queued', 'running', 'needs_input', 'succeeded', 'failed', 'paused', 'cancelled']),
  scope: UspScopeSchema, inputManifestId: CoreIdSchema, inputSha256: CoreSha256Schema,
  progress: z.strictObject({ completed: z.number().int().nonnegative(), total: z.number().int().positive().nullable() }).nullable(),
  attempt: z.strictObject({ number: z.number().int().nonnegative(), fence: CorePositiveRevisionSchema,
    leaseUntil: timestamp.nullable() }).readonly(),
  result: UspAssetRefSchema.nullable(), errorCode: CoreIdSchema.nullable(),
}).readonly();
export const UspEnqueueJobSchema = z.strictObject({
  operation: CoreIdSchema, scope: UspScopeSchema, inputManifestId: CoreIdSchema,
  payloadRef: UspAssetRefSchema, budgetProfile: CoreIdSchema, guard: UspMutationGuardSchema,
}).readonly();

export const UspReleaseDecisionSchema = z.strictObject({
  id: CoreIdSchema, version: CorePositiveRevisionSchema, output: UspAssetRefSchema,
  lineage: z.array(UspEvidencePointerSchema).min(1).max(256).readonly(),
  audience: z.enum(['operator', 'contributor', 'public']), reviewer: coreText(256),
  policyVersion: CoreIdSchema, state: z.enum(['active', 'revoked']),
  expiresAt: timestamp.nullable(), reviewedAt: timestamp,
  redaction: coreText(2048), applicability: coreText(2048),
}).readonly();

export const UspMeasuredQuantitySchema = z.strictObject({
  definition: CoreIdSchema, unit: CoreIdSchema, value: CoreNumberValueSchema,
  source: pin.nullable(),
}).readonly();

export type ResolvedTarget = z.infer<typeof UspResolvedTargetSchema>;
export type AuthorizedAsset = z.infer<typeof UspAuthorizedAssetSchema>;
export type SnapshotManifest = z.infer<typeof UspSnapshotManifestSchema>;
export type ScopePage = z.infer<typeof UspScopePageSchema>;
export type PrepareProposal = z.infer<typeof UspPrepareProposalSchema>;
export type CommitProposal = z.infer<typeof UspCommitProposalSchema>;
export type CommitReceipt = z.infer<typeof UspCommitReceiptSchema>;
export type JobProjection = z.infer<typeof UspJobProjectionSchema>;
export type ReleaseDecision = z.infer<typeof UspReleaseDecisionSchema>;
