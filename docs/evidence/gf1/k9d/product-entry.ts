// K9d: K9's difficult input through the product's own entry (runSourceOcr), once, on a scratch copy. CPU only.
// Run under the guard, which keeps .env files and the runtime folder closed and retains the attempt folder:
//   G=docs/evidence/gf1/k9d/safety.cjs
//   NODE_OPTIONS="--require $G" node --require $G --import tsx docs/evidence/gf1/k9d/product-entry.ts
import {createHash,randomUUID} from 'node:crypto';
import {copyFileSync,constants,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const data='E:/BhuAayam-data',scratch=`${data}/task-data/k9d`;
const retained=`${data}/task-data/desktop-ai04f-docling-tesseract`;
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** Copies a retained file into the scratch once; an existing copy is kept and only hashed. */
function scratchCopy(from:string,to:string){
  mkdirSync(join(to,'..'),{recursive:true});
  if(!existsSync(to))copyFileSync(from,to,constants.COPYFILE_EXCL);
  const copied=sha(readFileSync(to));
  if(copied!==sha(readFileSync(from)))throw new Error(`scratch copy differs: ${to}`);
  return copied;
}
const pdf=`${scratch}/input/haryana-2831-site-plan.pdf`,tessdata=`${scratch}/tessdata`;
const copies={
  source:scratchCopy(`${data}/datasets/rera-storeys/haryana-2831/haryana-2831-site-plan.pdf`,pdf),
  eng:scratchCopy(`${retained}/tesseract/share/tessdata/eng.traineddata`,`${tessdata}/eng.traineddata`),
  osd:scratchCopy(`${retained}/tesseract/share/tessdata/osd.traineddata`,`${tessdata}/osd.traineddata`),
  tsvConfig:scratchCopy(`${retained}/tesseract/Library/share/tessdata/configs/tsv`,`${tessdata}/configs/tsv`)};
Object.assign(process.env,{
  ULPIN_DOCUMENT_OCR_PYTHON:`${data}/ml/venv-demo-documents-20261010/Scripts/python.exe`,
  ULPIN_DOCUMENT_OCR_MODELS:`${retained}/models`,
  ULPIN_DOCUMENT_OCR_TESSERACT:`${data}/task-data/k2/tesseract-runtime-k2b/Library/bin/tesseract.exe`,
  ULPIN_DOCUMENT_OCR_TESSDATA:tessdata,ULPIN_DOCUMENT_OCR_SCRATCH:`${scratch}/ocr-scratch`});

const {runSourceOcr}=await import('../../../../packages/server/src/modules/usp/ingestion/document-ocr');
const original=readFileSync(pdf),region:[number,number,number,number]=[280,860,960,2580],started=Date.now();
const result=await runSourceOcr({jobId:randomUUID(),sourceSha256:copies.source,sourceRevision:1,
  sourceBytes:original.length,ocrSelection:{page:1,region}},original,Date.now()+110_000);
const text=result.items.map(item=>item.text).join('\n');
const summary={file:'haryana-2831-site-plan.pdf',page:1,region,copies,python:process.env.ULPIN_DOCUMENT_OCR_PYTHON,
  method:result.method,toolStatus:result.toolStatus,outputStatus:result.outputStatus,issues:result.issues,
  lines:result.items.length,boxes:result.items.reduce((count,item)=>count+item.sourcePageBoxes.length,0),
  textSha256:sha(Buffer.from(text,'utf8')),regionEdge:result.regionEdge??null,
  allowedOverhangPt:result.regionEdge?1/result.regionEdge.renderScalePxPerPt:null,
  supervisorExit:result.execution?.exitCode??null,workerExit:result.execution?.worker?.exitCode??null,
  stopReason:result.execution?.worker?.stopReason??null,workerSeconds:result.execution?.worker?.elapsedSeconds??null,
  resultSha256:result.execution?.candidateSha256??null,seconds:Math.round((Date.now()-started)/1000)};
writeFileSync(`${scratch}/product-entry-${started}.json`,JSON.stringify(summary)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary));
