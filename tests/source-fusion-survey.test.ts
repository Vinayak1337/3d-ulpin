import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {SourceFusionRequestSchema,SourceFusionContextSchema,SOURCE_FUSION_LIMITS}
  from '../packages/contracts/src/source-fusion';
import {SourceFusionSurveySchema,type SourceFusionSurvey} from '../packages/contracts/src/source-fusion-survey';
import {DocumentOriginalSchema,DocumentResultSchema,type DocumentResult} from '../packages/contracts/src/usp/document-ingestion';
import {sha256} from '../packages/server/src/infrastructure/storage';
import {fingerprint} from '../packages/server/src/modules/cases/domain';
import {localRequestContext} from '../packages/server/src/modules/usp/principal';
import {ingestionBinding} from '../packages/server/src/modules/usp/ingestion/events';
import {documentInput} from '../packages/server/src/modules/usp/ingestion/document-context';
import {associationDocumentInputTx} from '../packages/server/src/modules/usp/ingestion/document-association-authority';
import {extractSourceDocument} from '../packages/server/src/modules/usp/ingestion/document-native';
import {documentResultKey} from '../packages/server/src/modules/usp/ingestion/documents';
import {assembleSourceFusion,type SourceFusionDependencies} from '../packages/server/src/modules/usp/ingestion/source-fusion';
import {fusionAuthorityBatch,readFusionResult,readFusionObject} from '../packages/server/src/modules/usp/ingestion/source-fusion-authority';
import {fusionSurveySourceProjection} from '../packages/server/src/modules/usp/ingestion/source-fusion-survey';
import {associationLiterals,associationManualSelection} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations-projection';
import {proposeFusionAssociations} from '../packages/server/src/modules/usp/ingestion/source-fusion-associations';
import {resolveFusionCitationsTx} from '../packages/server/src/modules/usp/ingestion/source-fusion-citations';

const root=process.env.ULPIN_SURVEY_FIXTURE_ROOT??'E:/BhuAayam-data/task-data/desktop-survey-control-source-20261003/originals';
const realOptions={skip:['pid','nva'].every(kind=>existsSync(join(root,`20250722_capemay_${kind}_report.txt`)))?false:
  'Retained real reports unavailable; set ULPIN_SURVEY_FIXTURE_ROOT. No replacement originals are generated.'};
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const caution='Native text is a source reference only. Facts, entity associations, coordinates and legal claims require explicit review; document instructions were not executed.';
async function local<T>(run:()=>Promise<T>){
  const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='fusion-survey-controlled-process';
  try{return await run();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}
}

/** Real original bytes and the unchanged redactor/partition helper. The pure
 * TEXT callback and all source/job/SQL/storage envelopes are disclosed controls,
 * not live enrollment, actual Python execution or authentic accepted jobs. */
