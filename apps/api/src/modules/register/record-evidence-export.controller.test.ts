import 'reflect-metadata';
import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {Readable} from 'node:stream';
import type {PoolClient} from 'pg';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';
import {HEADERS_METADATA,GUARDS_METADATA} from '@nestjs/common/constants';
import {RegistryRecordEvidenceExportController} from './record-evidence-export.controller';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
import {RegistryRecordEvidenceExportService,readRegistryRecordEvidenceExportTx,renderRegistryRecordEvidenceExport}
  from '@ulpin/server/modules/registry/registry-record-evidence-export';
import {RegistryRecordEvidenceSchema,type RegistryRecordEvidence} from '../../../../../packages/contracts/src/registry-record-evidence';
import {DocumentResultSchema} from '../../../../../packages/contracts/src/usp';
import {SOURCE_FUSION_LIMITS} from '../../../../../packages/contracts/src/source-fusion';
import {sha256,closeStorageClient} from '@ulpin/server/infrastructure/storage';
import {settings} from '@ulpin/server/infrastructure/config';
import {AppError} from '@ulpin/server/infrastructure/errors';
import {documentResultKey,readDocumentResult} from '@ulpin/server/modules/usp/ingestion/documents';
import type {FusionBudget} from '@ulpin/server/modules/usp/ingestion/source-fusion-authority';
import {fingerprint} from '@ulpin/server/modules/cases/domain';
import type {RegistryDocumentDependencies} from '@ulpin/server/modules/registry/registry-document-evidence';

// Reuse RECORD-EVIDENCE-01 native bytes/pins and target controls with only the existing native pin selected.
// Previously validated complete/partial mesh responses are reused separately for formatting. No current
// mesh envelope, tool admission or official property correspondence is fabricated.
const serverRequire=createRequire(new URL('../../../../../packages/server/package.json',import.meta.url)),
  {S3Client}=serverRequire('@aws-sdk/client-s3'),id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,
  priorRoot='E:/BhuAayam-data/task-data/gltf-reference-link-20261004-run01',
  documentPath='E:/BhuAayam-data/task-data/desktop-reference-document-enrollment/epsg7415-accepted-result.json';
const receipts:any[]=[];
before(()=>{
  test.mock.getter(settings,'s3Endpoint',()=> 'http://127.0.0.1:1');
  test.mock.getter(settings,'s3AccessKey',()=> 'unconnected-control');
  test.mock.getter(settings,'s3SecretKey',()=> 'unconnected-control');
});
after(()=>{closeStorageClient();test.mock.restoreAll();});
const save=(name:string,value:unknown)=>{if(process.env.ULPIN_RECORD_EVIDENCE_EXPORT_PROOF_DIR)
  writeFileSync(process.env.ULPIN_RECORD_EVIDENCE_EXPORT_PROOF_DIR+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});};
async function local(work:()=>Promise<void>){const prior=process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT='registry-gltf-protocol';
  try{await work();}finally{if(prior===undefined)delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT=prior;}}
