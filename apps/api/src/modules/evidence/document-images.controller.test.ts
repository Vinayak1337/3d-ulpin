import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {NestFactory} from '@nestjs/core';
import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';
import {EvidenceModule} from './evidence.module';
import {DocumentImagesController} from './document-images.controller';
import {DocumentImagesService} from '@ulpin/server/modules/usp/ingestion/document-images';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';

test('image metadata/raster are actual private evidence providers with exact query pins and safe schemas, without a listener',async()=>{
  const app=await NestFactory.create(EvidenceModule,{logger:false,abortOnError:false});
  try{
    const controller=app.get(DocumentImagesController) as unknown as {service:DocumentImagesService};
    assert.equal(controller.service,app.get(DocumentImagesService));
    assert(Reflect.getMetadata('__guards__',DocumentImagesController).includes(PrivateSpatialGuard));
    const doc=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Technical image route control').build());
    const metadata=doc.paths['/api/v1/sources/{sourceId}/image']!.get!,raster=doc.paths['/api/v1/sources/{sourceId}/image/raster']!.get!;
    assert.equal(metadata.operationId,'GET_api_v1_sources_sourceId_image');assert.equal(raster.operationId,'GET_api_v1_sources_sourceId_image_raster');
    for(const route of [metadata,raster])for(const name of ['revision','sha256'])assert((route.parameters as any[]).some(p=>p.name===name&&p.required));
    const schema=(metadata.responses['200'] as any).content['application/json'].schema;
    assert.equal(schema.properties.calibration.nullable,true);assert.equal(schema.properties.image.properties.orientation.properties.exifValue.nullable,true);
    assert.equal((raster.responses['200'] as any).content['image/png'].schema.format,'binary');
    await assert.rejects(app.get(DocumentImagesController).image('174da4ed-bb83-4726-bd2d-d3f53578de11',{originalUrl:'/?revision=1&revision=2'} as any),/one exact value/);
  }finally{await app.close();}
});