async function report(kind:'nva'|'pid',n:number){
  const manifest=JSON.parse(await readFile('docs/evidence/usp/survey-control-source/manifest.json','utf8'));
  const original=manifest.originals.find((entry:any)=>entry.id===`${kind}-table`);
  const raw=await readFile(join(root,`20250722_capemay_${kind}_report.txt`));
  assert.equal(raw.length,original.pin.bytes);assert.equal(sha256(raw),original.pin.sha256);
  const current={id:uuid(n),revision:1,archived:false,frame:null,
    context:{sourceFamily:manifest.sourceFamily,classification:'test_only'},site_id:null};
  const binding=ingestionBinding(current.id),source={id:uuid(n+100),case_id:current.id,family_id:uuid(n+100),revision:1,
    sha256:sha256(raw),bytes:raw.length,object_key:'controlled-object-only',inspection:{documentOriginal:DocumentOriginalSchema.parse({
      version:'source-document/1',subject:binding.subject,format:'text',sha256:sha256(raw),bytes:raw.length,receivedAt:'2026-10-04T00:00:00Z'})}};
  const input=documentInput({current,binding,context:fingerprint({frame:current.frame,context:current.context,siteId:null}),source,latest:true},uuid(n+200),'native_only');
  const native=await extractSourceDocument(input,raw,async(value:any)=>{
    const bytes=Buffer.from(value.base64,'base64');assert.equal(value.format,'text');assert.deepEqual(bytes,raw);
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    return {format:'text',status:'ready',sourceSha256:sha256(bytes),warnings:[caution],
      parts:text.split(/\r\n|\n|\r/).flatMap((text,index)=>text.trim()?[{text,locator:{label:`line ${index+1}`,line:index+1}}]:[])};
  });
  const result=DocumentResultSchema.parse({version:'source-document/1',input,native,
    model:{status:'not_requested',code:null,candidates:[],validationErrors:[],calls:[]},createdAt:'2026-10-04T00:00:00Z'});
  const bytes=Buffer.from(JSON.stringify(result)),pin={caseId:input.caseId,caseRevision:1,sourceId:input.sourceId,sourceRevision:1,
    sourceSha256:input.sourceSha256,jobId:input.jobId,resultSha256:sha256(bytes),readerSha256:input.readerSha256,
    inputSha256:fingerprint(input),acceptedFence:1,resultBytes:bytes.length};
  return {kind,original,raw,current,source,input,result,bytes,pin};
}
type Fixture=Awaited<ReturnType<typeof report>>;
let retained:Promise<[Fixture,Fixture]>|undefined;
const fixtures=()=>retained??=Promise.all([report('nva',1),report('pid',2)]);
function controls(reports:Fixture[],afterRead?:()=>void){
  let active=false,captures=0,reads=0;const queries:string[]=[];
  const byCase=new Map(reports.map(f=>[f.input.caseId,f])),byJob=new Map(reports.map(f=>[f.input.jobId,f]));
  const objects=new Map(reports.map(f=>[documentResultKey(f.input.jobId,f.pin.resultSha256),f.bytes]));
  const client={query:async(sql:string,args:any[]=[])=>{
    assert(active,'SQL escaped the capture');queries.push(sql);assert(!/^(INSERT|UPDATE|DELETE)\b/i.test(sql),'unexpected write');
    if(sql.includes('pg_advisory_xact_lock')||sql.startsWith('SELECT id FROM cases')||sql.startsWith('SELECT id FROM sources')||
      sql.startsWith('SELECT job_id FROM usp_job_'))return {rows:[]};
    if(sql.includes('SELECT id,revision,archived,frame,context,site_id FROM cases'))return {rows:[byCase.get(args[0])!.current]};
    if(sql.startsWith('SELECT * FROM sources'))return {rows:[byCase.get(args[0])!.source]};
    if(sql.includes('SELECT max(revision)'))return {rows:[{revision:byCase.get(args[0])!.source.revision}]};
    const f=byJob.get(args[0]);assert(f,'unknown job');
    if(sql.startsWith('SELECT accepted_fence'))return {rows:[{accepted_fence:1}]};
    if(sql.startsWith('SELECT payload'))return {rows:[{payload:f.input,input_fingerprint:f.pin.inputSha256}]};
    if(sql.includes('SELECT j.status'))return {rows:[{status:'succeeded',logical_state:'succeeded',payload:f.input,
      input_sha256:f.pin.inputSha256,result_ref:{assetId:`document:${f.input.jobId}`,version:1,sha256:f.pin.resultSha256},
      completion_sha256:f.pin.resultSha256}]};
    assert.fail('Unexpected SQL: '+sql);
  }};
  const dependencies:SourceFusionDependencies={
    authority:(ctx,selections,budget,expected)=>fusionAuthorityBatch(ctx,selections,budget,expected,{
      transaction:async action=>{assert(!active);captures++;active=true;try{return await action(client as any);}finally{active=false;}},
      gate:async()=>{assert(active);},document:associationDocumentInputTx,cityjson:async()=>assert.fail('No CityJSON authority selected'),
    }),
    read:(selection,authority,budget)=>readFusionResult(selection,authority,budget,
      (key,size,hash,current)=>readFusionObject(key,size,hash,current,async(_key,_size,timeout,_etag,signal)=>{
        assert(!active,'Object I/O held SQL locks');assert.equal(key,_key);assert.equal(size,_size);
        assert(timeout>0&&timeout<=SOURCE_FUSION_LIMITS.deadlineMs);assert(signal);
        const bytes=objects.get(key);assert(bytes,'unexpected object');reads++;
        const body=Readable.from([bytes]);afterRead?.();return {body,etag:'controlled-stream'};
      })),
  };
  return {dependencies,observed:()=>({captures,reads,queries,writes:0})};
}
function citations(source:SourceFusionSurvey){
  const byId=new Map(source.parts.map(part=>[part.id,part]));let count=0;
  const check=(literal:string,cite:{partId:string;line:number;characterStart:number;characterEnd:number})=>{
    const part=byId.get(cite.partId);assert(part);assert.equal(part.locator.line,cite.line);
    assert.equal(part.text.slice(cite.characterStart,cite.characterEnd),literal);assert.equal(sha256(part.text),part.sha256);count++;
  };
  for(const quote of Object.values(source.report))if(quote)check(quote.literal,quote.citation);
  for(const quote of [source.table.header,source.table.end,...source.publishedSummary.quotes,...source.statements])
    if(quote)check(quote.literal,quote.citation);
  for(const {row} of source.rows){check(row.quote.literal,row.quote.citation);if(row.statusCitation)check(row.statusLiteral!,row.statusCitation);
    for(const field of row.fields)check(field.literal,field.citation);}
  for(const stat of source.publishedStatistics){check(stat.header.literal,stat.header.citation);check(stat.quote.literal,stat.quote.citation);
    for(const value of stat.values)check(value.literal,value.citation);}
  return count;
}

