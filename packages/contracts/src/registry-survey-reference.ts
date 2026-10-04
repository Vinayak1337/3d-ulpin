import {z} from 'zod';
import {DocumentLocatorSchema} from './usp/document-ingestion';
import {SourceFusionSurveySchema} from './source-fusion-survey';
import {SurveyReportRowSchema} from './survey-report';

/** A disclosed singleton read fragment. The original combined context hash
 * is checked separately by the canonical amendment resolver, without conversion. */
export const RegistrySurveyFragmentSchema=SourceFusionSurveySchema.extend({rows:SourceFusionSurveySchema.shape.rows.length(1)})
  .superRefine((value,ctx)=>{if(value.coverage.selectedRows!==1||value.coverage.requestedRows!==1)
    ctx.addIssue({code:'custom',message:'A reference discloses exactly its selected survey row.'});});
const hash=z.string().regex(/^[a-f0-9]{64}$/);
/** Extended with the existing source/target/selection citation envelope. No
 * point-to-object correspondence or qualified control is recorded here. */
export const RegistrySurveyReferenceFieldsSchema=z.strictObject({resultBytes:z.number().int().positive().max(4*1024*1024),
  survey:z.strictObject({purpose:z.literal('source_reference_only'),profile:SourceFusionSurveySchema.shape.profile,
    key:z.string().min(1).max(1024),rowSha256:hash,fragmentSha256:hash,row:SurveyReportRowSchema,
    partSha256:hash,locator:DocumentLocatorSchema,
    horizontalUnits:SourceFusionSurveySchema.shape.report.shape.horizontalUnits,
    verticalUnits:SourceFusionSurveySchema.shape.report.shape.verticalUnits,
    tableStatus:SourceFusionSurveySchema.shape.table.shape.status,
    qualification:SourceFusionSurveySchema.shape.qualification,warnings:SourceFusionSurveySchema.shape.warnings}),
});
