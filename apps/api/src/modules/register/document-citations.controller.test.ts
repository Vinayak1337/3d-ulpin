import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {NestFactory} from '@nestjs/core';
import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';
import {RegisterModule} from './register.module';
import {RegisterController} from './register.controller';
import {RegisterService} from './register.service';

test('canonical register owns private citation routes with bounded exact selection and real provider, without listener',async()=>{
  const app=await NestFactory.create(RegisterModule,{logger:false,abortOnError:false});
  try{
    const controller=app.get(RegisterController) as unknown as {service:RegisterService};
    assert.equal(controller.service,app.get(RegisterService));
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Technical citation contract check').build());
    const path=document.paths['/api/v1/registry-drafts/{draftId}/document-citations'];
    assert.equal(path?.post?.operationId,'POST_api_v1_registry_drafts_draftId_document_citations');
    assert.equal(path?.get?.operationId,'GET_api_v1_registry_drafts_draftId_document_citations');
    const request=(path!.post!.requestBody as any).content['application/json'].schema;
    assert.equal(request.additionalProperties,false);
    assert.equal(request.properties.add.properties.partIds.maxItems,25);
    assert.equal(request.properties.remove.maxItems,25);
    assert.deepEqual(request.properties.clearAll.enum,[true]);
    assert.equal(request.required.includes('clearAll'),false);
    assert.equal('text' in request.properties,false);
  }finally{await app.close();}
});