function fixture(){
  const savedRead=JSON.parse(readFileSync(priorRoot+'/Box.glb.controlled-journey.json','utf8')),
    documentBytes=readFileSync(documentPath),document=DocumentResultSchema.parse(JSON.parse(documentBytes.toString('utf8'))),
    siteId=id(10),current={id:document.input.caseId,archived:false},body=structuredClone(savedRead.recordedBody);
  // Exact existing native pin and original target base; the technical target includes only this native citation.
  body.documentCitations=body.documentCitations.filter((pin:any)=>pin.version==='registry-document-citation/1');
  assert.equal(body.documentCitations.length,1);
  const {documentCitations:_,...base}=body,
    state={row:{id:id(11),site_id:siteId,identifier:'controlled-existing-record',kind:body.kind,revision:2,body,footprint:JSON.stringify(body.footprint)},
      site:{id:siteId,identifier:'protocol-site',name:'protocol-site',revision:2,
        frame:{id:'protocol-frame',horizontalUnit:'m',verticalUnit:'m',benchmark:'protocol-only'},synthetic:true},
      history:new Map([[1,{body:base,site_revision:1}],[2,{body:structuredClone(body),site_revision:2}]]),
      calls:[] as string[],reads:0,revoke:false,change:false};
  assert.equal(sha256(documentBytes),body.documentCitations[0].document.resultSha256);
  assert.equal(fingerprint(base),body.documentCitations[0].target.bodySha256);
  const client={query:async(sql:string,args:any[]=[])=>{
    state.calls.push(sql);assert(sql.startsWith('SELECT'),'Read leaf must never write');let rows:any[]=[];
    if(sql.includes('END selected_body')){
      const h=state.history.get(args[1]);
      if(h){const {body:__,...record}=state.row;rows=[{record,history:{record_id:state.row.id,revision:args[1],site_revision:h.site_revision},
        site:state.site,body:state.row.body,selected_body:h.body,project_status:null}];}
    }else if(sql.includes('pg_advisory_xact_lock')||sql.startsWith('SELECT id FROM cases')||sql.startsWith('SELECT id FROM sources'))rows=[];
    else if(sql.includes('FROM registry_sites'))rows=[state.site];
    else if(sql.includes('CASE WHEN r.revision'))rows=[{site_id:siteId,kind:state.row.kind,body:args[1]===state.row.revision?state.row.body:state.history.get(args[1])?.body}];
    else if(sql.includes('FROM registry_records'))rows=[state.row];
    else if(sql.includes('SELECT accepted_fence')){
      assert.equal(args[0],document.input.jobId);rows=[{accepted_fence:body.documentCitations[0].acceptedFence}];
    }
    else assert.fail('Unexpected controlled SQL: '+sql);
    return {rows:structuredClone(rows),rowCount:rows.length};
  }} as PoolClient,
    objects=new Map([[documentResultKey(document.input.jobId,sha256(documentBytes)),documentBytes]]);
  const dependencies:RegistryDocumentDependencies={source:async(_client,_ctx,pin)=>{
    assert.equal(pin.sourceId,document.input.sourceId);if(current.archived)throw new AppError(403,'CONTROL_REVOKED','Controlled private access revoked.');return document.input;
  },result:readDocumentResult,registrySource:async()=>{
    if(current.archived)throw new AppError(403,'CONTROL_REVOKED','Controlled private access revoked.');
    return {revision:document.input.sourceRevision,sha256:document.input.sourceSha256,accessSha256:document.input.accessSha256} as any;
  }};
  return {state,client,dependencies,objects,documentBytes,body,current};
}
const retained=JSON.parse(readFileSync('E:/BhuAayam-data/task-data/record-evidence-20261004-run01/final-check/journeys.json','utf8'));
const retainedEvidence:RegistryRecordEvidence[]=retained.map((receipt:any)=>RegistryRecordEvidenceSchema.parse(receipt.current));
const freshBudget=():FusionBudget=>({deadlineAt:Date.now()+30_000,signal:new AbortController().signal,reservedBytes:0});
function decodedCsv(bytes:Buffer){
  const lines=bytes.toString('utf8').trimEnd().split('\r\n'),headers=lines.shift()!.split(',');
  const rows=lines.map(line=>{
    const cells:string[]=[];let value='',quoted=false;
    for(let i=0;i<line.length;i++){
      const char=line[i];
      if(char==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
      else if(char===','&&!quoted){cells.push(value);value='';}else value+=char;
    }
    assert.equal(quoted,false);cells.push(value);assert.equal(cells.length,headers.length);
    // Independent spreadsheet-facing assertion: the parsed CSV cell is a JSON string, never a sigil/number.
    for(const cell of cells)assert.equal(cell[0],'"');
    return Object.fromEntries(headers.map((key,index)=>[key,JSON.parse(cells[index])]));
  });
  assert.equal(rows[0].row_type,'manifest');const {citationCount,...manifest}=JSON.parse(rows[0].manifest_json);
  assert.deepEqual(JSON.parse(rows[0].entry_json),[]);
  assert.equal(rows.length-1,citationCount);
  const citations=rows.slice(1).map((row,index)=>{assert.equal(row.row_type,'citation');assert.equal(row.citation_ordinal,String(index));return JSON.parse(row.entry_json);});
  return {evidence:RegistryRecordEvidenceSchema.parse({...manifest,citations}),rows};
}
let inspected:RegistryRecordEvidence=retainedEvidence[0];
test('retained validated native-plus-mesh responses preserve all entries without current admission or reconstruction',()=>{
  const checked=[];
  for(const [index,evidence] of retainedEvidence.entries()){
    const text=renderRegistryRecordEvidenceExport(evidence,'text',freshBudget()),csv=renderRegistryRecordEvidenceExport(evidence,'csv',freshBudget());
    assert.deepEqual(JSON.parse(text.body.toString('utf8')).evidence,evidence);assert.deepEqual(decodedCsv(csv.body).evidence,evidence);
    assert.equal(evidence.citations.length,3);checked.push({name:retained[index].name,textBytes:text.body.length,csvBytes:csv.body.length,textSha256:text.metadata.sha256,csvSha256:csv.metadata.sha256,coverage:'formatting over unchanged previously validated response; no current mesh admission'});
  }
  save('retained-mesh-formatting.json',checked);
});
test('canonical native export round-trips text/CSV, exact history and honest empty lists',()=>local(async()=>{
  for(const name of ['retained-native-document'] as const){
    const f=fixture(),mock=test.mock.method(S3Client.prototype,'send',async(command:any)=>{
      const bytes=f.objects.get(command.input.Key);assert(bytes);f.state.reads++;
      if(f.state.revoke)f.current.archived=true;if(f.state.change)f.state.row.body.name='changed controlled target';
      return {Body:Readable.from([bytes]),ContentLength:bytes.length};
    });
    try{
      const request={recordId:id(11),revision:2},bounds=freshBudget(),
        text=await readRegistryRecordEvidenceExportTx(f.client,{...request,format:'text'},f.dependencies,bounds),
        csv=await readRegistryRecordEvidenceExportTx(f.client,{...request,format:'csv'},f.dependencies),
        evidence=RegistryRecordEvidenceSchema.parse(JSON.parse(text.body.toString('utf8')).evidence);
      assert.deepEqual(decodedCsv(csv.body).evidence,evidence);assert.equal(evidence.citations.length,1);
      assert.equal(text.metadata.sha256,sha256(text.body));assert.equal(csv.metadata.sha256,sha256(csv.body));
      assert.equal(text.metadata.recordBodySha256,evidence.recordBodySha256);
      assert.equal(text.metadata.bytes,text.body.length);assert.equal(csv.metadata.bytes,csv.body.length);
      assert.ok(text.body.length<SOURCE_FUSION_LIMITS.responseBytes-8192);
      const {documentCitations:_,...next}=f.state.row.body;
      f.state.row.revision=3;f.state.row.body=next;f.state.site.revision=3;
      f.state.history.set(3,{body:structuredClone(next),site_revision:3});
      const history=await readRegistryRecordEvidenceExportTx(f.client,{...request,format:'text'},f.dependencies),
        historical=JSON.parse(history.body.toString('utf8')).evidence;
      assert.equal(historical.snapshotState,'historical');assert.equal(historical.currentRecordRevision,3);
      assert.equal(historical.recordBodySha256,evidence.recordBodySha256);assert.deepEqual(historical.citations,evidence.citations);
      const reads=f.state.reads,empty=await readRegistryRecordEvidenceExportTx(f.client,{...request,revision:3,format:'csv'},f.dependencies);
      assert.deepEqual(decodedCsv(empty.body).evidence.citations,[]);assert.equal(f.state.reads,reads);
      const gate=f.state.calls.findIndex(sql=>sql.includes('pg_advisory_xact_lock')),
        destination=f.state.calls.findIndex(sql=>sql.includes('registry_sites WHERE id=$1 FOR SHARE'));
      assert.ok(gate>=0&&gate<destination);
      inspected=evidence;
      receipts.push({name,documentSha256:sha256(f.documentBytes),sourceAuthority:'technical native source/target/SQL/storage controls',
        text:{bytes:text.body.length,sha256:text.metadata.sha256},csv:{bytes:csv.body.length,sha256:csv.metadata.sha256},evidence,historical,
        empty:decodedCsv(empty.body).evidence,reservedBytes:bounds.reservedBytes,writes:0,nativeRuns:0,liveToolAdmission:false});
      save(name+'.txt',text.body.toString('utf8')); // JSON-encoded proof copy, not a durable application artifact.
    }finally{mock.mock.restore();}
  }
  save('journeys.json',receipts);
}));

test('source revocation and complete-body changes refuse before an export is returned',()=>local(async()=>{
  const denials=[];
  for(const mode of ['revoke','change'] as const){
    const f=fixture();f.state[mode]=true;
    const mock=test.mock.method(S3Client.prototype,'send',async(command:any)=>{
      const bytes=f.objects.get(command.input.Key);assert(bytes);f.state.reads++;
      if(f.state.revoke)f.current.archived=true;if(f.state.change)f.state.row.body.name='changed controlled target';
      return {Body:Readable.from([bytes]),ContentLength:bytes.length};
    });
    try{
      let returned=false;
      await assert.rejects(async()=>{await readRegistryRecordEvidenceExportTx(f.client,{recordId:id(11),revision:2,format:'csv'},f.dependencies);returned=true;},
        (error:any)=>error.status===(mode==='revoke'?403:409));
      assert.equal(returned,false);denials.push({mode,returned,writes:0});
    }finally{mock.mock.restore();}
  }
  save('denials.json',denials);
}));

test('CSV quotes/control characters round-trip; expansion and post-render cancellation refuse without truncation',()=>{
  const value='=SUM(1,2)\r\n+3\t@field\n-1 "quoted" \\ 0000123',copy=structuredClone(retainedEvidence[0]),native=copy.citations.find(entry=>'part' in entry)!;
  assert.ok('part' in native);native.part.text=value; // Formatting-only control; not authentic cited content or learning data.
  native.part.locator.characterEnd=native.part.locator.characterStart+value.length;
  const formatted=renderRegistryRecordEvidenceExport(copy,'csv',freshBudget());
  assert.deepEqual(decodedCsv(formatted.body).evidence,copy);
  assert.deepEqual(formatted.body,renderRegistryRecordEvidenceExport(copy,'csv',freshBudget()).body);
  const large=structuredClone(retainedEvidence[0]),mesh=large.citations.find(entry=>'fragment' in entry&&entry.fragment.kind==='gltf')!;
  assert.ok('fragment' in mesh&&mesh.fragment.kind==='gltf');mesh.fragment.asset.formattingBoundControl='\\'.repeat(400_000);
  assert.ok(Buffer.byteLength(JSON.stringify(large))<SOURCE_FUSION_LIMITS.responseBytes-8192);
  assert.throws(()=>renderRegistryRecordEvidenceExport(large,'csv',freshBudget()),(error:any)=>error.status===413&&error.code==='REGISTRY_RECORD_EVIDENCE_EXPORT_LIMIT');
  const controller=new AbortController(),bounds=freshBudget();bounds.signal=controller.signal;
  const original=Buffer.from,hook=test.mock.method(Buffer,'from',function(...args:any[]){
    const result=(original as any)(...args);if(args[1]==='utf8')controller.abort();return result;
  });
  try{assert.throws(()=>renderRegistryRecordEvidenceExport(inspected,'text',bounds),(error:any)=>error.status===503&&error.code==='SOURCE_FUSION_DEADLINE');}
  finally{hook.mock.restore();}
  save('format-bounds.json',{csvLossless:true,spreadsheetCellsJsonStrings:true,deterministic:true,completeOversizeRefusal:true,postRenderCancellationRefused:true});
});

@Module({controllers:[RegistryRecordEvidenceExportController],providers:[{provide:RegistryRecordEvidenceExportService,useValue:{read:async()=>({})}}]})
class ContractModule{}
test('private export route shape, safe headers and whole-response denial without a listener',async()=>{
  const app=await NestFactory.create(ContractModule,{logger:false,abortOnError:false});
  try{
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Private committed export control').build()),
      route=document.paths['/api/v1/registry-records/{recordId}/revisions/{revision}/document-citations/export']?.get;
    assert.equal(route?.operationId,'GET_api_v1_registry_records_recordId_revisions_revision_document_citations_export');
    assert.deepEqual(Object.keys((route!.responses['200'] as any).content).sort(),['text/csv','text/plain']);
    assert.ok(Reflect.getMetadata(GUARDS_METADATA,RegistryRecordEvidenceExportController).includes(PrivateSpatialGuard));
    assert.ok(Reflect.getMetadata(HEADERS_METADATA,RegistryRecordEvidenceExportController.prototype.read)
      .some((header:any)=>header.name==='Cache-Control'&&header.value==='private, no-store'));
    let calls=0,denied=false,sent:Buffer|undefined,headers:any,status:number|undefined;
    const exported=renderRegistryRecordEvidenceExport(inspected,'csv',freshBudget()),
      controller=new RegistryRecordEvidenceExportController({read:async(recordId:string,revision:number,format:string)=>{
        calls++;assert.equal(recordId,id(11));assert.equal(revision,2);assert.equal(format,'csv');
        if(denied)throw new AppError(403,'CONTROL_REVOKED','Controlled private access revoked.');return exported;
      }} as any),response={status:(value:number)=>{status=value;return response;},set:(value:any)=>{headers=value;return response;},send:(value:Buffer)=>{sent=value;return response;}} as any,
      request={query:{format:'csv'},originalUrl:'/api/v1/registry-records/'+id(11)+'/revisions/2/document-citations/export?format=csv'} as any;
    await controller.read(id(11).toUpperCase(),'2',request,response);
    assert.equal(status,200);assert.deepEqual(sent,exported.body);assert.equal(headers['Cache-Control'],'private, no-store');
    assert.equal(headers['Content-Type'],'text/csv; charset=utf-8');assert.equal(headers['X-Content-SHA256'],sha256(sent!));
    assert.equal(headers['Content-Length'],String(sent!.length));assert.equal(headers['X-Registry-Record-Body-SHA256'],inspected.recordBodySha256);
    assert.equal(headers['Content-Disposition'],`attachment; filename="registry-${id(11)}-revision-2-citations.csv"`);
    for(const revision of ['01','0','2147483648','1e2'])await assert.rejects(()=>controller.read(id(11),revision,request,response));
    await assert.rejects(()=>controller.read('alias','2',request,response));
    for(const suffix of ['','?format=csv&format=text','?format=csv&extra=1','?format=pdf'])
      await assert.rejects(()=>controller.read(id(11),'2',{...request,originalUrl:request.originalUrl.split('?')[0]+suffix},response));
    assert.equal(calls,1);denied=true;sent=undefined;headers=undefined;status=undefined;
    await assert.rejects(()=>controller.read(id(11),'2',request,response),(error:any)=>error.status===403);
    assert.equal(sent,undefined);assert.equal(headers,undefined);assert.equal(status,undefined);
    save('route.json',{operationId:route!.operationId,strictQueryAndIdentity:true,privateGuard:true,safeFixedAttachment:true,noBytesOnDenial:true,listenerStarted:false});
  }finally{await app.close();}
});
