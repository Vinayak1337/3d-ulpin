import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {SURVEY_REPORT_LIMITS,SurveyReportRequestSchema,SurveyReportContextSchema,type SurveyReportContext} from '../packages/contracts/src/survey-report';
import {DocumentResultSchema,type DocumentInput,type DocumentResult} from '../packages/contracts/src/usp/document-ingestion';
import {AppError} from '../packages/server/src/infrastructure/errors';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {localOperatorSubject,localRequestContext} from '../packages/server/src/modules/usp/principal';
import {documentReaderSha,extractSourceDocument} from '../packages/server/src/modules/usp/ingestion/document-native';
import {documentResultKey} from '../packages/server/src/modules/usp/ingestion/documents';
import {surveyReportProjection} from '../packages/server/src/modules/usp/ingestion/survey-report-parser';
import {captureSurveyDocument,inspectSurveyReport,readSurveyDocument} from '../packages/server/src/modules/usp/ingestion/survey-report';

const root=process.env.ULPIN_SURVEY_FIXTURE_ROOT??'E:/BhuAayam-data/task-data/desktop-survey-control-source-20261003/originals';
const haveReports=['nva','pid'].every(kind=>existsSync(join(root,`20250722_capemay_${kind}_report.txt`)));
const realOptions={skip:haveReports?false:'Retained real reports unavailable; set ULPIN_SURVEY_FIXTURE_ROOT. No replacement original is generated.'};
const subject=localOperatorSubject();

/** Technical envelopes only: no job enrollment, SQL writes, external extraction,
 * provider/native execution, or claim that these results were actually accepted.
 * The injected TEXT callback mirrors area.py's UTF-8 line route; the real helper
 * still applies the current redactor, unit/part hashes and locator recipe. */
async function report(kind:'nva'|'pid'){
  const raw=await readFile(join(root,`20250722_capemay_${kind}_report.txt`)),digest=sha256(raw);
  const sourceId=randomUUID(),input:DocumentInput={version:'source-document/1',jobId:randomUUID(),caseId:randomUUID(),
    caseRevision:1,caseContextSha256:sha256('controlled-case'),sourceId,familyId:sourceId,sourceRevision:1,
    sourceSha256:digest,sourceBytes:raw.length,objectKey:'controlled-transport-only',subject,accessSha256:sha256('controlled-access'),
    policyVersion:'source-document-native/1',readerSha256:documentReaderSha(),gatewayPolicySha256:null,layoutCap:null,mode:'native_only'};
  const native=await extractSourceDocument(input,raw,async(value:any)=>{
    assert.equal(value.format,'text');const bytes=Buffer.from(value.base64,'base64');assert.deepEqual(bytes,raw);
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    return {sourceSha256:sha256(bytes),parts:text.split(/\r\n|\n|\r/).flatMap((text,index)=>text.trim()?
      [{text,locator:{label:`line ${index+1}`,line:index+1}}]:[])};
  });
  assert.equal(native.status,'extracted');assert.equal(native.format,'text');
  const result=DocumentResultSchema.parse({version:'source-document/1',input,native,
    model:{status:'not_requested',code:null,candidates:[],validationErrors:[],calls:[]},createdAt:'2026-10-04T00:00:00Z'});
  const bytes=Buffer.from(JSON.stringify(result));
  const request={document:{caseId:input.caseId,caseRevision:1,sourceId,sourceRevision:1,sourceSha256:digest,
    jobId:input.jobId,resultSha256:sha256(bytes)}};
  const capture={input,acceptedFence:1,resultRefSha256:fingerprint({assetId:`document:${input.jobId}`,version:1,sha256:request.document.resultSha256})};
  return {raw,input,result,bytes,request,capture};
}
function assertLocators(context:SurveyReportContext){
  const byId=new Map(context.parts.map(p=>[p.id,p]));let checked=0;
  const verify=(literal:string,cite:SurveyReportContext['report']['title']['citation'])=>{
    const part=byId.get(cite.partId);assert(part);assert.equal(part.locator.line,cite.line);
    assert.equal(part.text.slice(cite.characterStart,cite.characterEnd),literal);assert.equal(sha256(part.text),part.sha256);checked++;
  };
  for(const q of Object.values(context.report))if(q)verify(q.literal,q.citation);
  for(const q of [context.table.header,context.table.end,...context.table.unparsedRows,...context.publishedSummary.quotes,...context.statements])
    if(q)verify(q.literal,q.citation);
  for(const row of context.table.rows){verify(row.quote.literal,row.quote.citation);
    if(row.statusCitation)verify(row.statusLiteral!,row.statusCitation);
    for(const f of row.fields)verify(f.literal,f.citation);
  }
  for(const stat of context.publishedStatistics){verify(stat.header.literal,stat.header.citation);verify(stat.quote.literal,stat.quote.citation);for(const f of stat.values)verify(f.literal,f.citation);}
  return checked;
}
function alter(result:DocumentResult,line:number,text:string|null):DocumentResult{
  const parts=result.native.parts.flatMap(p=>p.locator.line!==line?[p]:text===null?[]:[{...p,text,sha256:sha256(text),
    locator:{...p.locator,characterEnd:text.length,unitSha256:sha256(text)}}]);
  return DocumentResultSchema.parse({...result,native:{...result.native,parts}});
}

