import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {DocumentPartSchema,DocumentResultSchema,type DocumentInput,type DocumentPart,type DocumentResult} from '../packages/contracts/src/usp/document-ingestion';
import {documentPartEligibleForProposal,proposeDocument,selectDocumentModelParts,validateDocumentProposals} from '../packages/server/src/modules/usp/ingestion/document-model';

const digest='a'.repeat(64),reader='b'.repeat(64),sourceId=randomUUID();
const input={version:'source-document/1',jobId:randomUUID(),caseId:randomUUID(),caseRevision:0,
  caseContextSha256:digest,sourceId,familyId:randomUUID(),sourceRevision:1,sourceSha256:digest,sourceBytes:1,
  objectKey:'technical-control',subject:'technical-control',accessSha256:digest,policyVersion:'source-document-native/1',
  readerSha256:reader,gatewayPolicySha256:digest,layoutCap:1,mode:'propose'} as DocumentInput;
function part(text:string,cellState?:DocumentPart['locator']['cellState']):DocumentPart{
  return DocumentPartSchema.parse({id:randomUUID(),sourceId,sourceRevision:1,sourceSha256:digest,text,sha256:digest,
    method:'native_text',locator:{label:cellState===undefined?'document line':'workbook cell',
      ...(cellState===undefined?{}:{sheet:'Control',sheetIndex:1,sheetId:1,cell:'A1',cellState,row:1,column:1}),
      characterStart:0,characterEnd:text.length}});
}
const candidate=(evidence:DocumentPart,field:string,value:string)=>({partId:evidence.id,field,value,quote:evidence.text});

test('workbook markers are skipped before the model part cap, while literal and non-workbook text remain eligible',()=>{
  const markers=Array.from({length:21},()=>part('[Explicit cell with no stored value]','empty'));
  const literal=part('Source title','literal'),plain=part('Source title');
  assert.deepEqual(selectDocumentModelParts([...markers,literal,plain]).map(item=>item.id),[literal.id,plain.id]);
  for(const state of ['empty','empty_string','whitespace','formula_cached','formula_uncached','error','unsupported'] as const)
    assert.equal(documentPartEligibleForProposal(part(state==='whitespace'?' ':'[Unresolved value]',state)),false);
  assert.equal(documentPartEligibleForProposal(literal),true);
  assert.equal(documentPartEligibleForProposal(plain),true);
});

test('quote validation and the persisted result contract reject marker-derived proposals',()=>{
  const literal=part('Source title','literal'),plain=part('Source title');
  assert.equal(validateDocumentProposals({candidates:[candidate(literal,'Source','title')]},[literal]).candidates.length,1);
  assert.equal(validateDocumentProposals({candidates:[candidate(plain,'Source','title')]},[plain]).candidates.length,1);
  const excluded=[
    ['empty','[Explicit cell with no stored value]','Explicit cell','no stored value'],
    ['empty_string','[Stored empty string]','Stored','empty string'],
    ['formula_uncached','[Formula result unavailable; not calculated]','Formula','unavailable'],
    ['formula_cached','cached result','cached','result'],
    ['error','stored error','stored','error'],
    ['unsupported','[Unsupported cell storage type]','Unsupported','storage type'],
  ] as const;
  for(const [state,text,field,value] of excluded){
    const marker=part(text,state),proposal=candidate(marker,field,value);
    assert.equal(validateDocumentProposals({candidates:[proposal]},[marker]).candidates.length,0,state);
    const native={status:'extracted',format:'xlsx',readerSha256:reader,code:null,warnings:[],parts:[marker]} as DocumentResult['native'];
    const model={status:'proposed',code:null,candidates:[proposal],validationErrors:[],calls:[]};
    assert.equal(DocumentResultSchema.safeParse({version:'source-document/1',input,native,model,createdAt:new Date().toISOString()}).success,false,state);
  }
});

test('no eligible workbook source text returns needs_input before gateway setup or layout reservation',async()=>{
  const marker=part('[Explicit cell with no stored value]','empty');
  const native={status:'extracted',format:'xlsx',readerSha256:reader,code:null,warnings:[],parts:[marker]} as DocumentResult['native'];
  let gatewayCalls=0,authorizeCalls=0;
  const result=await proposeDocument(input,native,async()=>{authorizeCalls++;},async()=>{gatewayCalls++;return undefined;});
  assert.equal(result.status,'needs_input');
  assert.equal(result.code,'MODEL_TEXT_SCOPE');
  assert.equal(gatewayCalls,0);
  assert.equal(authorizeCalls,0);
});
