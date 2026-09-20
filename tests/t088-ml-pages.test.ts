import test from 'node:test';
import assert from 'node:assert/strict';
import {pdfPageCount} from '../apps/web/lib/server/pdf-pages';
import {readyToExtract} from '../apps/web/features/spatial/dataset-processing/source-purpose';
import {createRequire} from 'node:module';
const {jsPDF}=createRequire(import.meta.url)('../apps/web/node_modules/jspdf');
test('counts actual PDF pages, including blank pages',async()=>{
 const doc=new jsPDF();doc.text('One',10,10);doc.addPage();doc.addPage();doc.text('Three',10,10);
 assert.equal(await pdfPageCount(new Uint8Array(doc.output('arraybuffer'))),3);
});
test('corrupt PDF cannot receive an invented page count',async()=>{
 await assert.rejects(pdfPageCount(new TextEncoder().encode('not a pdf')));
});
test('selection bounds use the actual document pages and single-image scope',()=>{
 const source={id:'pdf',name:'plans/test.pdf',mimeType:'application/pdf',task:'floor-plan' as const,reason:'',pageCount:3};
 const item={sourceId:'pdf',task:'floor-plan' as const,page:3};
 assert.equal(readyToExtract([item],[source]),true);
 assert.equal(readyToExtract([{...item,page:4}],[source]),false);
 assert.equal(readyToExtract([item],[{...source,pageCount:null}]),false);
 assert.equal(readyToExtract([item],[{...source,mimeType:'image/png'}]),false);
});