test('real PID report flows through bounded document transport and final authority recapture with exact source citations',realOptions,async()=>{
  const fixture=await report('pid');let reads=0,captures=0;
  const ctx=localRequestContext(randomUUID());
  const context=await inspectSurveyReport(ctx,fixture.request,{
    source:async(_ctx,pin,budget,expected)=>{
      assert.deepEqual(pin,fixture.request.document);assert(budget.deadlineAt>Date.now());assert(!budget.signal.aborted);
      captures++;if(expected)assert.deepEqual(expected,fixture.capture);return fixture.capture;
    },
    result:async(request,capture,budget)=>readSurveyDocument(request,capture,budget,{
      head:async key=>{assert.equal(key,documentResultKey(fixture.input.jobId,request.document.resultSha256));return {bytes:fixture.bytes.length,etag:'controlled-etag'};},
      open:async(key,bytes,timeout,etag,signal)=>{
        reads++;assert.equal(key,documentResultKey(fixture.input.jobId,request.document.resultSha256));assert.equal(bytes,fixture.bytes.length);
        assert.equal(etag,'controlled-etag');assert(timeout>0&&timeout<=SURVEY_REPORT_LIMITS.deadlineMs);assert(signal);
        return {body:Readable.from([fixture.bytes]),etag:'controlled-etag'};
      },
    }),
  });
  assert(SurveyReportContextSchema.safeParse(context).success);assert.equal(reads,1);assert.equal(captures,2);
  assert.equal(context.table.status,'incomplete');assert.equal(context.table.observedRows,17);
  assert.equal(context.table.rows.length,11);assert.equal(context.table.unparsedRows.length,6);assert.equal(context.table.parsedDisabledRows,0);
  assert.equal(context.table.header!.citation.line,82);assert.equal(context.table.rows[0].quote.citation.line,83);
  assert.equal(context.table.unparsedRows.at(-1)!.citation.line,99);assert.equal(context.publishedSummary.withheld,0);
  assert.equal(context.table.rows[1].fields[14].literal,'-0.000');assert(Object.is(context.table.rows[1].fields[14].value,-0));
  assert.equal(context.report.horizontalUnits!.literal.trim(),'Horizontal Units:   meter');
  assert.equal(context.publishedStatistics.length,15);assert.equal(context.qualification.accuracy,'not_assessed');
  assert.equal(context.state,'needs_input');assert(context.gaps.some(g=>g.code==='table_rows_incomplete'));
  const locators=assertLocators(context);assert(Buffer.byteLength(JSON.stringify(context))<SURVEY_REPORT_LIMITS.responseBytes-4096);
  // Every original table line is unchanged even after the real redactor/helper.
  const originalLines=fixture.raw.toString('utf8').split(/\r\n|\n|\r/);
  for(const row of context.table.rows)assert.equal(row.quote.literal,originalLines[row.quote.citation.line-1]);
  if(process.env.ULPIN_SURVEY_RECEIPT_PATH)await writeFile(process.env.ULPIN_SURVEY_RECEIPT_PATH,JSON.stringify({
    qualification:'Controlled service/SQL transport envelopes over unchanged real report bytes; no live accepted job or listener.',
    sourceSha256:sha256(fixture.raw),sourceBytes:fixture.raw.length,readerSha256:fixture.input.readerSha256,
    controlledResultSha256:sha256(fixture.bytes),controlledResultBytes:fixture.bytes.length,
    responseSha256:sha256(JSON.stringify(context)),responseBytes:Buffer.byteLength(JSON.stringify(context)),
    locatorsChecked:locators,observedRows:17,parsedRows:11,unparsedRows:6,firstLine:83,lastLine:99,sourceCaptures:captures,objectReads:reads,
    tableStatus:context.table.status,state:context.state,qualificationStates:context.qualification,
  },null,2));
});