test('real NVA selected rows join a PID native fragment with whole-report coverage, exact citations and no property promotion',realOptions,async()=>local(async()=>{
  const [nva,pid]=await fixtures(),selected={kind:'survey_report' as const,pin:nva.pin,rowOrdinals:[165,0,164]},
    fragment={kind:'document' as const,pin:pid.pin,partIds:[pid.result.native.parts.find(p=>p.locator.line===83)!.id]};
  const request={sources:[fragment,selected]},control=controls([nva,pid]);
  assert(SourceFusionRequestSchema.safeParse(request).success);
  assert(!SourceFusionRequestSchema.safeParse({sources:[fragment,{...selected,rowOrdinals:[0,0]}]}).success);
  assert(!SourceFusionRequestSchema.safeParse({sources:[fragment,{...selected,rowOrdinals:Array.from({length:25},(_,i)=>i)}]}).success);
  assert(!SourceFusionRequestSchema.safeParse({sources:[fragment,{...selected,rows:[]}]}).success);
  const context=await assembleSourceFusion(localRequestContext(uuid(999)),request,control.dependencies);
  assert(SourceFusionContextSchema.safeParse(context).success);const source=context.sources[0];assert(source.kind==='survey_report');
  assert.equal(source.table.status,'complete');assert.equal(source.table.observedRows,166);assert.equal(source.table.parsedRows,166);
  assert.equal(source.table.parsedEnabledRows,164);assert.equal(source.table.parsedDisabledRows,2);assert.equal(source.table.unparsedRowCount,0);
  assert.deepEqual(source.rows.map(entry=>[entry.row.ordinal,entry.row.pointIdentifier,entry.row.enabled,entry.row.statusLiteral]),
    [[0,'gs_001',true,null],[164,'gs_240',false,'Turned Off'],[165,'gs_241',false,'Turned Off']]);
  assert.equal(source.coverage.selectedRows,3);assert.equal(source.coverage.selectedEnabledRows,1);assert.equal(source.coverage.selectedDisabledRows,2);
  assert.equal(source.coverage.unselectedParsedRows,163);assert.equal(source.coverage.wholeTable,'inspected_for_completeness');
  assert.equal(source.publishedSummary.withheld,166);assert.equal(source.publishedSummary.horizontalMeasured,0);
  assert(source.statements.some(s=>s.kind==='withholding'&&s.literal.includes('166 of 166')));
  for(const {key,rowSha256,row} of source.rows){
    assert(key.includes(`${nva.pin.jobId}/${nva.pin.resultSha256}/row/${row.ordinal}`));
    assert.equal(rowSha256,fingerprint({version:'source-fusion-survey-row/1',pin:nva.pin,row}));
    assert.equal(row.fields[10].literal,'-----');assert.equal(row.fields[10].state,'unavailable');assert.equal(row.fields[10].value,null);
    assert.equal(row.fields[6].literal,'0.000');assert.equal(row.fields[6].state,'stated');assert.equal(row.fields[6].value,0);
    assert.equal(row.quote.literal,nva.raw.toString('utf8').split(/\r\n|\n|\r/)[row.quote.citation.line-1]);
  }
  assert.equal(source.rows[0].row.fields[5].value,-19.794);assert.equal(source.rows[0].row.fields[12].value,-19.799);
  assert.equal(source.rows[0].row.fields[17].literal,'0.004');assert.deepEqual(source.warnings,[caution]);
  assert.equal(source.state,'needs_input');assert.equal(source.binding,'context_only');assert.equal(source.qualification.coordinateFrame,'needs_input');
  assert.equal(source.qualification.objectCorrespondence,'needs_input');assert.equal(source.qualification.accuracy,'not_assessed');
  assert.equal(context.association.state,'not_assessed');assert.deepEqual(context.association.canonicalTargets,[]);
  const selectedParts=new Set(source.rows.map(entry=>entry.row.quote.citation.partId));
  const allRowParts=new Set(nva.result.native.parts.filter(p=>p.locator.line!>=338&&p.locator.line!<=503).map(p=>p.id));
  assert.deepEqual(source.parts.filter(p=>allRowParts.has(p.id)).map(p=>p.id),[...selectedParts]);
  const generic=context.sources[1];assert(generic.kind==='document');assert.equal(generic.parts.length,1);
  assert.equal(generic.parts[0].part.id,fragment.partIds[0]);
  const count=citations(source),observed=control.observed();assert.equal(observed.captures,2);assert.equal(observed.reads,2);
  assert(observed.queries.some(q=>q.includes("a.state='accepted'")));assert(!observed.queries.some(q=>/^(INSERT|UPDATE|DELETE)\b/i.test(q)));
  assert(Buffer.byteLength(JSON.stringify(context))<SOURCE_FUSION_LIMITS.responseBytes-8192);
  const pidTyped=fusionSurveySourceProjection({kind:'survey_report',pin:pid.pin,rowOrdinals:[1,0]},pid.result);
  assert(SourceFusionSurveySchema.safeParse(pidTyped).success);assert.equal(pidTyped.table.parsedRows,17);assert.equal(pidTyped.table.status,'complete');
  assert.equal(pidTyped.rows[1].row.fields[14].literal,'-0.000');assert(Object.is(pidTyped.rows[1].row.fields[14].value,-0));
  assert.equal(pidTyped.report.horizontalUnits!.literal.trim(),'Horizontal Units:   meter');citations(pidTyped);
  const reordered=fusionSurveySourceProjection({...selected,rowOrdinals:[164,165,0]},nva.result);assert.deepEqual(reordered,source);
  const changed=fusionSurveySourceProjection({...selected,pin:{...selected.pin,resultSha256:'a'.repeat(64)}},nva.result);
  assert.notEqual(changed.rows[0].key,source.rows[0].key);assert.notEqual(changed.rows[0].rowSha256,source.rows[0].rowSha256);
  assert.throws(()=>associationLiterals(context),(e:any)=>e.code==='SOURCE_FUSION_SURVEY_CONTEXT_ONLY');
  assert.throws(()=>associationManualSelection({} as any,context,[]),(e:any)=>e.code==='SOURCE_FUSION_SURVEY_CONTEXT_ONLY');
  await assert.rejects(()=>proposeFusionAssociations(localRequestContext(uuid(999)),{
    requestKey:uuid(800),context:{contextSha256:context.contextSha256,selection:request},scope:null,targets:[]},{
      capture:async()=>({context,unsupportedCitationSources:[],revalidate:async()=>{}}),targets:async()=>[],policy:()=>null,
      gateway:async()=>assert.fail('survey context reached model gateway'),
    }),(e:any)=>e.code==='SOURCE_FUSION_SURVEY_CONTEXT_ONLY');
  const forbidden={query:async()=>assert.fail('survey binding reached SQL')};
  await assert.rejects(()=>resolveFusionCitationsTx(forbidden as any,localRequestContext(uuid(999)),
    {contextSha256:context.contextSha256,selection:request},{source:async()=>assert.fail('survey binding reached authority')},uuid(900)),
    (e:any)=>e.code==='SOURCE_FUSION_SURVEY_CONTEXT_ONLY');
  if(process.env.ULPIN_FUSION_SURVEY_RECEIPT_DIR){
    const dir=process.env.ULPIN_FUSION_SURVEY_RECEIPT_DIR;await mkdir(dir,{recursive:true});
    await writeFile(join(dir,'context.json'),JSON.stringify(context));
    await writeFile(join(dir,'journey.json'),JSON.stringify({scope:'Controlled TEXT callback, canonical source/job authority over SQL/storage doubles; no live enrollment, Python/HTTP/persistence or property qualification.',
      originals:[nva,pid].map(f=>({kind:f.kind,bytes:f.raw.length,sha256:sha256(f.raw),url:f.original.url})),
      readerSha256:nva.input.readerSha256,controlledResults:[nva,pid].map(f=>({kind:f.kind,bytes:f.bytes.length,sha256:f.pin.resultSha256})),
      responseBytes:Buffer.byteLength(JSON.stringify(context)),responseSha256:sha256(JSON.stringify(context)),contextSha256:context.contextSha256,
      table:source.table,coverage:source.coverage,selectedOrdinals:source.rows.map(entry=>entry.row.ordinal),citationsChecked:count,
      qualification:source.qualification,captures:observed.captures,objectReads:observed.reads,writes:observed.writes,
      guard:'proposal service/manual-selection/registry-citations refused survey kind; no model gateway call'},null,2));
  }
}));

