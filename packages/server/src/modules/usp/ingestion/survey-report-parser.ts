import {SURVEY_REPORT_VERSION,SURVEY_REPORT_FIELDS,SURVEY_REPORT_LIMITS,SurveyReportContextSchema,
  type SurveyReportRequest,type SurveyReportContext} from '../../../../../contracts/src/survey-report';
import type {DocumentResult,DocumentPart} from '@ulpin/contracts/usp';
import {AppError} from '../../../infrastructure/errors';

type Line={part:DocumentPart;text:string};
type Quote=SurveyReportContext['report']['title'];
const unsupported=(message:string):never=>{throw new AppError(422,'SURVEY_REPORT_LAYOUT',message);};
const redacted=(text:string)=>/\[redacted[^\]]*\]/i.test(text);
const numeric=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const banner=(text:string,name:string)=>text.trim().replace(/^-+\s*|\s*-+$/g,'')===name;

/** A deliberately narrow native TEXT profile. No coordinate/residual arithmetic. */
export function surveyReportProjection(request:SurveyReportRequest,result:DocumentResult):SurveyReportContext{
  if(result.native.format!=='text'||result.native.status!=='extracted'||result.input.mode!=='native_only'||
    result.input.ocrSelection||result.input.archiveSelection||result.ocr)
    unsupported('Select an accepted native-only TEXT report; OCR, archives and other layouts are unsupported.');
  if(result.native.parts.reduce((n,p)=>n+Buffer.byteLength(p.text),0)>SURVEY_REPORT_LIMITS.textBytes)
    throw new AppError(413,'SURVEY_REPORT_TEXT_LIMIT','The report exceeds the bounded text profile; no table was truncated.');
  const lines:Line[]=[];let priorLine=0;
  for(const part of result.native.parts){
    const loc=part.locator;
    if(!loc.line||loc.line<=priorLine||loc.page!==undefined||loc.paragraph!==undefined||loc.row!==undefined||
      loc.characterStart!==0||loc.characterEnd!==part.text.length||(loc.lineEnd!==undefined&&loc.lineEnd!==loc.line)||
      (loc.segmentCount!==undefined&&loc.segmentCount!==1)||/[\r\n\u0085\u2028\u2029]/u.test(part.text))
      unsupported('This profile needs one complete ordered native TEXT part per source line. No lines were combined or discarded.');
    priorLine=loc.line!;lines.push({part,text:part.text});
  }
  const used=new Set<string>();
  const quote=(line:Line,start=0,end=line.text.length):Quote=>{
    used.add(line.part.id);return {literal:line.text.slice(start,end),citation:{partId:line.part.id,
      line:line.part.locator.line!,characterStart:start,characterEnd:end}};
  };
  const matches=(predicate:(text:string)=>boolean)=>lines.filter(line=>predicate(line.text));
  const single=(predicate:(text:string)=>boolean,label:string):Line|undefined=>{
    const found=matches(predicate);if(found.length>1)unsupported(`Ambiguous repeated ${label}; select a single report.`);return found[0];
  };
  const title=single(t=>t.trim()==='Control Point Report(LP360, GeoCue Group, Inc.)','report title');
  const version=single(t=>t.startsWith('LP360 Version:'),'LP360 version');
  if(!title||!version||!/^LP360 Version:\s*\d+\.\d+\.\d+\.\d+\s*$/.test(version.text)||
    title.part.locator.line!==1||version.part.locator.line!<=title.part.locator.line!)
    unsupported('A literal LP360 report title and four-component version header are required.');
  const gaps:SurveyReportContext['gaps']=[
    {code:'working_crs_required',action:'Supply the working horizontal CRS for these exact report coordinates; unit labels and final-product references do not establish it.'},
    {code:'vertical_linkage_required',action:'Supply the report height reference and its linkage to the compared product; retain Control Z and Surface Z separately.'},
    {code:'survey_epoch_required',action:'Supply the survey/measurement date or epoch from source evidence; Generated Time is only report-generation time.'},
    {code:'object_correspondence_required',action:'Supply source-backed point-to-object correspondence before any scoped comparison.'},
  ];
  const gap=(code:string,action:string)=>{if(!gaps.some(g=>g.code===code))gaps.push({code,action});};
  const metadata=(label:string)=>{
    const line=single(t=>t.startsWith(label+':'),label);
    if(!line||redacted(line.text)||!line.text.slice(label.length+1).trim()){
      gap('report_metadata_incomplete','Recover missing or redacted report metadata through the canonical source reader.');return line?quote(line):null;
    }
    return quote(line);
  };
  const horizontalUnits=metadata('Horizontal Units'),verticalUnits=metadata('Vertical Units');
  const generatedTime=metadata('Generated Time'),surfaceMethod=metadata('Surface Method');
  const section=single(t=>banner(t,'Control Points'),'Control Points section');
  const end=single(t=>banner(t,'End Control Points'),'table terminator');
  const expectedHeader=SURVEY_REPORT_FIELDS.map(f=>f[0]).join(' ');
  const header=single(t=>t.trim().replace(/\s+/g,' ')===expectedHeader,'table header');
  if(!header&&matches(t=>/^\s*Name\s+Description\s+Type\b/.test(t)).length)
    unsupported('The apparent table header differs from the supported literal 19-field vocabulary.');
  if(section&&version!.part.locator.line!>=section.part.locator.line!)unsupported('The report version must precede Control Points.');
  if(header&&section&&section.part.locator.line!>=header.part.locator.line!)
    unsupported('The table must follow its explicit Control Points section.');
  if(end&&header&&end.part.locator.line!<=header.part.locator.line!)unsupported('The table terminator precedes its header.');
  let complete=true;
  const incomplete=(code:string,action:string)=>{complete=false;gap(code,action);};
  if(!section)incomplete('table_section_missing','Recover the explicit Control Points section marker from the accepted extraction.');
  if(!header)incomplete('table_header_missing','Recover the full native table header before interpreting rows.');
  if(!end)incomplete('table_end_missing','Recover the End Control Points terminator; the table cannot be declared complete.');
  if(end&&lines.some(line=>line.part.locator.line!>end.part.locator.line!&&line.text.trim()))
    unsupported('Unexpected content follows End Control Points; this layout is unsupported.');
  const publishedSummary:SurveyReportContext['publishedSummary']={horizontalMeasured:null,verticalMeasured:null,withheld:null,total:null,quotes:[]};
  const statements:SurveyReportContext['statements']=[];
  const summaryPatterns=[
    ['horizontalMeasured',/^#CPs Measured\( Horizontal \):\s*(\d+)\s*$/],
    ['verticalMeasured',/^#CPs Measured\( Vertical \):\s*(\d+)\s*$/],
  ] as const;
  const beforeTable=(line:Line)=>line.part.locator.line!<(section?.part.locator.line??header?.part.locator.line??Infinity);
  for(const [key,pattern] of summaryPatterns){
    const label=key==='horizontalMeasured'?'#CPs Measured( Horizontal )':'#CPs Measured( Vertical )';
    const line=single(t=>t.startsWith(label),label),match=line&&beforeTable(line)&&pattern.exec(line.text);
    if(match&&Number.isSafeInteger(Number(match[1])))publishedSummary[key]=Number(match[1]);
    else incomplete('report_summary_incomplete','Recover the full published summary counts; they are required for whole-table checks.');
    if(line)publishedSummary.quotes.push(quote(line));
  }
  const withholding=single(t=>t.startsWith('#CPs Withheld:'),'withholding summary');
  const wm=withholding&&beforeTable(withholding)&&/^#CPs Withheld:\s*(\d+) of (\d+)\s*$/.exec(withholding.text);
  if(wm&&Number.isSafeInteger(Number(wm[1]))&&Number.isSafeInteger(Number(wm[2]))){
    publishedSummary.withheld=Number(wm[1]);publishedSummary.total=Number(wm[2]);
    if(publishedSummary.withheld>publishedSummary.total)incomplete('summary_counts_conflict','The published withholding count exceeds its total; resolve the source conflict.');
  }else incomplete('report_summary_incomplete','Recover the full literal withholding and total counts.');
  if(withholding){publishedSummary.quotes.push(quote(withholding));statements.push({...quote(withholding),kind:'withholding'});}
  if(publishedSummary.total!==null&&publishedSummary.total>SURVEY_REPORT_LIMITS.rows)
    throw new AppError(413,'SURVEY_REPORT_ROW_LIMIT','The declared table exceeds 200 rows; no rows were truncated.');
  for(const line of lines.filter(beforeTable))if(/^(ASPRS |Equivalent Class )/.test(line.text))publishedSummary.quotes.push(quote(line));
  const literal=(line:Line,token:{literal:string;start:number},asText=false,table=false)=>{
    const citation=quote(line,token.start,token.start+token.literal.length).citation;
    if(token.literal.length>128)return null;
    if(!asText&&/^-{4,8}$/.test(token.literal)&&(!table||token.literal==='-----'))
      return {literal:token.literal,state:'unavailable' as const,value:null,citation};
    if(!asText&&(!numeric.test(token.literal)||!Number.isFinite(Number(token.literal))))return null;
    return {literal:token.literal,state:'stated' as const,value:asText?token.literal:Number(token.literal),citation};
  };
  const tokens=(line:Line)=>[...line.text.matchAll(/\S+/g)].map(m=>({literal:m[0],start:m.index!}));
  const rows:SurveyReportContext['table']['rows']=[],unparsedRows:Quote[]=[];
  const bodyStart=header?.part.locator.line??section?.part.locator.line;
  const body=bodyStart===undefined?[]:lines.filter(line=>line.part.locator.line!>bodyStart&&line.part.locator.line!<(end?.part.locator.line??Infinity));
  if(body.length>SURVEY_REPORT_LIMITS.rows)throw new AppError(413,'SURVEY_REPORT_ROW_LIMIT','The observed table exceeds 200 lines; no rows were discarded.');
  for(const line of body){
    if(!header){unparsedRows.push(quote(line));continue;}
    const all=tokens(line),off=all[0]?.literal==='Turned'&&all[1]?.literal==='Off',values=all.slice(off?2:0);
    if(redacted(line.text)||values.length!==19||values.some(v=>v.literal.length>128)||
      !/^\d+$/.test(values[0].literal)||!Number.isSafeInteger(Number(values[0].literal))){
      unparsedRows.push(quote(line));incomplete('table_rows_incomplete','Provide a complete, privacy-preserving accepted extraction for these lines. Masked or missing values cannot be reconstructed here; exact lines remain in unparsedRows.');continue;
    }
    if(!['nva','pid'].includes(values[2].literal))unsupported('Only literal nva/pid point types in the 19-field table are supported.');
    const fields=values.map((token,i)=>{
      const value=literal(line,token,i===1||i===2||i===13,true);
      return value?{...value,field:SURVEY_REPORT_FIELDS[i][0],role:SURVEY_REPORT_FIELDS[i][1],unitAxis:SURVEY_REPORT_FIELDS[i][2]}:null;
    });
    if(fields.some(f=>f===null)||values[1].literal.length>128||values[13].literal.length>128){
      unparsedRows.push(quote(line));incomplete('table_rows_incomplete','Recover unsupported or incomplete literal row fields.');continue;
    }
    rows.push({ordinal:Number(values[0].literal),pointIdentifier:values[1].literal,pointType:values[2].literal as 'nva'|'pid',
      enabled:!off,statusLiteral:off?'Turned Off':null,statusCitation:off?quote(line,all[0].start,all[1].start+all[1].literal.length).citation:null,
      quote:quote(line),fields:fields as SurveyReportContext['table']['rows'][number]['fields']});
  }
  if(rows.some((r,i)=>r.ordinal!==i)||new Set(rows.map(r=>r.pointIdentifier)).size!==rows.length||
    (publishedSummary.total!==null&&rows.length!==publishedSummary.total))
    incomplete('table_population_incomplete','Resolve missing, duplicate or out-of-order ordinals/point IDs and the published total; no missing rows are invented.');
  const enabled=rows.filter(r=>r.enabled);
  const horizontal=enabled.filter(r=>r.fields[10].state==='stated'&&r.fields[11].state==='stated').length;
  const vertical=enabled.filter(r=>r.fields[12].state==='stated').length;
  if(unparsedRows.length||rows.length!==publishedSummary.total)
    incomplete('measured_population_unverified','Recover the complete typed population before checking published measured counts.');
  else if((publishedSummary.horizontalMeasured!==null&&publishedSummary.horizontalMeasured!==horizontal)||
    (publishedSummary.verticalMeasured!==null&&publishedSummary.verticalMeasured!==vertical))
    incomplete('measured_population_conflict','Resolve published measured counts against enabled rows with stated product coordinates.');
  if(rows.some(r=>r.fields[10].state==='unavailable'||r.fields[11].state==='unavailable'))
    gap('horizontal_product_values_unavailable','Preserve unavailable horizontal product coordinates; obtain source-backed values before horizontal comparison.');
  if(rows.some(r=>!r.enabled))gap('source_excluded_rows_present','Keep Turned Off rows visible; establish any eligible comparison population from source evidence.');

  const publishedStatistics:SurveyReportContext['publishedStatistics']=[];
  let active:SurveyReportContext['publishedStatistics'][number]['section']|null=null,disclaimer=false,activeHeader:Quote|null=null;
  const seenSections=new Set<string>(),seenLabels=new Set<string>();
  for(const line of lines.filter(beforeTable)){
    if(banner(line.text,'Report Disclaimer')){disclaimer=true;continue;}
    const name=(['First Component Error','Second Component Error','Product Accuracy'] as const).find(n=>banner(line.text,n));
    if(name){
      if(seenSections.has(name))unsupported('Ambiguous repeated published statistic section.');
      seenSections.add(name);active=name;activeHeader=null;disclaimer=false;statements.push({...quote(line),kind:'source_role'});continue;
    }
    if(/^\s*-{3}/.test(line.text)&&!/^\s*-+X\s+Y\s+Z\s+R\(XY\)\s+3D\(XYZ\)\s*$/.test(line.text)){
      active=null;disclaimer=false;continue;
    }
    if(disclaimer)statements.push({...quote(line),kind:'disclaimer'});
    if(!active)continue;
    if(/^\s*-+X\s+Y\s+Z\s+R\(XY\)\s+3D\(XYZ\)\s*$/.test(line.text)){
      if(activeHeader)unsupported('Ambiguous repeated published statistic axis header.');activeHeader=quote(line);continue;
    }
    const ts=tokens(line),label=ts[0]?.literal==='#CPs'?`${ts[0].literal} ${ts[1]?.literal}`:ts[0]?.literal;
    if(!activeHeader||!['RMSE','Max','Min','Mean','Median','StdDev','#CPs Used'].includes(label??'')){
      incomplete('published_statistics_incomplete','Recover unsupported or redacted published statistic lines.');quote(line);continue;
    }
    const key=active+':'+label;if(seenLabels.has(key))unsupported('Ambiguous repeated published statistic label.');seenLabels.add(key);
    if(active==='Product Accuracy'&&label!=='RMSE')unsupported('The supported Product Accuracy section contains only the literal RMSE row.');
    const vals=ts.slice(label==='#CPs Used'?2:1).map(t=>literal(line,t));
    if(vals.length!==5||vals.some(v=>v===null)){
      incomplete('published_statistics_incomplete','Recover all five literal published statistic fields.');quote(line);continue;
    }
    publishedStatistics.push({section:active,label:label as SurveyReportContext['publishedStatistics'][number]['label'],
      axes:['X','Y','Z','R(XY)','3D(XYZ)'],values:vals as SurveyReportContext['publishedStatistics'][number]['values'],header:activeHeader,quote:quote(line)});
  }
  if(publishedStatistics.length!==15)incomplete('published_statistics_incomplete','Recover complete First/Second Component Error and Product Accuracy sections.');
  if(result.native.code!==null||result.native.warnings.length)
    incomplete('native_extraction_warning','Inspect accepted native extraction warnings and recover affected content before claiming completeness.');
  const titleQuote=quote(title!),versionQuote=quote(version!),headerQuote=header?quote(header):null,endQuote=end?quote(end):null;
  if(used.size>512||statements.length>40||publishedSummary.quotes.length>16)
    throw new AppError(413,'SURVEY_REPORT_CITATION_LIMIT','The report exceeds the bounded citation profile; no cited lines were discarded.');
  return SurveyReportContextSchema.parse({version:SURVEY_REPORT_VERSION,state:'needs_input',document:request.document,
    profile:'lp360-control-point-table19/1',characterOffsets:'part-local-utf16-end-exclusive',
    report:{title:titleQuote,lp360Version:versionQuote,generatedTime,surfaceMethod,horizontalUnits,verticalUnits},
    table:{status:complete?'complete':'incomplete',header:headerQuote,end:endQuote,
      declaredTotal:publishedSummary.total,observedRows:body.length,parsedRows:rows.length,
      parsedEnabledRows:enabled.length,parsedDisabledRows:rows.length-enabled.length,unparsedRows,rows},
    publishedSummary,publishedStatistics,statements,gaps,
    qualification:{coordinateFrame:'needs_input',heightLinkage:'needs_input',surveyEpoch:'needs_input',objectCorrespondence:'needs_input',
      comparison:'not_assessed',accuracy:'not_assessed',learningSplit:'not_assessed'},
    parts:result.native.parts.filter(p=>used.has(p.id)),warnings:result.native.warnings});
}
