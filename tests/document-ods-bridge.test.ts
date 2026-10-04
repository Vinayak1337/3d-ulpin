import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {DocumentInputSchema,DocumentResultSchema,type DocumentInput,type DocumentResult} from '../packages/contracts/src/usp/document-ingestion';
import {documentFormat,documentReaderSha,extractSourceDocument} from '../packages/server/src/modules/usp/ingestion/document-native';
import {documentPartEligibleForProposal,validateDocumentProposals} from '../packages/server/src/modules/usp/ingestion/document-model';
import {readDocumentResult} from '../packages/server/src/modules/usp/ingestion/documents';
import {sha256} from '../packages/server/src/infrastructure/storage';

// Optional private-source bridge run. No services, source/case/job enrollment or provider calls.
// The bridge process is separately supervised; these requests use the canonical default areaGeo transport.
const root=process.env.ODS_CHECK_SOURCE_ROOT,bridge=process.env.ODS_CHECK_BRIDGE_URL;
if(bridge){process.env.GEO_URL=bridge;process.env.GEO_SERVICE_TOKEN='ods-local-technical-control';}
const proof:Record<string,unknown>={version:'native-ods-check/1',authority:'technical input/byte-reader and isolated loopback transport controls; no accepted job claim'};
const digest='a'.repeat(64);
function input(bytes:Uint8Array):DocumentInput{
  return DocumentInputSchema.parse({version:'source-document/1',jobId:randomUUID(),caseId:randomUUID(),caseRevision:0,
    caseContextSha256:digest,sourceId:randomUUID(),familyId:randomUUID(),sourceRevision:1,sourceSha256:sha256(bytes),
    sourceBytes:bytes.length,objectKey:'private-ods-check',subject:'private technical source control',accessSha256:digest,
    policyVersion:'source-document-native/1',readerSha256:documentReaderSha(),gatewayPolicySha256:null,layoutCap:null,mode:'native_only'});
}
async function inspect(bytes:Uint8Array){
  const pin=input(bytes),native=await extractSourceDocument(pin,bytes);
  const result=DocumentResultSchema.parse({version:'source-document/1',input:pin,native,
    model:{status:'not_requested',code:null,candidates:[],validationErrors:[],calls:[]},createdAt:new Date().toISOString()});
  const serialized=Buffer.from(JSON.stringify(result));
  assert.ok(serialized.length<4*1024*1024);
  // Reuse canonical result/hash/source/complete segmented-unit validation; private storage is controlled.
  await readDocumentResult(pin,sha256(serialized),async()=>serialized);
  return {pin,native,resultBytes:serialized.length,resultSha256:sha256(serialized)};
}

