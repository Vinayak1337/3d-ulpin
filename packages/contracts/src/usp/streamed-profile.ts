import {z} from 'zod';
import {LayoutKindSchema,MappingOperationSchema,SourcePathSchema,SourcePinSchema,
  ConverterLayoutPinSchema,MappingApprovalSchema,layoutTargetsIssue,positionKeyIssue} from './ingestion';
import {STREAMING_VECTOR_LIMITS,StreamingVectorRecordSchema} from './streaming-vector';

const id=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const issue=z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);
export const STREAMED_PROFILE_LIMITS=Object.freeze({version:'streamed-profile/1',paths:64,
  generations:STREAMING_VECTOR_LIMITS.chunks+1,quarantineLocators:100,bodyBytes:65536,active:4,waitMs:12*60*1000});
export const StreamedProfileRequestSchema=z.strictObject({requestKey:id,rawJobId:id,
  expectedCaseRevision:z.number().int().nonnegative(),expectedSourceRevision:z.number().int().positive(),sourceSha256:hash});
export const StreamedProfileInputSchema=z.strictObject({version:z.literal(STREAMED_PROFILE_LIMITS.version),jobId:id,
  caseId:id,caseRevision:z.number().int().nonnegative(),sourceId:id,sourceRevision:z.number().int().positive(),
  sourceFamilyId:id,sourceSha256:hash,rawJobId:id,rawInputFingerprint:hash,readerSha256:hash,
  profilerSha256:hash,subject:z.string().min(1).max(300),accessBinding:hash,inputFingerprint:hash});
const streamedCounts={types:z.array(z.enum(['string','number','boolean','object','array'])).max(5),
  values:z.number().int().nonnegative(),explicitNull:z.number().int().nonnegative(),
  absent:z.number().int().nonnegative()};
/** Values that are whole numbers within the exact integer range; absent in a generation that did not count them. */
const streamedIntegers=z.number().int().nonnegative().optional();
export const StreamedProfilePathSchema=z.strictObject({path:SourcePathSchema,...streamedCounts,
  unknown:z.number().int().nonnegative(),integers:streamedIntegers,
  /** In a file of outlines with pins or lines, the same counts over the outlines an outline kind draws. */
  outline:z.strictObject({...streamedCounts,integers:streamedIntegers}).optional()});
export const StreamedProfileLocatorSchema=z.strictObject({featureIndex:z.number().int().nonnegative(),
  byteStart:z.number().int().nonnegative(),byteEnd:z.number().int().positive(),rawSha256:hash,issueCode:issue,
  sequencePosition:StreamingVectorRecordSchema.shape.sequencePosition});
export const StreamedProfileGenerationSchema=z.strictObject({version:z.literal(STREAMED_PROFILE_LIMITS.version),
  jobId:id,rawJobId:id,source:SourcePinSchema,readerSha256:hash,profilerSha256:hash,
  generation:z.number().int().nonnegative().max(STREAMED_PROFILE_LIMITS.generations),generationHash:hash,
  previousHash:hash.nullable(),
  coverage:z.enum(['provisional','sealed']),rawChunkIndex:z.number().int().nonnegative().nullable(),
  rawResultSha256:hash.nullable(),recordsSeen:z.number().int().nonnegative(),
  accepted:z.number().int().nonnegative(),quarantined:z.number().int().nonnegative(),
  unknownRemainder:z.boolean(),paths:z.array(StreamedProfilePathSchema).max(STREAMED_PROFILE_LIMITS.paths),
  geometryTypes:z.array(z.string().min(1).max(64)).max(8),
  quarantineLocators:z.array(StreamedProfileLocatorSchema).max(STREAMED_PROFILE_LIMITS.quarantineLocators),
  reference:z.strictObject({sourceCrs:z.string().max(100).nullable(),evidence:z.string().max(200).nullable(),
    unit:z.string().min(1).max(80).nullable().optional(),globalPlacement:z.literal('not_qualified')})});
/** caseRevision is the revision the inventory was queued at; a streamed layout pins it, not the case's current one. */
export const StreamedProfileStatusSchema=z.strictObject({version:z.literal(STREAMED_PROFILE_LIMITS.version),
  jobId:id,rawJobId:id,caseId:id,caseRevision:z.number().int().nonnegative(),sourceId:id,sourceRevision:z.number().int().positive(),sourceSha256:hash,
  status:z.enum(['queued','running','sealed','failed','stale']),nextRawIndex:z.number().int().nonnegative(),
  latest:StreamedProfileGenerationSchema.nullable(),issueCode:issue.nullable(),
  sourceComplete:z.boolean(),usableCoverage:z.boolean(),identityComplete:z.literal(false)});

const SemanticEvidenceSchema=z.strictObject({target:MappingOperationSchema.shape.target,
  sourcePath:SourcePathSchema,issuer:z.string().min(1).max(500),evidenceUrl:z.url().max(2048),
  meaning:z.enum(['building_source_identity','building_name','building_footprint',
    'feature_source_identity','feature_name','feature_geometry'])});
