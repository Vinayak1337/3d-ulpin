// K9d: real stored document statuses from the demo, already committed by K2, read against the changed contract.
// None states a region edge, so each must parse exactly as before. Reads committed files only.
//   node --import tsx docs/evidence/gf1/k9d/stored.ts
import {readFileSync} from 'node:fs';
import {DocumentStatusSchema} from '../../../../packages/contracts/src/usp/document-ingestion';

const folder='docs/evidence/gf-backend/k2';
const files=['tower3-ocr-status.json','tower3-installed-ocr-status.json','tower3-installed-ocr-region-status.json'];
console.log(JSON.stringify(files.map(file=>{
  const stored=JSON.parse(readFileSync(`${folder}/${file}`,'utf8')),checked=DocumentStatusSchema.safeParse(stored);
  return {file,accepts:checked.success,ocrToolStatus:stored.ocr?.toolStatus??null,
    region:stored.ocr?.requestedRegion??null,statesRegionEdge:stored.ocr?.regionEdge!==undefined,
    refusal:checked.success?null:checked.error.issues.map(issue=>issue.message)};
})));