test('unselected missing/redacted rows still make the whole table incomplete; nonexistent or ambiguous selected ordinals refuse',realOptions,async()=>local(async()=>{
  const [,pid]=await fixtures();
  const missing=DocumentResultSchema.parse({...pid.result,native:{...pid.result.native,
    parts:pid.result.native.parts.filter(part=>part.locator.line!==85)}});
  const selection={kind:'survey_report' as const,pin:pid.pin,rowOrdinals:[0]};
  const projected=fusionSurveySourceProjection(selection,missing);
  assert.equal(projected.table.status,'incomplete');assert.equal(projected.table.observedRows,16);assert.equal(projected.rows.length,1);
  assert(projected.gaps.some(g=>g.code==='table_population_incomplete'));assert.equal(projected.table.declaredTotal,17);
  const redacted=DocumentResultSchema.parse({...pid.result,native:{...pid.result.native,parts:pid.result.native.parts.map(part=>{
    if(part.locator.line!==85)return part;const text='[redacted native row]';return {...part,text,sha256:sha256(text),
      locator:{...part.locator,characterEnd:text.length,unitSha256:sha256(text)}};
  })}});
  const incomplete=fusionSurveySourceProjection(selection,redacted);assert.equal(incomplete.table.status,'incomplete');
  assert.equal(incomplete.table.unparsedRowCount,1);assert.equal(incomplete.coverage.unparsedRows,'not_expanded; inspect_full_survey_report_context');
  assert(!incomplete.parts.some(part=>part.locator.line===85));
  assert.throws(()=>fusionSurveySourceProjection({...selection,rowOrdinals:[2]},redacted),(e:any)=>e.code==='SOURCE_FUSION_SURVEY_SELECTION');
  assert.throws(()=>fusionSurveySourceProjection({...selection,rowOrdinals:[199]},pid.result),(e:any)=>e.code==='SOURCE_FUSION_SURVEY_SELECTION');
  // A controlled duplicate derived ordinal is not resolved by map overwrite.
  const duplicate=DocumentResultSchema.parse({...pid.result,native:{...pid.result.native,parts:pid.result.native.parts.map(part=>{
    if(part.locator.line!==84)return part;const text=part.text.replace(/^1\b/,'0');return {...part,text,sha256:sha256(text),
      locator:{...part.locator,characterEnd:text.length,unitSha256:sha256(text)}};
  })}});
  assert.throws(()=>fusionSurveySourceProjection(selection,duplicate),(e:any)=>e.code==='SOURCE_FUSION_SURVEY_SELECTION');
}));

test('canonical current-source denial precedes reads and late revocation denies final mixed-context disclosure',realOptions,async()=>local(async()=>{
  const [nva,pid]=await fixtures(),request={sources:[{kind:'survey_report' as const,pin:nva.pin,rowOrdinals:[164]},
    {kind:'document' as const,pin:pid.pin,partIds:[pid.result.native.parts.find(part=>part.locator.line===83)!.id]}]};
  let reads=0;const control=controls([nva,pid],()=>{if(++reads===2)nva.current.archived=true;});
  try{
    await assert.rejects(()=>assembleSourceFusion(localRequestContext(uuid(999)),request,control.dependencies),
      (e:any)=>e.status===403&&e.code==='SOURCE_FUSION_UNAVAILABLE');
    assert.equal(control.observed().captures,2);assert.equal(control.observed().reads,2);
    const denied=controls([nva,pid]);await assert.rejects(()=>assembleSourceFusion(localRequestContext(uuid(999)),request,denied.dependencies),
      (e:any)=>e.status===403);assert.equal(denied.observed().reads,0);
  }finally{nva.current.archived=false;}
}));
