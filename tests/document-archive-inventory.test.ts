import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import test from 'node:test';
import {DocumentResultSchema,type DocumentInput} from '../packages/contracts/src/usp/document-ingestion';
import {extractSourceDocument} from '../packages/server/src/modules/usp/ingestion/document-native';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const bytes=Buffer.from([80,75,3,4,0,0]),sourceSha256=sha(bytes),readerSha256='b'.repeat(64);
const input:DocumentInput={version:'source-document/1',jobId:randomUUID(),caseId:randomUUID(),caseRevision:0,
  caseContextSha256:'a'.repeat(64),sourceId:randomUUID(),familyId:randomUUID(),sourceRevision:1,
  sourceSha256,sourceBytes:bytes.length,objectKey:'technical-control',subject:'technical-control',
  accessSha256:'c'.repeat(64),policyVersion:'source-document-native/1',readerSha256,
  gatewayPolicySha256:null,layoutCap:null,mode:'native_only'};
const inventory={sourceSha256,coverage:'complete',issue:null,memberCount:1,declaredExpandedBytes:3,
  observedExpandedBytes:3,members:[{ordinal:0,pathLabel:'a.csv',declaredBytes:3,actualBytes:3,
    sha256:sha(Buffer.from('abc')),declaredCrc32:'352441c2',crc:'match',routeHint:'csv',issue:null,
    companion:'not_applicable'}]};
const model={status:'not_requested',code:null,candidates:[],validationErrors:[],calls:[]};

test('archive inventory is a private unsupported result with no text parts or model facts',async()=>{
  const native=await extractSourceDocument(input,bytes,async()=>({format:'archive',status:'unsupported',
    sourceSha256,code:'ARCHIVE_INVENTORY_ONLY',warnings:[],parts:[],archiveInventory:inventory as any}));
  assert.equal(native.status,'unsupported');
  assert.equal(native.parts.length,0);
  assert.equal(native.archiveInventory?.members[0].sha256,inventory.members[0].sha256);
  const result={version:'source-document/1',input,native,model,createdAt:new Date().toISOString()};
  assert.equal(DocumentResultSchema.safeParse(result).success,true);
  assert.equal(DocumentResultSchema.safeParse({...result,native:{...native,archiveInventory:{...inventory,sourceSha256:'d'.repeat(64)}}}).success,false);
  assert.equal(DocumentResultSchema.safeParse({...result,model:{...model,candidates:[{partId:randomUUID(),field:'a',value:'b',quote:'a b'}]}}).success,false);
});

test('older native receipts without inventory remain readable',()=>{
  const native={status:'unsupported',format:'archive',readerSha256,code:'ARCHIVE_DOCUMENT_UNSUPPORTED',warnings:[],parts:[]};
  assert.equal(DocumentResultSchema.safeParse({version:'source-document/1',input,native,model,
    createdAt:new Date().toISOString()}).success,true);
});

test('encrypted OOXML reader error retains document recovery status',async()=>{
  const native=await extractSourceDocument(input,bytes,async()=>{throw new Error('Encrypted document archive is unsupported.');});
  assert.equal(native.status,'encrypted');
  assert.equal(native.code,'DOCUMENT_ENCRYPTED');
  assert.equal(native.archiveInventory,undefined);
});
