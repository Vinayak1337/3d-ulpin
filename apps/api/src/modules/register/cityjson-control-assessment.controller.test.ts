import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';
import {Readable} from 'node:stream';
import {CityJSONControlAssessmentController} from './cityjson-control-assessment.controller';
import {CityJSONControlAssessmentService} from '@ulpin/server/modules/registry/cityjson-control-assessment';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

@Module({controllers:[CityJSONControlAssessmentController],providers:[CityJSONControlAssessmentService]})
class CandidateModule{}
test('private candidate control-assessment route has bounded strict metadata without a listener',async()=>{
  const app=await NestFactory.create(CandidateModule,{logger:false,abortOnError:false});
  try{
    const controller=app.get(CityJSONControlAssessmentController),service=app.get(CityJSONControlAssessmentService);
    assert(Reflect.getMetadata('__guards__',CityJSONControlAssessmentController).includes(PrivateSpatialGuard));
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Candidate control comparison').build());
    const operation=document.paths['/api/v1/registry-drafts/{draftId}/native-exterior/control-assessment']!.post!;
    const schema=(operation.requestBody as any).content['application/json'].schema;
    assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.correspondences.maxItems,20);
    assert.equal(schema.properties.correspondences.items.properties.coordinates,undefined);
    let calls=0;service.assess=async()=>{calls++;assert.fail('Invalid requests cannot resolve private evidence');};
    const request=Object.assign(Readable.from([Buffer.alloc(16*1024+1)]),{headers:{},query:{}}) as any;
    await assert.rejects(()=>controller.assess('00000000-0000-4000-8000-000000000001',request),(error:any)=>error.status===413);
    assert.equal(calls,0);
  }finally{await app.close();}
});
