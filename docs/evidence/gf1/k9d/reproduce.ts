// K9d Step 0: reads one retained OCR worker result and asks the published contract about it. Runs nothing else.
//   node --import tsx docs/evidence/gf1/k9d/reproduce.ts <result.json>
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DocumentOcrSchema} from '../../../../packages/contracts/src/usp/document-ingestion';

const bytes=readFileSync(process.argv[2]);
const raw=JSON.parse(bytes.toString('utf8'));
const region:number[]=raw.selection.sourcePageBox;
const checked=DocumentOcrSchema.safeParse({sourceSha256:raw.sourceSha256,sourceRevision:1,sourcePage:raw.sourcePage,
  requestedRegion:region,sourcePageFrame:raw.sourcePageFrame,method:raw.method,toolStatus:raw.toolStatus,
  outputStatus:raw.outputStatus,textCompleteness:'unverified',issues:raw.issues,items:raw.items});
const overhangs:number[]=raw.items.flatMap((item:{sourcePageBoxes:{box:number[]}[]})=>item.sourcePageBoxes.map(({box})=>
  Math.max(region[0]-box[0],region[1]-box[1],box[2]-region[2],box[3]-region[3])));
const beyond=overhangs.filter(value=>value>0);
console.log(JSON.stringify({resultSha256:createHash('sha256').update(bytes).digest('hex'),items:raw.items.length,
  boxes:overhangs.length,boxesBeyondRegion:beyond.length,largestOverhangPt:Math.max(0,...beyond),
  renderScale:raw.render.scale,oneRenderedPixelPt:1/raw.render.scale,contractAccepts:checked.success,
  contractRefusal:checked.success?null:checked.error.issues.map(issue=>issue.message)}));