test('real NVA retains all 166 lines, flags 61 canonical redactions, and preserves unavailable horizontal values and both disabled rows',realOptions,async()=>{
  const fixture=await report('nva'),context=surveyReportProjection(fixture.request,fixture.result);
  assert.equal(context.table.status,'incomplete');assert.equal(context.table.observedRows,166);
  assert.equal(context.table.rows.length,105);assert.equal(context.table.unparsedRows.length,61);
  assert.equal(context.table.parsedEnabledRows,103);assert.equal(context.table.parsedDisabledRows,2);
  assert.deepEqual(context.table.rows.slice(-2).map(r=>[r.ordinal,r.pointIdentifier,r.enabled,r.statusLiteral]),
    [[164,'gs_240',false,'Turned Off'],[165,'gs_241',false,'Turned Off']]);
  assert.equal(context.table.header!.citation.line,337);assert.equal(context.table.rows[0].quote.citation.line,338);
  assert.equal(context.table.rows.at(-1)!.quote.citation.line,503);
  assert.equal(context.publishedSummary.withheld,166);assert.equal(context.publishedSummary.horizontalMeasured,0);
  assert.equal(context.publishedSummary.verticalMeasured,164);
  assert(context.statements.some(q=>q.kind==='withholding'&&q.literal.includes('166 of 166')));
  for(const row of context.table.rows){
    assert.equal(row.fields[10].literal,'-----');assert.equal(row.fields[10].state,'unavailable');assert.equal(row.fields[10].value,null);
    assert.equal(row.fields[6].literal,'0.000');assert.equal(row.fields[6].state,'stated');assert.equal(row.fields[6].value,0);
  }
  assert.equal(context.table.rows[0].fields[5].value,-19.794);assert.equal(context.table.rows[0].fields[12].value,-19.799);
  assert.equal(context.table.rows[0].fields[17].literal,'0.004'); // Published rounded residual, never recomputed from displayed coordinates.
  assert.equal(context.publishedStatistics[0].values[0].literal,'--------');assert.equal(context.publishedStatistics[0].values[0].value,null);
  assert(context.gaps.some(g=>g.code==='horizontal_product_values_unavailable'));
  assert(context.gaps.some(g=>g.code==='source_excluded_rows_present'));
  assertLocators(context);assert(Buffer.byteLength(JSON.stringify(context))<SURVEY_REPORT_LIMITS.responseBytes-4096);
  if(process.env.ULPIN_SURVEY_RECEIPT_PATH)await writeFile(process.env.ULPIN_SURVEY_RECEIPT_PATH+'.nva.json',JSON.stringify({
    qualification:'Source-literal pure parser over controlled native extraction, not an accepted-job runtime qualification.',
    sourceSha256:sha256(fixture.raw),sourceBytes:fixture.raw.length,observedRows:166,parsedRows:105,unparsedRows:61,parsedEnabled:103,parsedDisabled:2,
    firstLine:338,lastLine:503,locatorsChecked:assertLocators(context),responseBytes:Buffer.byteLength(JSON.stringify(context)),
    tableStatus:context.table.status,withheld:context.publishedSummary.withheld,gaps:context.gaps,
  },null,2));
});

test('incomplete/redacted accepted extraction stays incomplete and ambiguous layout refuses without manufacturing rows',realOptions,async()=>{
  const {request,result}=await report('pid');
  let context=surveyReportProjection(request,alter(result,98,null));
  assert.equal(context.table.status,'incomplete');assert.equal(context.table.rows.length,10);assert.equal(context.table.observedRows,16);assert.equal(context.table.declaredTotal,17);
  assert(context.gaps.some(g=>g.code==='table_population_incomplete'));
  const row=result.native.parts.find(p=>p.locator.line===83)!;
  context=surveyReportProjection(request,alter(result,83,row.text.replace('gs_004','[redacted]')));
  assert.equal(context.table.status,'incomplete');assert.equal(context.table.rows.length,10);assert.equal(context.table.unparsedRows.length,7);
  assert.equal(context.table.unparsedRows[0].citation.line,83);assertLocators(context);
  const end=result.native.parts.at(-1)!;
  context=surveyReportProjection(request,alter(result,end.locator.line!,null));assert.equal(context.table.status,'incomplete');
  assert(context.gaps.some(g=>g.code==='table_end_missing'));
  const header=result.native.parts.find(p=>p.locator.line===82)!;
  context=surveyReportProjection(request,alter(result,82,null));
  assert.equal(context.table.status,'incomplete');assert.equal(context.table.rows.length,0);assert.equal(context.table.unparsedRows.length,17);
  assert(context.gaps.some(g=>g.code==='table_header_missing'));assertLocators(context);
  const duplicated=DocumentResultSchema.parse({...result,native:{...result.native,parts:[...result.native.parts,
    {...header,id:randomUUID(),locator:{...header.locator,line:103,unitId:randomUUID()}}]}});
  assert.throws(()=>surveyReportProjection(request,duplicated),(e:any)=>e.code==='SURVEY_REPORT_LAYOUT');
  assert(!SurveyReportRequestSchema.safeParse({...request,table:row.text}).success);
  assert(!SurveyReportRequestSchema.safeParse({...request,url:'https://example.org/report.txt'}).success);
});

