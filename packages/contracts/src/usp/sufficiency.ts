import {z} from 'zod';
import {CoreIdSchema, CoreSha256Schema, coreText} from '../spatial/core/scalars';
import {ObjSummarySchema} from './obj-ingestion';
import {GltfSummarySchema} from './gltf-ingestion';
import {IFCSummarySchema} from './ifc-ingestion';
import {KMLMemberPinSchema,KMLSummarySchema} from './kml-ingestion';
import {CityGMLSummarySchema} from './citygml-ingestion';
import {DataSufficiencyRequirementsShape, exactSufficiencyRequirements} from './geometry';

export const SUFFICIENCY_VERSION='ingestion-sufficiency/1' as const;
export const SUFFICIENCY_POLICY='retained-source-tasks/1' as const;
export const SUFFICIENCY_LIMITS=Object.freeze({tasks:5,questions:5,sources:256,decisions:25,receiptBytes:65536,historyPage:128});
const id=z.uuid(), hash=CoreSha256Schema, rev=z.number().int().nonnegative();
export const SufficiencyPinsSchema=z.strictObject({caseId:id,caseRevision:rev,sourceId:id,familyId:id,
  sourceRevision:z.number().int().positive(),sourceSha256:hash,profile:coreText(80),
  contextSha256:hash,evidenceSha256:hash,accessSha256:hash,policyVersion:z.literal(SUFFICIENCY_POLICY)});
export const SufficiencyRecordPinSchema=z.strictObject({authority:z.enum(['recipe','job','package','area','frame','geometry','qualification']),
  id,revision:rev,sha256:hash});
export const SufficiencyEvidenceSchema=z.strictObject({requirement:CoreIdSchema,
  state:z.enum(['satisfied','present_unqualified','unknown','absent','null','withheld','conflicting','unsupported']),
  authority:z.enum(['source','inspection','recipe','job','package','geometry','policy']),
  id:coreText(256),revision:rev,locator:coreText(256).nullable()});
export const SufficiencyReferenceSchema=z.strictObject({kind:z.enum(['recipe','source_part','fact_candidate','package_review']),
  id:id,revision:z.number().int().positive(),sourceId:id,sourceRevision:z.number().int().positive(),packageId:id.optional()});
export const SufficiencyQuestionSchema=z.strictObject({id,revision:z.number().int().positive(),pins:SufficiencyPinsSchema,
  gapClass:CoreIdSchema,tasks:z.array(CoreIdSchema).min(1).max(5),state:z.enum(['open','answered','parked','stale']),
  missing:z.array(CoreIdSchema).min(1).max(64),unlocks:z.array(CoreIdSchema).min(1).max(5),
  reason:coreText(512),choices:z.tuple([z.literal('provide_existing_evidence'),z.literal('not_sure')]),
  proposal:SufficiencyReferenceSchema.nullable(),createdAt:z.iso.datetime()});
export const SufficiencyMeshMetadataSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('obj'),summary:ObjSummarySchema}),
  z.strictObject({kind:z.literal('gltf'),summary:GltfSummarySchema}),
]);
export const SufficiencyMeshProcessingSchema=z.strictObject({kind:z.enum(['obj','gltf']),
  inputSha256:hash.nullable(),readerSha256:hash.nullable(),acceptedFence:z.number().int().positive().nullable(),
  tools:z.enum(['not_checked','current','unavailable']),code:coreText(100).nullable(),
  metadata:SufficiencyMeshMetadataSchema.nullable(),
  coverage:z.literal('accepted_result_metadata_only; native_artifact_not_read'),
});
export const SufficiencyIFCProcessingSchema=z.strictObject({
  inputSha256:hash.nullable(),readerSha256:hash.nullable(),acceptedFence:z.number().int().positive().nullable(),
  tools:z.enum(['not_checked','current','unavailable']),code:coreText(100).nullable(),
  summary:IFCSummarySchema.nullable(),sourceUnits:z.literal('native_artifact_not_read'),
  coverage:z.literal('accepted_result_metadata_only; native_artifact_not_read'),
});
const xmlProcessing={inputSha256:hash.nullable(),readerSha256:hash.nullable(),acceptedFence:z.number().int().positive().nullable(),
  tools:z.enum(['not_checked','current','unavailable']),code:coreText(100).nullable(),
  sourceUnits:z.literal('native_artifact_not_read'),coverage:z.literal('accepted_result_metadata_only; native_artifact_not_read')};
