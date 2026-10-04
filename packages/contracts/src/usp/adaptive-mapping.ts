import {z} from 'zod';
import {MappingOperationSchema,MappingPlanSchema,SourcePinSchema} from './ingestion';

export const ADAPTIVE_MAPPING_VERSION='adaptive-geojson-proposal/1' as const;
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const id=z.string().uuid();

/** The caller pins the current read-only inventory. The server reads it again at every dispatch boundary. */
export const AdaptiveMappingRequestSchema=z.strictObject({
  requestKey:id,source:SourcePinSchema,workspaceRevision:z.number().int().nonnegative(),workspaceFingerprint:hash,
});

/** Only registry tokens may leave the model. No values, expressions, tools or destination are accepted. */
export const AdaptiveMappingModelOutputSchema=z.strictObject({
  decision:z.enum(['propose','abstain']),
  reason:z.enum(['none','missing_identity','ambiguous_identity','unsupported_semantics','other']),
  operations:z.array(MappingOperationSchema).max(3),
});

export const AdaptiveMappingResponseSchema=z.strictObject({
  version:z.literal(ADAPTIVE_MAPPING_VERSION),requestKey:id,source:SourcePinSchema,
  workspaceRevision:z.number().int().nonnegative(),workspaceFingerprint:hash,
  status:z.enum(['proposed','needs_input','disabled','unavailable','blocked']),
  code:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable(),
  plan:MappingPlanSchema.nullable(),
  validationErrors:z.array(z.string().min(1).max(256)).max(8),
  call:z.strictObject({callId:id,responseSha256:hash,modelId:z.string().min(1).max(160)}).nullable(),
  /** Canonical gateway attribution; absent for old responses or no returned model output. */
  replayed:z.boolean().optional(),
  /** Valid syntax and conversion mechanics are not independent evidence of field meaning. */
  validation:z.literal('mechanics_only'),reviewRequired:z.literal(true),
});

export type AdaptiveMappingRequest=z.infer<typeof AdaptiveMappingRequestSchema>;
export type AdaptiveMappingModelOutput=z.infer<typeof AdaptiveMappingModelOutputSchema>;
export type AdaptiveMappingResponse=z.infer<typeof AdaptiveMappingResponseSchema>;
