import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {Readable} from 'node:stream';
import {NestFactory} from '@nestjs/core';
import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';
import {SourceFusionController} from './source-fusion.controller';
import {SourceFusionService} from '@ulpin/server/modules/usp/ingestion/source-fusion';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
import {EvidenceExceptionFilter} from './evidence.http';
import {EvidenceModule} from './evidence.module';

// Verify the production module registration without opening a port or invoking
// domain methods, so an omitted controller/provider cannot pass this check.
test('registered private fusion route/provider has bounded strict metadata and enforces received bytes/no-store without a listener',async()=>{
  const app=await NestFactory.create(EvidenceModule,{logger:false,abortOnError:false});
  try{
    const controller=app.get(SourceFusionController),service=app.get(SourceFusionService);
    assert.equal((controller as any).service,service);
    assert(Reflect.getMetadata('__guards__',SourceFusionController).includes(PrivateSpatialGuard));
    assert(Reflect.getMetadata('__exceptionFilters__',SourceFusionController).includes(EvidenceExceptionFilter));
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Source fusion metadata control').build());
    const operation=document.paths['/api/v1/usp/evidence/source-fusion/context']!.post!;
    assert.equal(operation.operationId,'POST_api_v1_usp_evidence_source_fusion_context');
    const body=operation.requestBody as any,schema=body.content['application/json'].schema;
    assert.match(body.description,/64 KiB/);assert.equal(schema.additionalProperties,false);
    assert.equal(schema.properties.sources.minItems,2);assert.equal(schema.properties.sources.maxItems,8);
    assert.equal((operation.responses['200'] as any).headers['Cache-Control'].schema.enum[0],'private, no-store');
    assert.equal((operation.responses['409'] as any).content['application/json'].schema.properties.error.properties.retryable.type,'boolean');
    let calls=0;service.assemble=async()=>{calls++;assert.fail('Rejected body must not invoke the authority service');};
    const headers=new Map<string,string>(),response={setHeader:(name:string,value:string)=>headers.set(name,value)} as any;
    const request=Object.assign(Readable.from([Buffer.alloc(64*1024+1)]),{headers:{}});
    await assert.rejects(()=>controller.context(request as any,response),(e:any)=>e.status===413);
    assert.equal(headers.get('Cache-Control'),'private, no-store');assert.equal(calls,0);
    const invalid=Object.assign(Readable.from([Buffer.from('{"sources":[],"scope":"global"}')]),{headers:{}});
    await assert.rejects(()=>controller.context(invalid as any,response));assert.equal(calls,0);
  }finally{await app.close();}
});
