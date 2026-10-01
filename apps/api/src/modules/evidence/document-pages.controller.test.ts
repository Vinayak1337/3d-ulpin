import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {NestFactory} from '@nestjs/core';
import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';
import {EvidenceModule} from './evidence.module';
import {DocumentPagesController} from './document-pages.controller';
import {DocumentPagesService} from '@ulpin/server/modules/usp/ingestion/document-pages';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

test('private page GETs use the actual evidence provider and pinned binary/metadata contracts without a listener',async()=>{
  const app=await NestFactory.create(EvidenceModule,{logger:false,abortOnError:false});
  try{
    const controller=app.get(DocumentPagesController) as unknown as {service:DocumentPagesService};
    assert.equal(controller.service,app.get(DocumentPagesService));
    assert(Reflect.getMetadata('__guards__',DocumentPagesController).includes(PrivateSpatialGuard));
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Technical PDF page route control').build());
    const metadata=document.paths['/api/v1/sources/{sourceId}/pages']!.get!;
    const raster=document.paths['/api/v1/sources/{sourceId}/pages/{page}/raster']!.get!;
    assert.equal(metadata.operationId,'GET_api_v1_sources_sourceId_pages');assert.equal(raster.operationId,'GET_api_v1_sources_sourceId_pages_page_raster');
    for(const operation of [metadata,raster])for(const name of ['revision','sha256'])assert((operation.parameters as any[]).some(p=>p.name===name&&p.required));
    const schema=(metadata.responses['200'] as any).content['application/json'].schema;
    assert.equal(schema.properties.pages.maxItems,50);assert.equal(schema.properties.pages.items.properties.calibration.nullable,true);
    assert.equal((raster.responses['200'] as any).content['image/png'].schema.format,'binary');
    await assert.rejects(app.get(DocumentPagesController).pages('174da4ed-bb83-4726-bd2d-d3f53578de11',{url:'/?revision=1&revision=2',originalUrl:'/?revision=1&revision=2'} as any),/one exact value/);
  }finally{await app.close();}
});
