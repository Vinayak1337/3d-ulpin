import { z } from 'zod';
import { CoreIdSchema, CorePositiveRevisionSchema, CoreRevisionRefSchema, CoreSha256Schema, coreText } from '../spatial/core/scalars';
import { UspAssetRefSchema } from './common';

export const UspRepresentationSchema = z.enum(['context_mesh', 'physical_semantic', 'legal_space']);
export const UspGeometryClassSchema = z.enum(['evidence_linked', 'estimated', 'illustrative']);
export const UspGeometrySourcePinSchema = z.strictObject({
  source: CoreRevisionRefSchema, sha256: CoreSha256Schema,
}).readonly();
export const UspGeometryQualificationSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('unqualified'), reasons: z.array(CoreIdSchema).min(1).max(64).readonly() }).readonly(),
  z.strictObject({ state: z.literal('qualified'), receiptId: z.uuid(), targetBodySha256: CoreSha256Schema,
    sources: z.array(UspGeometrySourcePinSchema).min(1).max(256).readonly() }).readonly(),
]);

/** A classification is not a qualification. Runtime readers also verify the retained receipt and exact SQL pins. */
export const UspGeometryMetadataSchema = z.strictObject({
  representation: UspRepresentationSchema, geometryClass: UspGeometryClassSchema,
  analyticEligible: z.boolean(), semanticLod: coreText(64).nullable(),
  displayLevel: z.number().int().nonnegative().nullable(), qualification: UspGeometryQualificationSchema,
}).superRefine((value, ctx) => {
  const qualified = value.qualification.state === 'qualified';
  if (value.analyticEligible !== qualified || (qualified &&
      (value.geometryClass !== 'evidence_linked' || value.representation === 'context_mesh'))) {
    ctx.addIssue({ code: 'custom', path: ['analyticEligible'], message: 'Analytical use requires qualified evidence-linked semantic geometry' });
  }
}).readonly();

export const DataSufficiencyVerdictSchema = z.strictObject({
  task: CoreIdSchema, requirements: z.array(CoreIdSchema).min(1).max(64).readonly(),
  outcome: z.enum(['sufficient', 'partial', 'insufficient_for_spatial_reconstruction']),
  missing: z.array(CoreIdSchema).max(64).readonly(),
}).superRefine((value, ctx) => {
  if (new Set(value.requirements).size !== value.requirements.length ||
      new Set(value.missing).size !== value.missing.length ||
      value.missing.some(item => !value.requirements.includes(item)) ||
      (value.outcome === 'sufficient') !== (value.missing.length === 0) ||
      (value.outcome === 'partial' && value.missing.length === value.requirements.length)) {
    ctx.addIssue({ code: 'custom', message: 'Sufficiency must preserve the exact required and missing evidence' });
  }
}).readonly();
export const UspDataSufficiencyVerdictSchema = DataSufficiencyVerdictSchema;

export const UspDisplayDerivativeSchema = z.strictObject({
  id: z.uuid(), record: CoreRevisionRefSchema.refine(pin => pin.ref.namespace === 'registry_record' && pin.revision > 0,
    'A derivative must pin an existing recorded canonical revision'),
  inputPins: z.array(CoreRevisionRefSchema).min(1).max(256).readonly(),
  generatorVersion: CoreIdSchema, seed: coreText(256), asset: UspAssetRefSchema,
  metadata: UspGeometryMetadataSchema, stale: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.metadata.analyticEligible || value.metadata.qualification.state !== 'unqualified') {
    ctx.addIssue({ code: 'custom', path: ['metadata'], message: 'Display derivatives cannot qualify analytical geometry' });
  }
  if (!value.inputPins.some(pin => pin.ref.namespace === value.record.ref.namespace &&
      pin.ref.id === value.record.ref.id && pin.revision === value.record.revision)) {
    ctx.addIssue({ code: 'custom', path: ['inputPins'], message: 'Input pins must include the canonical record revision' });
  }
}).readonly();

export const UspGeometryProjectionSchema = z.strictObject({
  target: CoreRevisionRefSchema, metadata: UspGeometryMetadataSchema.nullable(),
  qualificationRevision: CorePositiveRevisionSchema.nullable(), sufficiency: DataSufficiencyVerdictSchema,
}).superRefine((value, ctx) => {
  if ((value.metadata?.analyticEligible === true) !== (value.sufficiency.outcome === 'sufficient') ||
      (value.metadata?.analyticEligible && value.qualificationRevision === null)) {
    ctx.addIssue({ code: 'custom', message: 'Current eligibility and sufficiency must agree and pin a qualification revision' });
  }
}).readonly();
export type UspGeometryMetadata = z.infer<typeof UspGeometryMetadataSchema>;
export type DataSufficiencyVerdict = z.infer<typeof DataSufficiencyVerdictSchema>;
export type UspDisplayDerivative = z.infer<typeof UspDisplayDerivativeSchema>;
export type UspGeometryProjection = z.infer<typeof UspGeometryProjectionSchema>;
