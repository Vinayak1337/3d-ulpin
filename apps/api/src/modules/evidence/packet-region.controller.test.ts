import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';
import {PacketRegionController} from './packet-region.controller';
import {PacketRegionService} from '@ulpin/server/modules/usp/packets/region-extract';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
@Module({controllers:[PacketRegionController],providers:[PacketRegionService]})
class RegionLeafControlModule{}
test('dedicated private region leaf exposes strict acknowledged pins and safe PNG headers without a listener',async()=>{
  const app=await NestFactory.create(RegionLeafControlModule,{logger:false,abortOnError:false});
  try{
    assert(Reflect.getMetadata('__guards__',PacketRegionController).includes(PrivateSpatialGuard));
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Technical region leaf control').build());
    const operation=document.paths['/api/v1/usp/packets/sources/{sourceId}/pages/{page}/region']!.post!;
    assert.equal(operation.operationId,'POST_api_v1_usp_packets_sources_sourceId_pages_page_region');
    assert.equal((operation.responses['200'] as any).content['image/png'].schema.format,'binary');
    const schema=(operation.requestBody as any).content['application/json'].schema;
    assert.equal(schema.additionalProperties,false);assert(schema.required.includes('selection'));
    assert.equal(schema.properties.selection.properties.selectionAcknowledged.enum[0],true);
    const service=app.get(PacketRegionService),controller=app.get(PacketRegionController);
    service.extract=async()=>({bytes:Buffer.from('technical PNG bytes'),provenance:{output:{sha256:'a'.repeat(64)}}} as any);
    const headers=new Map<string,string>();let status:number|undefined,ended:unknown;
    const response={status:(v:number)=>{status=v;},setHeader:(k:string,v:string)=>headers.set(k,v),end:(v:unknown)=>{ended=v;}};
    await controller.region('174da4ed-bb83-4726-bd2d-d3f53578de11','1',{},response as any);
    assert.equal(status,200);assert.equal(headers.get('Cache-Control'),'private, no-store');
    assert.equal(headers.get('Content-Disposition'),'inline; filename="region.png"');assert(ended);
    await assert.rejects(controller.region('174da4ed-bb83-4726-bd2d-d3f53578de11','01',{},response as any));
  }finally{await app.close();}
});
