import { z } from 'zod';
import { CoreRevisionRefSchema, CoreSha256Schema, coreText } from '../spatial/core/scalars';
import { UspEvidencePointerSchema, UspPinnedUpdateGuardSchema, UspSnapshotScopeSchema, UspTargetPinSchema } from './common';

export const DECLARATION_ACKNOWLEDGEMENT = 'Technical acceptance only; not legal approval or source truth.';
// This first profile is a single site with at most 100 explicitly pinned members.
const positiveInteger = z.string().regex(/^[1-9][0-9]{0,127}$/);
export const UspShareFractionSchema = z.strictObject({ numerator: positiveInteger, denominator: positiveInteger }).readonly();
export const UspDeclarationValiditySchema = z.strictObject({
  from: z.iso.date().nullable(), to: z.iso.date().nullable(),
  endState: z.enum(['stated', 'open_ended', 'unknown']),
}).refine(value => (!value.from || !value.to || value.from <= value.to)
  && (value.endState === 'stated' ? value.to !== null : value.to === null), 'Validity interval or end state is inconsistent').readonly();
export const UspDeclarationEvidenceSchema = z.strictObject({
  pointer: UspEvidencePointerSchema, sha256: CoreSha256Schema,
  bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).readonly();
export const UspShareEntryInputSchema = z.strictObject({
  pin: CoreRevisionRefSchema.refine(p => p.ref.namespace === 'declaration_entry' && p.revision > 0),
  target: UspTargetPinSchema.refine(p => p.ref.namespace === 'registry_record' && p.revision > 0),
  literalLabel: coreText(512), literalShare: coreText(512), fraction: UspShareFractionSchema,
  evidence: UspDeclarationEvidenceSchema, validity: UspDeclarationValiditySchema,
}).readonly();
export const UspDeclarationInputSchema = z.strictObject({
  jurisdiction: coreText(512), statute: coreText(1024).nullable(),
  allocationSubject: z.enum(['land_interest', 'general_common_property', 'limited_common_property', 'stated_other']),
  subjectDefinition: coreText(1024),
  basis: z.enum(['declared_value', 'declared_area', 'source_defined_other']), basisDefinition: coreText(1024),
  instrument: UspDeclarationEvidenceSchema,
  population: z.strictObject({ status: z.enum(['complete', 'partial', 'unknown', 'conflicting']),
    declaredCount: z.number().int().min(1).max(100).nullable(),
    targets: z.array(UspTargetPinSchema).min(1).max(100).readonly(),
    evidence: UspDeclarationEvidenceSchema,
  }).readonly(),
  denominator: z.strictObject({ state: z.enum(['known', 'unknown', 'withheld', 'conflicting']),
    literal: coreText(1024).nullable(), quantity: UspShareFractionSchema.nullable(),
    unit: coreText(64).nullable(), evidence: UspDeclarationEvidenceSchema,
  }).refine(d => d.state !== 'known' || d.literal !== null, 'A known denominator needs its source definition').readonly(),
  rounding: coreText(1024).nullable(), validity: UspDeclarationValiditySchema,
  entries: z.array(UspShareEntryInputSchema).min(1).max(100).readonly(),
}).readonly();
export const UspDeclarationAssessmentSchema = z.strictObject({
  state: z.enum(['reconciled', 'arithmetic_mismatch', 'not_assessed_incomplete_population', 'not_assessed_denominator', 'conflicting_population']),
  populationStatus: z.enum(['complete', 'partial', 'unknown', 'conflicting']),
  knownSubtotal: z.strictObject({ numerator: z.string().regex(/^(0|[1-9][0-9]{0,4095})$/),
    denominator: z.string().regex(/^[1-9][0-9]{0,4095}$/) }).readonly(),
  declaredCount: z.number().int().min(1).max(100).nullable(), suppliedCount: z.number().int().nonnegative(),
  missingCount: z.number().int().nonnegative(), ambiguousCount: z.number().int().nonnegative(),
  reasonCodes: z.array(coreText(128)).max(16).readonly(),
}).readonly();
export const UspDeclarationApplicabilityInputSchema = z.strictObject({
  target: UspTargetPinSchema, state: z.enum(['applicable', 'not_assessed', 'conflicting']),
  evidence: UspDeclarationEvidenceSchema, reason: coreText(2048),
  purpose: z.literal('declared_share'), relationPath: z.array(UspTargetPinSchema).max(8).readonly(),
  validity: UspDeclarationValiditySchema,
}).readonly();
export const UspReviewDeclarationSchema = z.strictObject({
  proposalId: z.uuid(), scope: UspSnapshotScopeSchema, guard: UspPinnedUpdateGuardSchema,
  acknowledgement: z.literal(DECLARATION_ACKNOWLEDGEMENT), sourceAcknowledged: z.literal(true),
  populationAcknowledged: z.literal(true), assessmentState: UspDeclarationAssessmentSchema.unwrap().shape.state,
  reason: coreText(2048), consentEvidence: z.array(UspDeclarationEvidenceSchema).max(16).readonly(),
  applicability: z.array(UspDeclarationApplicabilityInputSchema).max(100).readonly(),
}).readonly();
export const UspDeclarationProposalResultSchema = z.strictObject({
  proposalId: z.uuid(), version: z.literal(1), state: z.literal('draft'), assessment: UspDeclarationAssessmentSchema,
}).readonly();
export const UspDeclarationReviewResultSchema = z.strictObject({
  reviewId: z.uuid(), proposalId: z.uuid(), version: z.literal(1), state: z.literal('reviewed'),
  assessment: UspDeclarationAssessmentSchema,
}).readonly();
export const UspReadDeclarationSchema = z.strictObject({
  scope: UspSnapshotScopeSchema, target: UspTargetPinSchema,
  declaration: CoreRevisionRefSchema.refine(p => p.ref.namespace === 'declaration' && p.revision > 0),
  validAt: z.iso.date().nullable(),
}).readonly();
export const UspReadDeclarationProposalSchema = z.strictObject({ proposalId: z.uuid(), scope: UspSnapshotScopeSchema }).readonly();
export const UspDeclarationDraftSchema = z.strictObject({
  proposalId: z.uuid(), version: z.literal(1), state: z.enum(['draft', 'reviewed', 'technically_accepted']),
  reviewId: z.uuid().nullable(),
  declaration: CoreRevisionRefSchema, supersedes: CoreRevisionRefSchema.nullable(),
  input: UspDeclarationInputSchema, assessment: UspDeclarationAssessmentSchema,
}).readonly();
export const UspSelectedDeclarationSchema = z.strictObject({
  declaration: CoreRevisionRefSchema, target: UspTargetPinSchema,
  technicalStatus: z.literal('technically_accepted'), legalStatus: z.literal('not_assessed'),
  allocationSubject: UspDeclarationInputSchema.unwrap().shape.allocationSubject,
  subjectDefinition: coreText(1024), basis: UspDeclarationInputSchema.unwrap().shape.basis,
  basisDefinition: coreText(1024), jurisdiction: coreText(512), statute: coreText(1024).nullable(),
  denominator: UspDeclarationInputSchema.unwrap().shape.denominator, rounding: coreText(1024).nullable(),
  validity: UspDeclarationValiditySchema, supersedes: CoreRevisionRefSchema.nullable(),
  assessment: UspDeclarationAssessmentSchema,
  entry: UspShareEntryInputSchema.nullable(),
  applicability: z.strictObject({ pin: CoreRevisionRefSchema, state: z.enum(['applicable', 'not_assessed', 'conflicting']),
    reason: coreText(2048), evidence: UspDeclarationEvidenceSchema, purpose: z.literal('declared_share'),
    validity: UspDeclarationValiditySchema, consentStatus: z.enum(['reviewed_evidence', 'not_assessed', 'not_required']),
  }).readonly().nullable(),
  packetState: z.enum(['available', 'not_assessed']),
}).readonly();
export type DeclarationInput = z.infer<typeof UspDeclarationInputSchema>;
export type DeclarationEvidence = z.infer<typeof UspDeclarationEvidenceSchema>;
export type DeclarationAssessment = z.infer<typeof UspDeclarationAssessmentSchema>;
export type ReviewDeclaration = z.infer<typeof UspReviewDeclarationSchema>;
