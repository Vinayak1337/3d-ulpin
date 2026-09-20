import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decodeMaskLabels} from '../apps/web/features/spatial/dataset-processing/mask-pixels';
import evidence from '../apps/web/features/spatial/dataset-processing/public-ml-evidence.json';
for(const task of ['building','floor-plan'] as const)test(`retained ${task} PNG decodes to exact known label IDs and foreground count`,async()=>{
 const result=evidence[task];
 const bytes=await readFile('apps/web/public'+result.mask.url);
 const labels=decodeMaskLabels(bytes,result.mask.width,result.mask.height);
 const expected=task==='building'?'36cdcd1348a9f0b8672ad55b72907b116ec9d5ea6d6cce43e02870c24b46dd57':'c82c1e8e27b37d0b359ed61f2f05fabb6f27c8b1195b768568f01ace4432a108';
 assert.equal(createHash('sha256').update(labels).digest('hex'),expected); // Independent Pillow decode.
 assert.equal(labels.length,result.mask.width*result.mask.height);
 for(const label of new Set(labels))assert.ok(String(label) in result.receipt.maskPalette);
 assert.equal(labels.filter(x=>x!==0).length,result.receipt.foregroundPixels);
 assert.throws(()=>decodeMaskLabels(bytes,result.mask.width+1,result.mask.height));
 assert.throws(()=>decodeMaskLabels(bytes.subarray(0,bytes.length/2),result.mask.width,result.mask.height));
});
