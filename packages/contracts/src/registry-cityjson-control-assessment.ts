import {z} from 'zod';
import {DocumentLocatorSchema} from './usp/document-ingestion';
import {DocumentAssociationSourceSchema} from './document-association';

export const CITYJSON_CONTROL_VERSION='registry-cityjson-control-assessment/1' as const;
export const CITYJSON_CONTROL_LIMITS=Object.freeze({points:20,requestBytes:16*1024,responseBytes:128*1024});
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.uuid().transform(v=>v.toLowerCase());
const number=z.number().finite(),coordinate=z.tuple([number,number,number]);
const frame=z.strictObject({id:z.string().min(1).max(256),axes:z.tuple([z.string(),z.string(),z.string()]),
  unit:z.string().min(1).max(32),vertical:z.string().min(1).max(128)});
/** Accepted native TEXT part content, never request-body coordinate truth.
 * A source-declared survey and explicit officer review permit a comparison,
 * not an accuracy pass or an independently qualified learning label. */
export const NativePointControlSchema=z.strictObject({version:z.literal('native-point-control/1'),
  controlId:z.string().min(1).max(128),targetObjectId:z.string().min(1).max(512),frame,
  acquisition:z.strictObject({method:z.enum(['independent_survey','derived_from_native','model_prediction','unknown']),
    observedAt:z.iso.datetime(),issuer:z.string().min(1).max(256)}),
  coordinates:z.tuple([number.nullable(),number.nullable(),number.nullable()]).nullable().optional()});
export const RegistryCityJSONControlRequestSchema=z.strictObject({expectedDraftRevision:z.number().int().positive(),
  candidateSha256:hash,selectionSha256:hash,referencesSha256:hash,
  correspondences:z.array(z.strictObject({referenceId:hash,nativeVertexIndex:z.number().int().nonnegative().max(99999),
    review:z.strictObject({correspondence:z.literal('reviewed'),independentAcquisition:z.literal('reviewed'),
      basis:z.string().trim().min(1).max(512)})})).max(CITYJSON_CONTROL_LIMITS.points)
    .refine(rows=>new Set(rows.map(row=>row.referenceId)).size===rows.length&&
      new Set(rows.map(row=>row.nativeVertexIndex)).size===rows.length,'Select each control and native vertex once.')});
const evidence=z.strictObject({document:DocumentAssociationSourceSchema,partId:id,partSha256:hash,locator:DocumentLocatorSchema,
  coordinatePointer:z.literal('/coordinates'),inputSha256:hash,readerSha256:hash,acceptedFence:z.number().int().positive()});
const point=z.strictObject({referenceId:hash,nativeVertexIndex:z.number().int().nonnegative(),nativeVertexPointer:z.string(),
  reviewSha256:hash,evidence,controlId:z.string().nullable(),state:z.enum(['comparison_computed','needs_input']),
  reasonCode:z.string().nullable(),nativePosition:coordinate.nullable(),controlPosition:coordinate.nullable(),
  residual:coordinate.nullable(),horizontalMetres:number.nonnegative().nullable(),verticalMetres:number.nullable(),
  distanceMetres:number.nonnegative().nullable()});
export const RegistryCityJSONControlAssessmentSchema=z.strictObject({version:z.literal(CITYJSON_CONTROL_VERSION),
  state:z.enum(['comparison_computed','needs_input']),assessmentSha256:hash,
  draft:z.strictObject({id,draftRevision:z.number().int().positive(),recordId:id,candidateSha256:hash,selectionSha256:hash,referencesSha256:hash}),
  source:z.strictObject({caseId:id,caseRevision:z.number().int().nonnegative(),sourceId:id,sourceSha256:hash,
    nativeArtifactSha256:hash,verticesSha256:hash,transformSha256:hash}),
  frame,points:z.array(point).max(CITYJSON_CONTROL_LIMITS.points),
  metrics:z.strictObject({count:z.number().int().positive(),meanResidual:coordinate,rmseHorizontalMetres:number.nonnegative(),
    rmseVerticalMetres:number.nonnegative(),rmse3DMetres:number.nonnegative(),maximum3DMetres:number.nonnegative()}).nullable(),
  missing:z.array(z.strictObject({referenceId:hash.nullable(),reasonCode:z.string()})).max(CITYJSON_CONTROL_LIMITS.points+1),
  provenance:z.strictObject({method:z.literal('same_named_frame_point_residuals'),
    nativeDecode:z.literal('cityjson_scale_translate_once'),controlProfile:z.literal('native-point-control/1'),
    reviewAttribution:z.literal('local_process'),contextSha256:hash,inputSha256:hash,
    independence:z.literal('source_declared_and_operator_reviewed')}),
  accuracy:z.literal('not_assessed'),admission:z.literal('unavailable'),qualification:z.literal('not_assessed'),
  learningQualification:z.literal('not_assessed')});
export type RegistryCityJSONControlRequest=z.infer<typeof RegistryCityJSONControlRequestSchema>;
export type RegistryCityJSONControlAssessment=z.infer<typeof RegistryCityJSONControlAssessmentSchema>;
