import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';
import {Readable} from 'node:stream';
import {CityJSONControlReviewController} from './cityjson-control-review.controller';
import {CityJSONControlReviewService} from '@ulpin/server/modules/registry/cityjson-control-review';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

@Module({controllers:[CityJSONControlReviewController],providers:[CityJSONControlReviewService]})
class CandidateModule{}
test('candidate review routes keep strict/private received-byte bounds and hide request/context fields',async()=>{
  const app=await NestFactory.create(CandidateModule,{logger:false,abortOnError:false});
  try{
    const controller=app.get(CityJSONControlReviewController),service=app.get(CityJSONControlReviewService);
    assert(Reflect.getMetadata('__guards__',CityJSONControlReviewController).includes(PrivateSpatialGuard));
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Candidate scoped control review').build());
    const path='/api/v1/registry-drafts/{draftId}/native-exterior/control-assessment/reviews';
    const post=document.paths[path]!.post!,get=document.paths[path+'/{reviewId}']!.get!;
    const body=(post.requestBody as any).content['application/json'].schema;
    assert.equal(body.additionalProperties,false);assert.equal(body.properties.comparison.properties.correspondences.maxItems,20);
    const response=(get.responses['200'] as any).content['application/json'].schema;
    assert.equal(response.properties.request,undefined);assert.equal(response.properties.reviewContext,undefined);
    assert.deepEqual(response.properties.accuracy.enum,['not_assessed']);
    service.create=async()=>assert.fail('Rejected requests cannot resolve private controls');
    const oversized=Object.assign(Readable.from([Buffer.alloc(20*1024+1)]),{headers:{},query:{}}) as any;
    await assert.rejects(()=>controller.create('00000000-0000-4000-8000-000000000001',oversized),(error:any)=>error.status===413);
    assert.throws(()=>controller.read('00000000-0000-4000-8000-000000000001','a'.repeat(64),{query:{metrics:'0'}} as any),
      (error:any)=>error.status===400);
  }finally{await app.close();}
});