export const SufficiencyXMLProcessingSchema=z.discriminatedUnion('kind',[
  z.strictObject({...xmlProcessing,kind:z.literal('kml'),requestedMember:KMLMemberPinSchema.nullable(),summary:KMLSummarySchema.nullable()}),
  z.strictObject({...xmlProcessing,kind:z.literal('citygml'),summary:CityGMLSummarySchema.nullable()}),
]);
export const SufficiencyProcessingSchema=z.strictObject({
  state:z.enum(['pending','running','failed','stale','needs_ocr','unsupported','tool_error','extracted','canonical_conversion_required','unavailable','inspected_local','inspected_partial','inspected_metadata']),
  jobId:id.nullable(),resultSha256:hash.nullable(),
  nativeStatus:z.enum(['extracted','needs_ocr','unsupported','encrypted','tool_error','inspected_local','inspected_partial']).nullable(),
  mesh:SufficiencyMeshProcessingSchema.optional(),
  ifc:SufficiencyIFCProcessingSchema.optional(),
  xml:SufficiencyXMLProcessingSchema.optional(),
  modelStatus:z.enum(['not_requested','disabled','unavailable','blocked','needs_input','proposed']).nullable(),
});
export const IngestionSufficiencyDecisionSchema=z.strictObject({version:z.literal(SUFFICIENCY_VERSION),id,pins:SufficiencyPinsSchema,
  recordPins:z.array(SufficiencyRecordPinSchema).max(192),
  processing:SufficiencyProcessingSchema.nullable(),
  ...DataSufficiencyRequirementsShape,outcome:z.enum(['complete','fill_display','ask','park','reject_for_3d']),
  availability:z.enum(['available','needs_input','unavailable','stale']),evidence:z.array(SufficiencyEvidenceSchema).min(1).max(64),
  unlocks:z.array(CoreIdSchema).max(5),questionId:id.nullable(),
  nextAction:z.enum(['none','neutral_presentation','review_mapping','review_evidence','provide_evidence','process_source','park','inspect_original','wait_for_extraction','retry_extraction','run_ocr','configure_provider','review_conversion','configure_reader','select_native_member']),
  reason:coreText(512),createdAt:z.iso.datetime()}).superRefine((value,ctx)=>{
    if(!exactSufficiencyRequirements(value) || (value.outcome==='complete' && value.missing.length!==0) ||
      (value.outcome==='ask' && !value.questionId) || value.evidence.length!==value.requirements.length ||
      value.evidence.some(e=>!value.requirements.includes(e.requirement)) ||
      new Set(value.evidence.map(e=>e.requirement)).size!==value.requirements.length ||
      value.evidence.some(e=>(e.state!=='satisfied')!==value.missing.includes(e.requirement)))
      ctx.addIssue({code:'custom',message:'Decisions must preserve exact task requirements and missing evidence'});
  });
export const EvaluateSufficiencySchema=z.strictObject({requestKey:id,expectedCaseRevision:rev,
  expectedSourceRevision:z.number().int().positive(),sourceSha256:hash,
  tasks:z.array(CoreIdSchema).min(1).max(5).refine(items=>new Set(items).size===items.length,'Use distinct tasks')});
export const SufficiencyAnswerSchema=z.strictObject({requestKey:id,expectedQuestionRevision:z.number().int().positive(),
  pins:SufficiencyPinsSchema,answer:z.discriminatedUnion('choice',[
    z.strictObject({choice:z.literal('not_sure')}),
    z.strictObject({choice:z.literal('provide_existing_evidence'),reference:SufficiencyReferenceSchema}),
  ])});
export const SufficiencyResultSchema=z.strictObject({version:z.literal(SUFFICIENCY_VERSION),
  decisions:z.array(IngestionSufficiencyDecisionSchema).min(1).max(5),questions:z.array(SufficiencyQuestionSchema).max(5)});
export const NeedsInputSchema=z.strictObject({version:z.literal(SUFFICIENCY_VERSION),caseId:id,caseRevision:rev,
  decisions:z.array(IngestionSufficiencyDecisionSchema).max(25),questions:z.array(SufficiencyQuestionSchema).max(5),
  staleQuestions:z.array(SufficiencyQuestionSchema).max(5),hasMore:z.boolean()});
export type SufficiencyPins=z.infer<typeof SufficiencyPinsSchema>;
export type SufficiencyEvidence=z.infer<typeof SufficiencyEvidenceSchema>;
export type SufficiencyQuestion=z.infer<typeof SufficiencyQuestionSchema>;
export type SufficiencyReference=z.infer<typeof SufficiencyReferenceSchema>;
export type IngestionSufficiencyDecision=z.infer<typeof IngestionSufficiencyDecisionSchema>;
