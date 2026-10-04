import type {DocumentResult} from '@ulpin/contracts/usp';
import {SourceFusionSurveySelectionSchema,SourceFusionSurveySchema,type SourceFusionSurveySelection,type SourceFusionSurvey}
  from '../../../../../contracts/src/source-fusion-survey';
import {SOURCE_FUSION_LIMITS} from '../../../../../contracts/src/source-fusion';
import {AppError} from '../../../infrastructure/errors';
import {fingerprint} from '../../cases/domain';
import {surveyReportProjection} from './survey-report-parser';

/** Parse the whole bounded accepted report before selecting rows. The caller
 * reaches this projection through fusion's exact bounded result reader. */
export function fusionSurveySourceProjection(raw:SourceFusionSurveySelection,result:DocumentResult):SourceFusionSurvey{
  const selection=SourceFusionSurveySelectionSchema.parse(raw),pin=selection.pin,input=result.input;
  if(input.caseId!==pin.caseId||input.caseRevision!==pin.caseRevision||input.sourceId!==pin.sourceId||
    input.sourceRevision!==pin.sourceRevision||input.sourceSha256!==pin.sourceSha256||input.jobId!==pin.jobId||
    input.readerSha256!==pin.readerSha256||result.native.readerSha256!==pin.readerSha256||fingerprint(input)!==pin.inputSha256)
    throw new AppError(422,'SOURCE_FUSION_INTEGRITY','The accepted survey document differs from its exact source/input pins.');
  const document={caseId:pin.caseId,caseRevision:pin.caseRevision,sourceId:pin.sourceId,sourceRevision:pin.sourceRevision,
    sourceSha256:pin.sourceSha256,jobId:pin.jobId,resultSha256:pin.resultSha256};
  const context=surveyReportProjection({document},result);
  const ordinals=[...selection.rowOrdinals].sort((a,b)=>a-b);
  if(new Set(ordinals).size!==ordinals.length)
    throw new AppError(422,'SOURCE_FUSION_SURVEY_SELECTION','Select each original report row ordinal once.');
  for(const ordinal of ordinals)if(context.table.rows.filter(row=>row.ordinal===ordinal).length!==1)
    throw new AppError(422,'SOURCE_FUSION_SURVEY_SELECTION',
      'A selected ordinal is missing, unparsed or ambiguous. Inspect the full survey-report context and recover its accepted extraction.');
  const namespace=`source:${pin.caseId}/${pin.sourceId}@${pin.sourceRevision}`;
  const rows=context.table.rows.filter(row=>ordinals.includes(row.ordinal)).map(row=>({
    key:`${namespace}/survey-report/${pin.jobId}/${pin.resultSha256}/row/${row.ordinal}`,
    rowSha256:fingerprint({version:'source-fusion-survey-row/1',pin,row}),row}));
  // Retain only parts cited by selected rows or separate report metadata. Whole
  // unselected row text must not leak through the parser's full parts inventory.
  const cited=new Set<string>();
  const cite=(quote:{citation:{partId:string}}|null)=>{if(quote)cited.add(quote.citation.partId);};
  for(const quote of Object.values(context.report))cite(quote);
  cite(context.table.header);cite(context.table.end);
  for(const quote of [...context.publishedSummary.quotes,...context.statements])cite(quote);
  for(const stat of context.publishedStatistics){cite(stat.header);cite(stat.quote);for(const value of stat.values)cite(value);}
  for(const {row} of rows){cite(row.quote);if(row.statusCitation)cited.add(row.statusCitation.partId);for(const field of row.fields)cite(field);}
  const {rows:allRows,unparsedRows,...table}=context.table;
  const projected=SourceFusionSurveySchema.parse({kind:'survey_report',pin,namespace,sourceSetRole:'operator_selected_fragment',
    binding:'context_only',nativeIdentifierScope:'source_native_only; not_canonical_registry_ids',capability:'selected_survey_rows',
    state:context.state,profile:context.profile,characterOffsets:context.characterOffsets,
    selectionSha256:fingerprint({version:'source-fusion-survey-selection/1',pin,rowOrdinals:ordinals}),
    selectionHashBasis:'accepted_source_result_input_reader_fence_and_sorted_row_ordinals',rowHashBasis:'accepted_pin_and_exact_typed_row',
    report:context.report,table:{...table,unparsedRowCount:unparsedRows.length},rows,
    coverage:{requestedRows:ordinals.length,selectedRows:rows.length,selectedEnabledRows:rows.filter(entry=>entry.row.enabled).length,
      selectedDisabledRows:rows.filter(entry=>!entry.row.enabled).length,unselectedParsedRows:allRows.length-rows.length,
      scope:'explicit_row_ordinals_and_cited_report_metadata',wholeTable:'inspected_for_completeness',unselectedRows:'not_expanded',
      unparsedRows:'not_expanded; inspect_full_survey_report_context'},
    publishedSummary:context.publishedSummary,publishedStatistics:context.publishedStatistics,statements:context.statements,
    gaps:context.gaps.map(gap=>gap.code==='table_rows_incomplete'?{...gap,
      action:'Recover complete privacy-preserving accepted row fields. Inspect the full survey-report context for exact unparsed lines; missing or masked values cannot be reconstructed here.'}:gap),
    qualification:context.qualification,parts:context.parts.filter(part=>cited.has(part.id)),warnings:context.warnings});
  if(Buffer.byteLength(JSON.stringify(projected))>SOURCE_FUSION_LIMITS.responseBytes-8192)
    throw new AppError(413,'SOURCE_FUSION_RESPONSE_LIMIT','Select fewer or smaller survey rows.');
  return projected;
}