// Deliberate XML controls, not source records. Stored ZIP writer avoids new dependencies.
function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const value of bytes){crc^=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function container(content:string){
  const entries=[['mimetype','application/vnd.oasis.opendocument.spreadsheet'],['content.xml',content],
    ['META-INF/manifest.xml','<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>']];
  const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
  for(const [path,value] of entries){const name=Buffer.from(path),data=Buffer.from(value),crc=crc32(data),head=Buffer.alloc(30),directory=Buffer.alloc(46);
    head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt32LE(crc,14);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(name.length,26);
    directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
    local.push(head,name,data);central.push(directory,name);offset+=head.length+name.length+data.length;
  }
  const index=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,index,end]);
}
const xml=(rows:string)=>`<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3"><office:body><office:spreadsheet><table:table table:name="Control">${rows}</table:table></office:spreadsheet></office:body></office:document-content>`;
const configured=Boolean(root&&bridge);
test.after(async()=>{
  if(process.env.ODS_CHECK_RECEIPT)writeFileSync(process.env.ODS_CHECK_RECEIPT,JSON.stringify(proof,null,2)+'\n');
  if(bridge)await fetch(`${bridge}/stop`,{method:'POST',headers:{Authorization:'Bearer ods-local-technical-control'},signal:AbortSignal.timeout(3000)});
});
test('unchanged official ODS preserves all native cell elements and compact repeated blank ranges', {skip:!configured},async()=>{
  const bytes=readFileSync(join(root!,'originals/home-office-hospitality-2021-q3.ods'));
  assert.equal(sha256(bytes),'1c6a364fd20ff769835451a075de4654fc21e1499dfaf159081d3db089e591f6');
  assert.equal(documentFormat(bytes),'archive');
  const result=await inspect(bytes),{native}=result;
  assert.equal(native.format,'ods');assert.equal(native.status,'extracted');assert.equal(native.parts.length,457);
  assert.ok(native.parts.every(p=>p.locator.sheet==='Q2_Hospitality'&&p.locator.sheetIndex===1&&p.locator.sheetId===undefined&&p.locator.ods));
  assert.ok(native.parts.some(p=>p.locator.ods?.rowRepeat===1048500&&p.locator.cellState==='empty'));
  assert.ok(native.parts.some(p=>p.locator.ods?.columnRepeat===16384));
  assert.ok(native.parts.some(documentPartEligibleForProposal));
  proof.literal={sourceSha256:sha256(bytes),readerSha256:result.pin.readerSha256,parts:native.parts.length,
    resultBytes:result.resultBytes,resultSha256:result.resultSha256,states:states(native),maxRowRepeat:1048500,maxColumnRepeat:16384};
});
function states(native:DocumentResult['native']){return native.parts.reduce<Record<string,number>>((counts,p)=>{const state=p.locator.cellState!;counts[state]=(counts[state]??0)+1;return counts;},{});}
test('unchanged external-reference formula workbook keeps unverified caches out of proposals', {skip:!configured},async()=>{
  const bytes=readFileSync(join(root!,'originals/libreoffice-fdo43534test.ods'));
  assert.equal(sha256(bytes),'576998ac8d4283964c329a4979579e81959d60ca5b4aecb7d673575b9007b288');
  const result=await inspect(bytes),{native}=result;
  assert.equal(native.format,'ods');assert.equal(native.status,'extracted');assert.equal(native.code,'NATIVE_PARTIAL_TEXT');
  assert.equal(native.parts.length,105);assert.equal(native.parts.filter(p=>p.locator.ods?.formula).length,22);
  assert.equal(native.parts.filter(p=>p.text==='[Covered cell; no value copied]').length,2);
  assert.ok(native.warnings.some(w=>w.includes('externally linked')));
  for(const part of native.parts.filter(p=>p.locator.ods?.formula)){
    assert.equal(documentPartEligibleForProposal(part),false);
    const candidate={partId:part.id,field:part.text,value:part.text,quote:part.text};
    assert.equal(validateDocumentProposals({candidates:[candidate]},[part]).candidates.length,0);
    assert.equal(DocumentResultSchema.safeParse({version:'source-document/1',input:result.pin,native,
      model:{status:'proposed',code:null,candidates:[candidate],validationErrors:[],calls:[]},createdAt:new Date().toISOString()}).success,false);
  }
  proof.formula={sourceSha256:sha256(bytes),parts:native.parts.length,formulas:22,states:states(native),warnings:native.warnings,
    resultBytes:result.resultBytes,resultSha256:result.resultSha256};
});
test('cell-state controls and oversize repetition/entity refusals use the actual bridge', {skip:!configured},async()=>{
  const bytes=container(xml('<table:table-row><table:table-cell office:value-type="float" office:value="0"/>'+
    '<table:table-cell/><table:table-cell office:value-type="string" office:string-value=""/>'+
    '<table:table-cell office:value-type="string"><text:p><text:s text:c="3"/></text:p></table:table-cell>'+
    '<table:table-cell table:formula="of:=1+1" office:value-type="float"/>'+
    '<table:table-cell table:formula="of:=0" office:value-type="float" office:value="0"/></table:table-row>'));
  const {native}=await inspect(bytes);
  assert.equal(native.status,'extracted');assert.equal(native.parts.length,6);
  assert.deepEqual(native.parts.map(p=>[p.locator.cell,p.locator.cellState,p.text]),[
    ['A1','literal','0'],['B1','empty','[Explicit cell with no stored value]'],['C1','empty_string','[Stored empty string]'],
    ['D1','whitespace','   '],['E1','formula_uncached','[Formula result unavailable; not calculated]'],['F1','formula_cached','0']]);
  const repeated=container(xml('<table:table-row table:number-rows-repeated="1048577"><table:table-cell/></table:table-row>'));
  const repeat=await inspect(repeated);assert.equal(repeat.native.status,'tool_error');assert.equal(repeat.native.code,'NATIVE_ODS_LIMIT');assert.equal(repeat.native.parts.length,0);
  const entity=container('<!DOCTYPE office:document-content [<!ENTITY test "expanded">]>'+xml('<table:table-row><table:table-cell office:value-type="string"><text:p>&test;</text:p></table:table-cell></table:table-row>'));
  const guarded=await inspect(entity);assert.equal(guarded.native.status,'tool_error');assert.equal(guarded.native.code,'NATIVE_WORKBOOK_INVALID');assert.equal(guarded.native.parts.length,0);
  proof.controls={states:states(native),repeat:{status:repeat.native.status,code:repeat.native.code},entity:{status:guarded.native.status,code:guarded.native.code}};
  if(process.env.ODS_CHECK_RECEIPT)writeFileSync(process.env.ODS_CHECK_RECEIPT,JSON.stringify(proof,null,2)+'\n');
});
