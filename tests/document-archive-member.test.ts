import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import test from 'node:test';
import {DocumentRetrySchema,DocumentArchiveInspectionSchema,type DocumentInput} from '../packages/contracts/src/usp/document-ingestion';
import {inspectDocumentArchive} from '../packages/server/src/modules/usp/ingestion/document-archive';
import {areaGeo} from '../packages/server/src/modules/areas/areas';

const bytes=Buffer.from('technical archive transport control'),hash=createHash('sha256').update(bytes).digest('hex');
const memberSha256='b'.repeat(64),selection={ordinal:0,memberSha256,memberBytes:3};
const input:DocumentInput={version:'source-document/1',jobId:randomUUID(),caseId:randomUUID(),caseRevision:0,
  caseContextSha256:hash,sourceId:randomUUID(),familyId:randomUUID(),sourceRevision:1,sourceSha256:hash,
  sourceBytes:bytes.length,objectKey:'technical-control',subject:'technical-control',accessSha256:hash,
  policyVersion:'source-document-native/1',readerSha256:hash,gatewayPolicySha256:null,layoutCap:null,
  mode:'native_only',archiveSelection:selection};
const response={lineage:{version:'archive-member/1',outerSha256:hash,...selection,pathLabel:'technical.geojson',
  routeHint:'geojson',declaredCrc32:'352441c2',crc:'match',companion:'not_applicable',inventoryCoverage:'complete',
  inventoryIssue:null,unselectedIssues:[]},inspection:{sourceSha256:memberSha256,bytes:3,format:'geojson',layers:[],
  layer:null,sourceCrs:'EPSG:4326',crsEvidence:'RFC 7946 GeoJSON longitude/latitude',featureCount:1,geometryTypes:[],
  fields:[],featureIdEligible:false,suggestedIdField:null,suggestedNameField:null}};

test('retry selections exclude OCR/model work and reject loose member pins',()=>{
  const retry={requestKey:randomUUID(),expectedCaseRevision:0,expectedSourceRevision:1,sourceSha256:hash,
    mode:'native_only',archiveSelection:selection};
  assert(DocumentRetrySchema.safeParse(retry).success);
  assert(!DocumentRetrySchema.safeParse({...retry,ocrSelection:{page:1}}).success);
  assert(!DocumentRetrySchema.safeParse({...retry,mode:'propose'}).success);
  assert(!DocumentRetrySchema.safeParse({...retry,archiveSelection:{...selection,path:'technical.geojson'}}).success);
});
test('member transport cancels an oversized streamed processor result',async()=>{
  const original=globalThis.fetch,geo=process.env.GEO_URL,token=process.env.GEO_SERVICE_TOKEN;let cancelled=false;
  try{
    process.env.GEO_URL='http://127.0.0.1:1';process.env.GEO_SERVICE_TOKEN='technical-control';
    globalThis.fetch=async()=>new Response(new ReadableStream<Uint8Array>({
      pull(controller){controller.enqueue(Buffer.alloc(17));},cancel(){cancelled=true;}
    }),{status:200});
    await assert.rejects(()=>areaGeo('inspect-archive-member',{},16),(error:any)=>error.code==='AREA_RESULT_LIMIT');
    assert.equal(cancelled,true);
  }finally{
    globalThis.fetch=original;
    if(geo===undefined)delete process.env.GEO_URL;else process.env.GEO_URL=geo;
    if(token===undefined)delete process.env.GEO_SERVICE_TOKEN;else process.env.GEO_SERVICE_TOKEN=token;
  }
});
test('processor responses cannot substitute outer/member pins or member inspection bytes',async()=>{
  assert.deepEqual(await inspectDocumentArchive(input,bytes,async()=>response),response);
  await assert.rejects(()=>inspectDocumentArchive(input,bytes,async()=>({...response,
    lineage:{...response.lineage,ordinal:1}})),(error:any)=>error.code==='ARCHIVE_RESULT_SCOPE');
  assert(!DocumentArchiveInspectionSchema.safeParse({...response,
    inspection:{...response.inspection,sourceSha256:hash}}).success);
  let called=false;
  await assert.rejects(()=>inspectDocumentArchive(input,Buffer.from('changed'),async()=>{called=true;return response;}),
    (error:any)=>error.code==='ARCHIVE_SOURCE_INTEGRITY');
  assert.equal(called,false);
});
