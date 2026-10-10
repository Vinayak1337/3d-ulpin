// K9d: reads one retained OCR worker result and asks the published contract, then the bridge, about its bytes.
// Runs no OCR. The bridge import loads server settings, so run under the guard that keeps .env files closed:
//   G=docs/evidence/gf1/k9d/safety.cjs
//   NODE_OPTIONS="--require $G" node --require $G --import tsx docs/evidence/gf1/k9d/reproduce.ts <result.json>
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DocumentOcrSchema,measureOcrRegionEdge} from '../../../../packages/contracts/src/usp/document-ingestion';
import {admitOcrCandidate} from '../../../../packages/server/src/modules/usp/ingestion/document-ocr';

const bytes=readFileSync(process.argv[2]);
const raw=JSON.parse(bytes.toString('utf8'));
const region:[number,number,number,number]=raw.selection.sourcePageBox;
// The worker's result as the bridge published it before K9d: every field as read, and no region edge stated.
const withoutEdge=DocumentOcrSchema.safeParse({sourceSha256:raw.sourceSha256,sourceRevision:1,
  sourcePage:raw.sourcePage,requestedRegion:region,sourcePageFrame:raw.sourcePageFrame,method:raw.method,
  toolStatus:raw.toolStatus,outputStatus:raw.outputStatus,textCompleteness:'unverified',issues:raw.issues,
  items:raw.items});
const bridge=admitOcrCandidate({jobId:randomUUID(),sourceSha256:raw.sourceSha256,sourceRevision:1,
  sourceBytes:raw.sourceBytes,ocrSelection:{page:raw.sourcePage,region}},bytes);
const boxes=(items:{sourcePageBoxes:{box:number[]}[]}[])=>items.flatMap(item=>item.sourcePageBoxes.map(c=>c.box));
console.log(JSON.stringify({resultSha256:createHash('sha256').update(bytes).digest('hex'),items:raw.items.length,
  boxes:boxes(raw.items).length,measured:measureOcrRegionEdge(region,raw.items,raw.render.scale),
  renderScale:raw.render.scale,oneRenderedPixelPt:1/raw.render.scale,
  contractWithoutEdge:{accepts:withoutEdge.success,
    refusal:withoutEdge.success?null:withoutEdge.error.issues.map(issue=>issue.message)},
  bridge:{toolStatus:bridge.toolStatus,outputStatus:bridge.outputStatus,issues:bridge.issues,
    lines:bridge.items.length,regionEdge:bridge.regionEdge??null,
    boxesStoredAsRead:JSON.stringify(boxes(bridge.items))===JSON.stringify(boxes(raw.items))}}));
