import test from 'node:test';
import assert from 'node:assert/strict';
import {sourcePurpose,sourceTitle,readyToExtract} from '../apps/web/features/spatial/dataset-processing/source-purpose';
const source=(name:string,mimeType='application/pdf')=>({id:name,name,mimeType,task:'building' as const,reason:''});
test('named source profiles distinguish multi-building imagery from single-building plans',()=>{
 assert.equal(sourcePurpose(source('imagery/lake-view-orthomosaic-preview.jpg','image/jpeg')),'building');
 for(const n of [-1,0,1,2,3,4])assert.equal(sourcePurpose(source(`plans/B01-level-${n}.pdf`)),'floor-plan');
 assert.equal(sourceTitle('plans/B01-level--1.pdf'),'B01 · Basement 1');
});
test('reports and unknown images cannot inherit the legacy generic building suggestion',()=>{
 assert.equal(sourcePurpose(source('lake-view-survey-control-report.pdf')),'document');
 assert.equal(sourcePurpose(source('records/fictional-property-schedule.pdf')),'document');
 assert.equal(sourcePurpose(source('upload.png','image/png')),'unknown');
});
test('queue gate requires explicit task, valid PDF page and bounded nonempty batch',()=>{
 const valid={sourceId:'x',task:'floor-plan' as const,page:1};
 assert.equal(readyToExtract([valid]),true);
 assert.equal(readyToExtract([{...valid,task:''}]),false);
 for(const page of [0,1.5,501,NaN])assert.equal(readyToExtract([{...valid,page}]),false);
 assert.equal(readyToExtract([]),false);
 assert.equal(readyToExtract(Array(13).fill(valid)),false);
 assert.equal(readyToExtract([{...valid,task:'building',page:500}]),true);
});
