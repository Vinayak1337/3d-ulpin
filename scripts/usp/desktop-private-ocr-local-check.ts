/** Final bridge check using an actual retained source/job receipt. No queue or publication is claimed. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {runSourceOcr} from '../../packages/server/src/modules/usp/ingestion/document-ocr';
import {sha256} from '../../packages/server/src/infrastructure/storage';

const [receiptPath,output]=process.argv.slice(2);
assert(receiptPath&&output&&!existsSync(output),'Provide an existing API receipt and a new output file.');
const previous=readFileSync(receiptPath),receipt=JSON.parse(previous.toString('utf8'));
assert.equal(receipt.version,'private-ocr-api/1');assert.equal(receipt.status,'passed');
const source=readFileSync('E:/BhuAayam-data/task-data/ulpin-official-runtime-pdf-v1/usgs-central-city-co-1910-topographic-map.pdf');
assert.equal(sha256(source),receipt.source.sha256);assert.equal(source.length,receipt.source.bytes);
const input={jobId:receipt.selected.jobId,sourceSha256:receipt.source.sha256,sourceRevision:receipt.source.sourceRevision,
  sourceBytes:source.length,ocrSelection:{page:1,region:[107.133,52.325,464.244,112.125] as [number,number,number,number]}};
const selected=await runSourceOcr(input,source,Date.now()+120000);
assert.equal(selected.outputStatus,'complete',selected.issues.join(','));assert.equal(selected.items.length,5);
assert.equal(selected.execution?.maxSeconds,90);assert.equal(selected.execution?.worker?.gatedStart,true);
assert.equal(selected.execution?.worker?.stopReason,null);assert(selected.execution?.receiptSha256);
const whole=await runSourceOcr({...input,ocrSelection:{page:1}},source,Date.now()+120000);
assert.equal(whole.toolStatus,'complete');assert.equal(whole.outputStatus,'partial');assert.equal(whole.items.length,0);
assert(whole.issues.includes('no_ocr_text_emitted'));
const models=process.env.ULPIN_DOCUMENT_OCR_MODELS;
let missing;
try{
  process.env.ULPIN_DOCUMENT_OCR_MODELS=models+'-missing-asset-control';
  missing=await runSourceOcr(input,source,Date.now()+120000);
  assert.equal(missing.toolStatus,'unavailable');assert.deepEqual(missing.issues,['OCR_RUNTIME_UNAVAILABLE']);
}finally{if(models===undefined)delete process.env.ULPIN_DOCUMENT_OCR_MODELS;else process.env.ULPIN_DOCUMENT_OCR_MODELS=models;}
const scratch=process.env.ULPIN_DOCUMENT_OCR_SCRATCH!;
assert(!readdirSync(scratch).some(name=>name.startsWith(`document-ocr-${input.jobId}-`)),'Owned attempt temporary artifact remains.');
const projection=(value:typeof selected)=>({...value,items:value.items.map(item=>({textSha256:sha256(item.text),
  label:item.label,method:item.method,sourcePageBoxes:item.sourcePageBoxes}))});
const codePaths=['packages/contracts/src/usp/document-ingestion.ts','packages/server/src/modules/usp/ingestion/document-ocr.ts',
  'scripts/usp/document-models/run_source_ocr.py','scripts/usp/document-models/run_trial.py',
  'services/geo/geo/usp_document_candidates/docling_tesseract.py'];
const record={version:'private-ocr-local-final/1',status:'passed',runAt:new Date().toISOString(),
  qualification:'Direct retained-source bridge only; final canonical API/job/state checks require restored Docker.',
  previousApiReceiptSha256:sha256(previous),sourceSha256:input.sourceSha256,sourceBytes:source.length,
  codeSha256:Object.fromEntries(codePaths.map(path=>[path,sha256(readFileSync(join(process.cwd(),path)))])),
  selected:projection(selected),whole:projection(whole),missing,ownedTemporaryArtifactsRemaining:0};
writeFileSync(output,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:record.status,selected:record.selected.items.length,whole:record.whole.outputStatus,
  missing:record.missing.toolStatus,ownedTemporaryArtifactsRemaining:0}));
