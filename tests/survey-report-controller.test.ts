import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {Module} from '../apps/api/node_modules/@nestjs/common';
import {SurveyReportService} from '../packages/server/src/modules/usp/ingestion/survey-report';
import {SurveyReportController} from '../apps/api/src/modules/evidence/survey-report.controller';
import {PrivateSpatialGuard} from '../apps/api/src/modules/spatial/private-spatial.guard';
import {SURVEY_REPORT_LIMITS} from '../packages/contracts/src/survey-report';

const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
require('reflect-metadata');
const {NestFactory}=require('@nestjs/core'),{GUARDS_METADATA}=require('@nestjs/common/constants');
const {SwaggerModule,DocumentBuilder}=require('@nestjs/swagger');
@Module({controllers:[SurveyReportController],providers:[SurveyReportService]})
class SurveyReportCheckModule{}
test('private route exposes strict schema without a listener; transport pins exact document, no-store and bounded body',async()=>{
  const app=await NestFactory.create(SurveyReportCheckModule,{logger:false,bodyParser:false,abortOnError:false});
  try{
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().build());
    const route=document.paths['/api/v1/usp/evidence/survey-report/context'].post;
    assert.equal(route.operationId,'POST_api_v1_usp_evidence_survey_report_context');
    assert(route.responses['200']);assert(route.responses['422']);assert(route.responses['504']);
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA,SurveyReportController),[PrivateSpatialGuard]);
    const pin={caseId:randomUUID(),caseRevision:1,sourceId:randomUUID(),sourceRevision:1,
      sourceSha256:'a'.repeat(64),jobId:randomUUID(),resultSha256:'b'.repeat(64)};
    let calls=0;
    const controller=new SurveyReportController({inspect:async(ctx:any,input:any)=>{
      calls++;assert.equal(ctx.principal.mode,'local_demo');assert.deepEqual(input,{document:pin});
      return {document:pin}; // Technical transport stub, no evidence/acceptance claim.
    }} as any);
    const headers=new Map<string,string>(),response={setHeader:(k:string,v:string)=>headers.set(k,v)} as any;
    const request=(bytes:Buffer)=>Object.assign(Readable.from([bytes]),{headers:{},id:randomUUID()}) as any;
    const envelope=await controller.context(request(Buffer.from(JSON.stringify({document:pin}))),response);
    assert.deepEqual(envelope.data.document,pin);assert.equal(envelope.meta.scope.kind,'intake');
    assert.equal(headers.get('Cache-Control'),'private, no-store');assert.equal(calls,1);
    const oversized=request(Buffer.alloc(SURVEY_REPORT_LIMITS.requestBytes+1,32));
    await assert.rejects(()=>controller.context(oversized,response),(e:any)=>e.status===413);oversized.destroy();assert.equal(calls,1);
    await assert.rejects(()=>controller.context(request(Buffer.from('{')),response),(e:any)=>e.code==='SURVEY_REPORT_JSON');assert.equal(calls,1);
  }finally{await app.close();}
});
