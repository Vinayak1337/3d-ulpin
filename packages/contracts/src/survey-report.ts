import {z} from 'zod';
import {DocumentAssociationSourceSchema} from './document-association';
import {DocumentPartSchema} from './usp/document-ingestion';

export const SURVEY_REPORT_VERSION='survey-report-context/1' as const;
export const SURVEY_REPORT_LIMITS=Object.freeze({rows:200,textBytes:128*1024,responseBytes:1024*1024,
  requestBytes:4096,deadlineMs:15000});
/** Original LP360 vocabulary; these roles do not establish a coordinate frame. */
export const SURVEY_REPORT_FIELDS=[
  ['Name','identity','none'],['Description','identity','none'],['Type','identity','none'],
  ['Control X','survey_control','horizontal'],['Control Y','survey_control','horizontal'],['Control Z','survey_control','vertical'],
  ['H Offset','source_offset','horizontal'],['Accuracy X','published_control_error','horizontal'],
  ['Accuracy Y','published_control_error','horizontal'],['Accuracy Z','published_control_error','vertical'],
  ['Measured X','product_coordinate','horizontal'],['Measured Y','product_coordinate','horizontal'],['Surface Z','product_coordinate','vertical'],
  ['Z Location','source_location','none'],['Delta X','published_residual','horizontal'],['Delta Y','published_residual','horizontal'],
  ['Delta XY','published_residual','horizontal'],['Delta Z','published_residual','vertical'],['Delta XYZ','published_residual','combined'],
] as const;
const offset=z.number().int().nonnegative();
export const SurveyReportCitationSchema=z.strictObject({partId:z.uuid(),line:z.number().int().positive(),
  characterStart:offset,characterEnd:offset}).refine(v=>v.characterEnd>v.characterStart,'A citation must be nonempty.');
export const SurveyReportQuoteSchema=z.strictObject({literal:z.string().min(1).max(4096),citation:SurveyReportCitationSchema});
export const SurveyReportLiteralSchema=z.strictObject({literal:z.string().min(1).max(128),
  state:z.enum(['stated','unavailable']),value:z.union([z.number().finite(),z.string().min(1).max(128),z.null()]),
  citation:SurveyReportCitationSchema}).refine(v=>(v.state==='unavailable')===(v.value===null),
    'Unavailable and stated values remain distinct.');
const field=z.enum(SURVEY_REPORT_FIELDS.map(v=>v[0]));
export const SurveyReportRowSchema=z.strictObject({ordinal:offset,pointIdentifier:z.string().min(1).max(128),
  pointType:z.enum(['nva','pid']),enabled:z.boolean(),statusLiteral:z.enum(['Turned Off']).nullable(),
  statusCitation:SurveyReportCitationSchema.nullable(),quote:SurveyReportQuoteSchema,
  fields:z.array(SurveyReportLiteralSchema.extend({field,role:z.enum(['identity','survey_control','source_offset',
    'published_control_error','product_coordinate','source_location','published_residual']),
    unitAxis:z.enum(['none','horizontal','vertical','combined'])})).length(19)})
  .superRefine((v,ctx)=>{
    if(v.fields.some((f,i)=>f.field!==SURVEY_REPORT_FIELDS[i][0]||f.role!==SURVEY_REPORT_FIELDS[i][1]||f.unitAxis!==SURVEY_REPORT_FIELDS[i][2])||
      v.fields[0].value!==v.ordinal||v.fields[1].value!==v.pointIdentifier||v.fields[2].value!==v.pointType||
      v.enabled!==(v.statusLiteral===null)||(v.statusLiteral===null)!==(v.statusCitation===null))
      ctx.addIssue({code:'custom',message:'Rows must retain their exact ordered source fields and exclusion state.'});
  });
export const SurveyReportRequestSchema=z.strictObject({document:DocumentAssociationSourceSchema});
export const SurveyReportContextSchema=z.strictObject({version:z.literal(SURVEY_REPORT_VERSION),
  state:z.literal('needs_input'),document:DocumentAssociationSourceSchema,
  profile:z.literal('lp360-control-point-table19/1'),characterOffsets:z.literal('part-local-utf16-end-exclusive'),
  report:z.strictObject({title:SurveyReportQuoteSchema,lp360Version:SurveyReportQuoteSchema,
    generatedTime:SurveyReportQuoteSchema.nullable(),surfaceMethod:SurveyReportQuoteSchema.nullable(),
    horizontalUnits:SurveyReportQuoteSchema.nullable(),verticalUnits:SurveyReportQuoteSchema.nullable()}),
  table:z.strictObject({status:z.enum(['complete','incomplete']),header:SurveyReportQuoteSchema.nullable(),
    end:SurveyReportQuoteSchema.nullable(),declaredTotal:offset.nullable(),observedRows:offset,
    parsedRows:offset,parsedEnabledRows:offset,parsedDisabledRows:offset,unparsedRows:z.array(SurveyReportQuoteSchema).max(200),
    rows:z.array(SurveyReportRowSchema).max(SURVEY_REPORT_LIMITS.rows)}),
  publishedSummary:z.strictObject({horizontalMeasured:offset.nullable(),verticalMeasured:offset.nullable(),
    withheld:offset.nullable(),total:offset.nullable(),quotes:z.array(SurveyReportQuoteSchema).max(16)}),
  publishedStatistics:z.array(z.strictObject({section:z.enum(['First Component Error','Second Component Error','Product Accuracy']),
    label:z.enum(['RMSE','Max','Min','Mean','Median','StdDev','#CPs Used']),
    axes:z.tuple([z.literal('X'),z.literal('Y'),z.literal('Z'),z.literal('R(XY)'),z.literal('3D(XYZ)')]),
    values:z.array(SurveyReportLiteralSchema).length(5),header:SurveyReportQuoteSchema,quote:SurveyReportQuoteSchema})).max(15),
  statements:z.array(SurveyReportQuoteSchema.extend({kind:z.enum(['disclaimer','source_role','withholding'])})).max(40),
  gaps:z.array(z.strictObject({code:z.string().min(1).max(80),action:z.string().min(1).max(512)})).max(32),
  qualification:z.strictObject({coordinateFrame:z.literal('needs_input'),heightLinkage:z.literal('needs_input'),
    surveyEpoch:z.literal('needs_input'),objectCorrespondence:z.literal('needs_input'),
    comparison:z.literal('not_assessed'),accuracy:z.literal('not_assessed'),learningSplit:z.literal('not_assessed')}),
  parts:z.array(DocumentPartSchema).max(512),warnings:z.array(z.string().max(512)).max(100),
});
export type SurveyReportRequest=z.infer<typeof SurveyReportRequestSchema>;
export type SurveyReportContext=z.infer<typeof SurveyReportContextSchema>;