test('current source/access denial precedes I/O and same-revision input/attempt drift after I/O prevents disclosure',realOptions,async()=>{
  const fixture=await report('pid'),ctx=localRequestContext(randomUUID());let reads=0;
  const deps={source:async()=>fixture.capture,result:async()=>{reads++;return fixture.result;}};
  await assert.rejects(()=>inspectSurveyReport(ctx,fixture.request,{...deps,source:async()=>{throw new AppError(403,'DOCUMENT_DENIED','Current source denied.');}}),
    (e:any)=>e.status===403);assert.equal(reads,0);
  let checks=0;
  await assert.rejects(()=>inspectSurveyReport(ctx,fixture.request,{...deps,source:async()=>++checks===1?fixture.capture:
    {...fixture.capture,input:{...fixture.input,accessSha256:sha256('revoked-access')}}}), (e:any)=>e.status===409);
  assert.equal(reads,1);checks=0;
  await assert.rejects(()=>inspectSurveyReport(ctx,fixture.request,{...deps,source:async()=>++checks===1?fixture.capture:
    {...fixture.capture,acceptedFence:2}}),(e:any)=>e.status===409);assert.equal(reads,2);
  // Exercise the production capture wrapper with controlled, read-only SQL responses.
  const budget={deadlineAt:Date.now()+1000,signal:new AbortController().signal,reservedBytes:0};
  const resultRef={assetId:`document:${fixture.input.jobId}`,version:1,sha256:fixture.request.document.resultSha256};
  const statements:string[]=[];
  const capture=await captureSurveyDocument(ctx,fixture.request.document,budget,undefined,{
    gate:async()=>{},source:async(_client,_ctx,pin,expected,lock)=>{assert.deepEqual(pin,fixture.request.document);assert.equal(lock,true);assert.equal(expected,undefined);return fixture.input;},
    transaction:async(action:any,options:any)=>{assert.equal(options.deadlineAt,budget.deadlineAt);assert.equal(options.signal,budget.signal);
      return action({query:async(sql:string)=>{statements.push(sql);return {rows:sql.startsWith('SELECT accepted_fence')?
        [{accepted_fence:1,result_ref:resultRef}]:[]};}});},
  } as any);
  assert.deepEqual(capture,fixture.capture);assert(statements.every(s=>s.startsWith('SELECT')));
});

test('bounded transport refuses oversize metadata before GET and truncated result bytes before projection',realOptions,async()=>{
  const fixture=await report('pid');let opens=0;
  const bounds=()=>({deadlineAt:Date.now()+1000,signal:new AbortController().signal,reservedBytes:0});
  await assert.rejects(()=>readSurveyDocument(fixture.request,fixture.capture,bounds(),{
    head:async()=>({bytes:4*1024*1024+1,etag:'controlled-etag'}),open:async()=>{opens++;throw new Error('GET must not run');},
  }),(e:any)=>e.code==='SURVEY_REPORT_RESULT_LIMIT');assert.equal(opens,0);
  await assert.rejects(()=>readSurveyDocument(fixture.request,fixture.capture,bounds(),{
    head:async()=>({bytes:fixture.bytes.length,etag:'controlled-etag'}),
    open:async()=>({body:Readable.from([fixture.bytes.subarray(0,fixture.bytes.length-1)]),etag:'controlled-etag'}),
  }),(e:any)=>e.code==='SOURCE_FUSION_INTEGRITY');
});
