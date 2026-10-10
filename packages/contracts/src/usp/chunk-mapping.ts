import {z} from 'zod';
import {AdaptiveMappingResponseSchema} from './adaptive-mapping';
import { CanonicalMappedValueSchema, ColumnProfileDocumentSchema,
  MappingPlanV2Schema } from '../canonical/mapping-plan';
import { CanonicalTargetSchema, MappingTargetSchema } from '../canonical/targets';
import { TabularPinSchema } from './ingestion';
import { MappingChunkMetricsSchema } from './ingestion-events';

const id=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const issue=z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);
export const CHUNK_MAPPING_LIMITS=Object.freeze({version:'chunk-mapping/1',chunkBytes:256*1024,
  chunkFeatures:100,chunks:4096,readMs:12*60*1000,active:1});
export const MappingQuestionSchema = z.strictObject({ sourceField: z.string().min(1).max(512),
  header: z.string().max(400), reason: issue, candidates: z.array(MappingTargetSchema).max(36) });
export const TabularChunkResultSchema = z.strictObject({
  profile: ColumnProfileDocumentSchema, plan: MappingPlanV2Schema,
  fieldSources: z.array(z.strictObject({ sourceField: z.string().min(1).max(512),
    source: z.enum(['memory', 'student', 'teacher', 'officer']), method: z.string().min(1).max(300) })).max(256),
  questions: z.array(MappingQuestionSchema).max(256), metrics: MappingChunkMetricsSchema,
  sourceRows: z.array(z.number().int().positive()).max(100),
  rows: z.array(z.strictObject({ row: z.number().int().nonnegative(),
    fields: z.array(CanonicalMappedValueSchema.extend({
    sourceField: z.string().min(1).max(512), target: CanonicalTargetSchema })).max(256) })).max(100),
}).superRefine((value,ctx)=>{
  const names=value.profile.columns.map(column=>column.name);
  const fields=value.plan.fields.map(field=>field.sourceField);
  const sources=value.fieldSources.map(field=>field.sourceField);
  const questions=value.questions.map(question=>question.sourceField);
  if(value.profile.sourceKind!=='tabular'||value.plan.sourceKind!=='tabular'
    ||value.profile.layoutFingerprint!==value.plan.layoutFingerprint
    ||JSON.stringify(names)!==JSON.stringify(fields)||JSON.stringify(names)!==JSON.stringify(sources)
    ||new Set(questions).size!==questions.length||questions.some(name=>!names.includes(name))
    ||value.sourceRows.length!==value.rows.length)
    ctx.addIssue({code:'custom',
      message:'Tabular plan, provenance, questions and row locators must match the profile.'});
});
export const ChunkMappingRequestSchema=z.strictObject({requestKey:id,rawJobId:id,
  expectedCaseRevision:z.number().int().nonnegative(),expectedSourceRevision:z.number().int().positive(),sourceSha256:hash,
  profileJobId:id.optional(),profileGeneration:z.number().int().nonnegative().optional(),profileHash:hash.optional(),
  prefixAdmissionVersion:z.literal('streamed-prefix-admission/1').optional(),tabular:TabularPinSchema.optional(),
}).superRefine((value,ctx)=>{
  const count=[value.profileJobId,value.profileGeneration,value.profileHash].filter(item=>item!==undefined).length;
  if(count!==0&&count!==3)ctx.addIssue({code:'custom',message:'Pin one complete streamed profile generation.'});
  if(value.prefixAdmissionVersion&&count!==3)
    ctx.addIssue({code:'custom',message:'Prefix admission requires one immutable observed profile generation.'});
  if(value.tabular&&(count!==0||value.prefixAdmissionVersion))
    ctx.addIssue({code:'custom',message:'Tabular pins cannot be combined with a GIS profile generation.'});
});
export const ChunkMappingInputSchema=z.strictObject({version:z.literal(CHUNK_MAPPING_LIMITS.version),jobId:id,
  caseId:id,caseRevision:z.number().int().nonnegative(),sourceId:id,sourceRevision:z.number().int().positive(),
  sourceFamilyId:id,sourceSha256:hash,rawJobId:id,rawInputFingerprint:hash,readerSha256:hash,
  route:z.enum(['approved_recipe','proposal_only']),recipeId:id.nullable(),recipeRevision:z.number().int().positive().nullable(),
  planHash:hash.nullable(),schemaFingerprint:hash.nullable(),workspaceFingerprint:hash.nullable(),
  profileJobId:id.optional(),profileGeneration:z.number().int().nonnegative().optional(),profileHash:hash.optional(),
  prefixAdmissionVersion:z.literal('streamed-prefix-admission/1').optional(),tabular:TabularPinSchema.optional(),
  converterSha256:hash,subject:z.string().min(1).max(300),accessBinding:hash,inputFingerprint:hash,
}).superRefine((value,ctx)=>{
  const count=[value.profileJobId,value.profileGeneration,value.profileHash].filter(item=>item!==undefined).length;
  if(count!==0&&count!==3)ctx.addIssue({code:'custom',message:'A streamed job must pin one complete profile generation.'});
  if(value.prefixAdmissionVersion&&(count!==3||value.route!=='approved_recipe'))
    ctx.addIssue({code:'custom',message:'Prefix admission requires an approved immutable profile recipe.'});
  if(value.tabular&&(count!==0||value.prefixAdmissionVersion))
    ctx.addIssue({code:'custom',message:'Tabular jobs cannot contain a GIS profile generation.'});
});
export const ChunkMappingFieldSchema=z.strictObject({state:z.enum(['known','absent','null','withheld','conflicting','unknown']),
  value:z.string().max(2048).nullable(),sourcePath:z.string().max(512).nullable()});
