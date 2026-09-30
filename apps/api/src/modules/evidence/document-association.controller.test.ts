import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {NestFactory} from '@nestjs/core';
import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';
import {DocumentAssociationService} from '@ulpin/server/modules/usp/ingestion/document-association';
import {EvidenceModule} from './evidence.module';
import {DocumentAssociationController} from './document-association.controller';

test('private association preview is registered with its real service and bounded request without a listener',async()=>{
  const app=await NestFactory.create(EvidenceModule,{logger:false,abortOnError:false});
  try{
    const controller=app.get(DocumentAssociationController) as unknown as {service:DocumentAssociationService};
    assert.equal(controller.service,app.get(DocumentAssociationService));
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Technical contract check').build());
    const operation=document.paths['/api/v1/usp/evidence/document-association/preview']?.post;
    assert.equal(operation?.operationId,'POST_api_v1_usp_evidence_document_association_preview');
    const request=(operation!.requestBody as any).content['application/json'].schema;
    assert.equal(request.properties.partIds.maxItems,25);
    assert.equal(request.properties.targets.maxItems,25);
    assert.equal(request.additionalProperties,false);
  }finally{await app.close();}
});
