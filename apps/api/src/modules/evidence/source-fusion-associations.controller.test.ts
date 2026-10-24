import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {Readable} from 'node:stream';
import {NestFactory} from '@nestjs/core';
import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';
import {SourceFusionAssociationsController} from './source-fusion-associations.controller';
import {SourceFusionAssociationService} from '@ulpin/server/modules/usp/ingestion/source-fusion-associations';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
import {EvidenceExceptionFilter} from './evidence.http';
import {EvidenceModule} from './evidence.module';

// Exercise actual production registration without a listener or domain calls.
test('registered private proposal controller has strict bounded metadata and rejects excess bytes without a listener',async()=>{
  const app=await NestFactory.create(EvidenceModule,{logger:false,abortOnError:false});
  try{
    const controller=app.get(SourceFusionAssociationsController),service=app.get(SourceFusionAssociationService);
    assert.equal((controller as any).service,service);
    assert(Reflect.getMetadata('__guards__',SourceFusionAssociationsController).includes(PrivateSpatialGuard));
    assert(Reflect.getMetadata('__exceptionFilters__',SourceFusionAssociationsController).includes(EvidenceExceptionFilter));
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Proposal candidate metadata control').build());
    const operation=document.paths['/api/v1/usp/evidence/source-fusion/association-proposals']!.post!;
    assert.equal(operation.operationId,'POST_api_v1_usp_evidence_source_fusion_association_proposals');
    const body=operation.requestBody as any,schema=body.content['application/json'].schema;
    assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.targets.maxItems,8);
    assert.equal(schema.properties.context.properties.selection.properties.sources.minItems,2);
    assert.match(body.description,/64 KiB/);
    assert.equal((operation.responses['200'] as any).headers['Cache-Control'].schema.enum[0],'private, no-store');
    let calls=0;service.propose=async()=>{calls++;assert.fail('Invalid body cannot call authority or inference');};
    const headers=new Map<string,string>(),response={setHeader:(name:string,value:string)=>headers.set(name,value)} as any;
    await assert.rejects(()=>controller.propose(Object.assign(Readable.from([Buffer.alloc(64*1024+1)]),{headers:{}}) as any,response),
      (error:any)=>error.status===413);
    await assert.rejects(()=>controller.propose(Object.assign(Readable.from([Buffer.from('{"context":{},"model":"caller-route"}')]),{headers:{}}) as any,response));
    assert.equal(calls,0);assert.equal(headers.get('Cache-Control'),'private, no-store');
  }finally{await app.close();}
});
