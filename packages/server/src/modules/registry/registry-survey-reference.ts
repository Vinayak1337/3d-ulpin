import type {RegistrySurveyCitation} from '../../../../contracts/src/registry-document-evidence';
import {RegistrySurveyFragmentSchema} from '../../../../contracts/src/registry-survey-reference';
import type {SourceFusionSurvey,SourceFusionSurveySelection} from '../../../../contracts/src/source-fusion-survey';
import {fingerprint} from '../cases/domain';
import {conflict} from '../../infrastructure/errors';
import {fusionCitationDocumentPin} from '../usp/ingestion/source-fusion-citations';

export function surveyCitationFusionSelection(pin:RegistrySurveyCitation):SourceFusionSurveySelection{
  return {kind:'survey_report',pin:{...pin.document,inputSha256:pin.inputSha256,readerSha256:pin.readerSha256,
    acceptedFence:pin.acceptedFence,resultBytes:pin.resultBytes},rowOrdinals:[pin.survey.row.ordinal]};
}
/** Scope a read fragment to one row; never replace or normalize the incoming
 * combined context or its hash. Report completeness and qualifications remain. */
export function surveyCitationFragment(source:SourceFusionSurvey,ordinal:number){
  const entry=source.rows.find(item=>item.row.ordinal===ordinal);
  if(!entry)conflict('The exact selected survey reference row is unavailable.');
  const cited=new Set<string>();
  const cite=(quote:{citation:{partId:string}}|null)=>{if(quote)cited.add(quote.citation.partId);};
  for(const quote of Object.values(source.report))cite(quote);
  cite(source.table.header);cite(source.table.end);
  for(const quote of [...source.publishedSummary.quotes,...source.statements])cite(quote);
  for(const stat of source.publishedStatistics){cite(stat.header);cite(stat.quote);for(const value of stat.values)cite(value);}
  cite(entry.row.quote);if(entry.row.statusCitation)cited.add(entry.row.statusCitation.partId);
  for(const field of entry.row.fields)cite(field);
  return RegistrySurveyFragmentSchema.parse({...source,rows:[entry],
    selectionSha256:fingerprint({version:'source-fusion-survey-selection/1',pin:source.pin,rowOrdinals:[ordinal]}),
    coverage:{...source.coverage,requestedRows:1,selectedRows:1,selectedEnabledRows:entry.row.enabled?1:0,
      selectedDisabledRows:entry.row.enabled?0:1,unselectedParsedRows:source.table.parsedRows-1},
    parts:source.parts.filter(part=>cited.has(part.id))});
}
export function surveyCitationFields(source:SourceFusionSurvey,ordinal:number){
  const fragment=surveyCitationFragment(source,ordinal),entry=fragment.rows[0],part=fragment.parts.find(p=>p.id===entry.row.quote.citation.partId);
  if(!part)conflict('The exact survey row part is unavailable.');
  return {document:fusionCitationDocumentPin(source.pin),inputSha256:source.pin.inputSha256,readerSha256:source.pin.readerSha256,
    acceptedFence:source.pin.acceptedFence,resultBytes:source.pin.resultBytes,
    survey:{purpose:'source_reference_only' as const,profile:source.profile,key:entry.key,rowSha256:entry.rowSha256,
      fragmentSha256:fingerprint(fragment),row:entry.row,partSha256:part.sha256,locator:part.locator,
      horizontalUnits:source.report.horizontalUnits,verticalUnits:source.report.verticalUnits,
      tableStatus:source.table.status,qualification:source.qualification,warnings:source.warnings}};
}
export function surveyCitationId(pin:RegistrySurveyCitation){
  return fingerprint({version:pin.version,document:pin.document,inputSha256:pin.inputSha256,readerSha256:pin.readerSha256,
    acceptedFence:pin.acceptedFence,resultBytes:pin.resultBytes,survey:pin.survey,target:pin.target});
}
