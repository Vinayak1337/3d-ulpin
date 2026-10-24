import test from 'node:test';
import assert from 'node:assert/strict';
import {pdfPageCount} from '@ulpin/server/modules/cases/pdf-pages';
import {createRequire} from 'node:module';
const {jsPDF}=createRequire(import.meta.url)('jspdf');
test('counts actual PDF pages, including blank pages',async()=>{
 const doc=new jsPDF();doc.text('One',10,10);doc.addPage();doc.addPage();doc.text('Three',10,10);
 assert.equal(await pdfPageCount(new Uint8Array(doc.output('arraybuffer'))),3);
});
test('corrupt PDF cannot receive an invented page count',async()=>{
 await assert.rejects(pdfPageCount(new TextEncoder().encode('not a pdf')));
});
