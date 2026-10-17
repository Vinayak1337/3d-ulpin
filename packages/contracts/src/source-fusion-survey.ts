import {z} from 'zod';
import {SourceFusionPinSchema} from './source-fusion-common';
import {SurveyReportContextSchema,SurveyReportRowSchema} from './survey-report';

/** Name is the original report ordinal, never an application object ID. */
export const SourceFusionSurveySelectionSchema=z.strictObject({kind:z.literal('survey_report'),pin:SourceFusionPinSchema,
  rowOrdinals:z.array(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)).min(1).max(25)});
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const count=z.number().int().nonnegative().max(200);
export const SourceFusionSurveySchema=z.strictObject({kind:z.literal('survey_report'),pin:SourceFusionPinSchema,
  namespace:z.string(),sourceSetRole:z.literal('operator_selected_fragment'),binding:z.literal('context_only'),
  nativeIdentifierScope:z.literal('source_native_only; not_canonical_registry_ids'),
  capability:z.literal('selected_survey_rows'),state:SurveyReportContextSchema.shape.state,
  profile:SurveyReportContextSchema.shape.profile,characterOffsets:SurveyReportContextSchema.shape.characterOffsets,
  selectionSha256:hash,selectionHashBasis:z.literal('accepted_source_result_input_reader_fence_and_sorted_row_ordinals'),
  rowHashBasis:z.literal('accepted_pin_and_exact_typed_row'),
  report:SurveyReportContextSchema.shape.report,
  table:SurveyReportContextSchema.shape.table.omit({rows:true,unparsedRows:true}).extend({unparsedRowCount:count}),
  rows:z.array(z.strictObject({key:z.string().min(1).max(1024),rowSha256:hash,row:SurveyReportRowSchema})).min(1).max(25),
  coverage:z.strictObject({requestedRows:count,selectedRows:count,selectedEnabledRows:count,selectedDisabledRows:count,
    unselectedParsedRows:count,scope:z.literal('explicit_row_ordinals_and_cited_report_metadata'),
    wholeTable:z.literal('inspected_for_completeness'),unselectedRows:z.literal('not_expanded'),
    unparsedRows:z.literal('not_expanded; inspect_full_survey_report_context')}),
  publishedSummary:SurveyReportContextSchema.shape.publishedSummary,publishedStatistics:SurveyReportContextSchema.shape.publishedStatistics,
  statements:SurveyReportContextSchema.shape.statements,gaps:SurveyReportContextSchema.shape.gaps,
  qualification:SurveyReportContextSchema.shape.qualification,parts:SurveyReportContextSchema.shape.parts,
  warnings:SurveyReportContextSchema.shape.warnings,
});
export type SourceFusionSurveySelection=z.infer<typeof SourceFusionSurveySelectionSchema>;
export type SourceFusionSurvey=z.infer<typeof SourceFusionSurveySchema>;