export const ChunkMappingObservationSchema=z.strictObject({featureIndex:z.number().int().nonnegative(),
  byteStart:z.number().int().nonnegative(),byteEnd:z.number().int().positive(),rawSha256:hash,
  disposition:z.enum(['observed','quarantined','unresolved']),sourceKey:ChunkMappingFieldSchema,
  name:ChunkMappingFieldSchema,geometryRef:z.strictObject({rawJobId:id,chunkIndex:z.number().int().nonnegative(),
    featureIndex:z.number().int().nonnegative(),rawSha256:hash,sourcePath:z.literal('/features/*/geometry')}).nullable(),
  issueCodes:z.array(issue).max(8)});
export const ChunkMappingPayloadSchema=z.strictObject({version:z.literal(CHUNK_MAPPING_LIMITS.version),jobId:id,
  rawJobId:id,sourceId:id,sourceRevision:z.number().int().positive(),sourceSha256:hash,
  chunkIndex:z.number().int().nonnegative(),rawResultSha256:hash,schemaFingerprint:hash.nullable(),
  recipeRevision:z.number().int().positive().nullable(),tabular:TabularPinSchema.optional(),
  mapping:TabularChunkResultSchema.optional(),
  converterSha256:hash,profileHash:hash.optional(),prefixAdmissionVersion:z.literal('streamed-prefix-admission/1').optional(),
  records:z.array(ChunkMappingObservationSchema).max(CHUNK_MAPPING_LIMITS.chunkFeatures)}).superRefine((value,ctx)=>{
    if(Boolean(value.tabular)!==Boolean(value.mapping)||(!value.tabular&&value.recipeRevision===null))
      ctx.addIssue({code:'custom',message:'Tabular drafts require pins and a mapping; GIS drafts require a recipe.'});
    if(value.mapping&&(value.records.length!==0||value.mapping.metrics.jobId!==value.jobId
      ||value.mapping.metrics.chunkIndex!==value.chunkIndex||value.profileHash||value.prefixAdmissionVersion))
      ctx.addIssue({code:'custom',message:'Tabular metrics must name this chunk without GIS records or profile pins.'});
  });
export const ChunkMappingSlotSchema=z.strictObject({chunkIndex:z.number().int().nonnegative().max(CHUNK_MAPPING_LIMITS.chunks),
  status:z.enum(['ready','quarantined']),published:z.boolean(),rawResultSha256:hash.nullable(),
  schemaFingerprint:hash.nullable(),schemaDrift:z.boolean(),
  firstFeatureIndex:z.number().int().nonnegative(),lastFeatureIndex:z.number().int().nonnegative().nullable(),
  records:z.number().int().nonnegative().max(CHUNK_MAPPING_LIMITS.chunkFeatures),
  normalized:z.number().int().nonnegative(),quarantined:z.number().int().nonnegative(),unresolved:z.number().int().nonnegative(),
  bytes:z.number().int().nonnegative().max(CHUNK_MAPPING_LIMITS.chunkBytes),
  ref:z.strictObject({key:z.string().min(1).max(400),sha256:hash,bytes:z.number().int().positive().max(CHUNK_MAPPING_LIMITS.chunkBytes)}).nullable(),
  issueCode:issue.nullable(),resultSha256:hash,attempt:z.number().int().positive(),fence:z.number().int().positive()});
export const ChunkMappingStatusSchema=z.strictObject({version:z.literal(CHUNK_MAPPING_LIMITS.version),jobId:id,rawJobId:id,
  caseId:id,sourceId:id,sourceRevision:z.number().int().positive(),sourceSha256:hash,
  status:z.enum(['queued','running','needs_input','disabled','unavailable','completed','completed_with_rejections','failed','stale']),
  route:z.enum(['approved_recipe','proposal_only']),recipeId:id.nullable(),recipeRevision:z.number().int().positive().nullable(),
  schemaFingerprint:hash.nullable(),converterSha256:hash,sourceCrs:z.string().max(100).nullable(),
  profileJobId:id.optional(),profileGeneration:z.number().int().nonnegative().optional(),profileHash:hash.optional(),
  prefixAdmissionVersion:z.literal('streamed-prefix-admission/1').optional(),tabular:TabularPinSchema.optional(),
  referenceEvidence:z.string().max(200).nullable(),globalPlacement:z.literal('not_qualified'),
  nextPublishIndex:z.number().int().nonnegative(),sealedChunks:z.number().int().nonnegative().nullable(),
  records:z.number().int().nonnegative(),normalized:z.number().int().nonnegative(),
  quarantined:z.number().int().nonnegative(),unresolved:z.number().int().nonnegative(),duplicateKeys:z.number().int().nonnegative(),
  schemaDriftChunks:z.number().int().nonnegative(),
  issueCode:issue.nullable(),unknownRemainder:z.boolean(),sourceComplete:z.boolean(),identityComplete:z.boolean(),
  proposal:AdaptiveMappingResponseSchema.nullable(),proposalTrainingEligible:z.literal(false),slots:z.array(ChunkMappingSlotSchema).max(32)});
export const ChunkMappingChunkResponseSchema=z.strictObject({slot:ChunkMappingSlotSchema,
  payload:ChunkMappingPayloadSchema.nullable(),sourceComplete:z.boolean(),identityComplete:z.boolean(),unknownRemainder:z.boolean()});
export type ChunkMappingInput=z.infer<typeof ChunkMappingInputSchema>;
export type ChunkMappingObservation=z.infer<typeof ChunkMappingObservationSchema>;
export type ChunkMappingPayload=z.infer<typeof ChunkMappingPayloadSchema>;
export type ChunkMappingSlot=z.infer<typeof ChunkMappingSlotSchema>;