const mappingPlanFields={mode:z.literal('streamed_mapping'),source:SourcePinSchema,caseId:id,caseRevision:z.number().int().nonnegative(),
  rawJobId:id,profileJobId:id,profileGeneration:z.number().int().nonnegative(),profileHash:hash,
  kind:LayoutKindSchema.optional(),operations:z.array(MappingOperationSchema).min(2).max(3),
  semanticEvidence:z.array(SemanticEvidenceSchema).max(3),
  basis:z.enum(['publisher_cited','officer_stated','converter_recorded']).optional(),
  converterPin:ConverterLayoutPinSchema.optional(),
};
const MappingPlanBaseSchema=z.strictObject(mappingPlanFields);
const reviewPlan=(plan:z.infer<typeof MappingPlanBaseSchema>,ctx:z.RefinementCtx)=>{
  const message=layoutTargetsIssue(plan.kind,plan.operations.map(op=>op.target))||positionKeyIssue(plan.operations);
  if(message)ctx.addIssue({code:'custom',path:['operations'],message});
  if(plan.source.schemaFingerprint!==plan.profileHash)
    ctx.addIssue({code:'custom',path:['profileHash'],message:'The exact profile generation must be pinned.'});
  const meanings={'building.sourceKey':'building_source_identity','building.name':'building_name',
    'building.geometry':'building_footprint','feature.sourceKey':'feature_source_identity',
    'feature.name':'feature_name','feature.geometry':'feature_geometry'} as const;
  if(Boolean(plan.converterPin)!==(plan.basis==='converter_recorded'))
    ctx.addIssue({code:'custom',path:['converterPin'],message:'Converter semantics require their exact pin.'});
  if(plan.basis==='officer_stated'||plan.basis==='converter_recorded'){
    if(plan.semanticEvidence.length!==0)
      ctx.addIssue({code:'custom',path:['semanticEvidence'],
        message:'Officer-stated and converter-recorded layouts carry no publisher citations.'});
    return;
  }
  if(plan.semanticEvidence.length!==plan.operations.length||plan.operations.some(op=>
    plan.semanticEvidence.filter(item=>item.target===op.target&&item.sourcePath===op.sourcePath
      &&item.meaning===meanings[op.target]).length!==1))
    ctx.addIssue({code:'custom',path:['semanticEvidence'],message:'Each operation needs matching issuer meaning evidence.'});
};
export const StreamedMappingPlanSchema=z.strictObject({...mappingPlanFields,
  version:z.literal('streamed-mapping/1'),scope:z.literal('accepted_source_features'),
}).superRefine(reviewPlan);
/** An immutable observed prefix permits later compatible rows, never a whole-source claim. */
export const StreamedPrefixMappingPlanSchema=z.strictObject({...mappingPlanFields,
  version:z.literal('streamed-prefix-mapping/1'),scope:z.literal('observed_prefix_and_later_compatible_features'),
  prefix:z.strictObject({throughRawChunkIndex:z.number().int().nonnegative().max(STREAMING_VECTOR_LIMITS.chunks),
    rawResultSha256:hash,recordsSeen:z.number().int().positive(),accepted:z.number().int().positive()}),
}).superRefine((plan,ctx)=>{
  reviewPlan(plan,ctx);
  if(plan.profileGeneration!==plan.prefix.throughRawChunkIndex)
    ctx.addIssue({code:'custom',path:['prefix'],message:'The prefix must name its immutable profile generation.'});
});
export const AnyStreamedMappingPlanSchema=z.union([StreamedMappingPlanSchema,StreamedPrefixMappingPlanSchema]);
export const StreamedMappingAuthorSchema=z.strictObject({requestKey:id,
  expectedRecipeRevision:z.number().int().nonnegative(),plan:StreamedMappingPlanSchema});
export const StreamedPrefixMappingAuthorSchema=z.strictObject({requestKey:id,
  expectedRecipeRevision:z.number().int().nonnegative(),plan:StreamedPrefixMappingPlanSchema});
export const StreamedMappingReceiptSchema=z.strictObject({id,revision:z.number().int().positive(),
  state:z.enum(['proposed','approved']),plan:AnyStreamedMappingPlanSchema,planHash:hash,
  authoredBy:z.string().min(1).max(300),authoredAt:z.iso.datetime(),
  approval:MappingApprovalSchema.nullable()});
export type StreamedProfileInput=z.infer<typeof StreamedProfileInputSchema>;
export type StreamedProfileGeneration=z.infer<typeof StreamedProfileGenerationSchema>;
export type StreamedProfilePath=z.infer<typeof StreamedProfilePathSchema>;
export type StreamedMappingPlan=z.infer<typeof AnyStreamedMappingPlanSchema>;
export type StreamedPrefixMappingPlan=z.infer<typeof StreamedPrefixMappingPlanSchema>;
export type StreamedMappingReceipt=z.infer<typeof StreamedMappingReceiptSchema>;
