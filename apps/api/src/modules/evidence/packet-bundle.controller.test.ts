import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';
import {PacketBundleController} from './packet-bundle.controller';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
import {EvidenceExceptionFilter} from './evidence.http';

// Leaf module only: production registration and API publication belong to lead.
@Module({controllers:[PacketBundleController]}) class BundleLeafModule{}
test('private bundle leaf declares binary ZIP route and refuses invalid IDs/query fields before domain I/O',async()=>{
  const app=await NestFactory.create(BundleLeafModule,{logger:false,abortOnError:false});
  try{
    assert(Reflect.getMetadata('__guards__',PacketBundleController).includes(PrivateSpatialGuard));
    assert(Reflect.getMetadata('__exceptionFilters__',PacketBundleController).includes(EvidenceExceptionFilter));
    const doc=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Private packet bundle leaf').build()),
      route=doc.paths['/api/v1/usp/packets/pdf/{packetId}/bundle']?.get;
    assert.equal(route?.operationId,'GET_api_v1_usp_packets_pdf_packetId_bundle');assert(route?.responses['200']);
    assert((route!.responses['200'] as any).content['application/zip']);
    const controller=app.get(PacketBundleController),headers=new Map<string,string>(),res={setHeader:(k:string,v:string)=>headers.set(k,v)};
    await assert.rejects(()=>controller.bundle('invalid-id',{url:'/'} as any,res as any));
    await assert.rejects(()=>controller.bundle('00000000-0000-4000-8000-000000000001',{url:'/?path=private'} as any,res as any),
      (error:any)=>error.code==='PACKET_PDF_QUERY');
    assert.equal(headers.get('Cache-Control'),'private, no-store');assert.equal(headers.get('X-Content-Type-Options'),'nosniff');
  }finally{await app.close();}
});
