import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';
import {PacketImageRegionController} from './packet-image-region.controller';
import {PacketImageRegionService} from '@ulpin/server/modules/usp/packets/image-region';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
@Module({controllers:[PacketImageRegionController],providers:[PacketImageRegionService]})
class ImageRegionLeafControlModule{}

test('private image-region leaf publishes strict acknowledged original frame and bounded provenance headers without a listener',async()=>{
  const app=await NestFactory.create(ImageRegionLeafControlModule,{logger:false,abortOnError:false});
  try{
    assert(Reflect.getMetadata('__guards__',PacketImageRegionController).includes(PrivateSpatialGuard));
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Technical image-region leaf control').build());
    const op=document.paths['/api/v1/usp/packets/sources/{sourceId}/image-region']!.post!;
    assert.equal(op.operationId,'POST_api_v1_usp_packets_sources_sourceId_image_region');
    assert.equal((op.responses['200'] as any).content['image/png'].schema.format,'binary');
    const body=(op.requestBody as any).content['application/json'].schema;
    assert.equal(body.additionalProperties,false);assert(body.required.includes('selection'));
    assert.equal(body.properties.selection.properties.selectionAcknowledged.enum[0],true);
    const provenance={output:{sha256:'a'.repeat(64)}};
    app.get(PacketImageRegionService).extract=async()=>({bytes:Buffer.from('technical PNG bytes'),provenance} as any);
    const headers=new Map<string,string>();let status:number|undefined,ended:unknown;
    const response={status:(v:number)=>{status=v;},setHeader:(k:string,v:string)=>headers.set(k,v),end:(v:unknown)=>{ended=v;}};
    await app.get(PacketImageRegionController).region('174da4ed-bb83-4726-bd2d-d3f53578de11',{},response as any);
    assert.equal(status,200);assert.equal(headers.get('Cache-Control'),'private, no-store');
    assert.equal(headers.get('X-Content-Type-Options'),'nosniff');assert.equal(headers.get('Content-Disposition'),'inline; filename="image-region.png"');
    assert.deepEqual(JSON.parse(Buffer.from(headers.get('X-Region-Provenance')!,'base64url').toString()),provenance);assert(ended);
    await assert.rejects(app.get(PacketImageRegionController).region('bad-id',{},response as any));
  }finally{await app.close();}
});
