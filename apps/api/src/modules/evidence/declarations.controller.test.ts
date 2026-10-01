import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {Readable} from 'node:stream';
import {NestFactory} from '@nestjs/core';
import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';
import {DeclarationsController} from './declarations.controller';
import {EvidenceModule} from './evidence.module';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
import {EvidenceExceptionFilter} from './evidence.http';

// Checks actual registration and private boundaries without services or domain writes.
test('production evidence module registers all private declaration leaves and rejects invalid bodies before domain calls',async()=>{
  const app=await NestFactory.create(EvidenceModule,{logger:false,abortOnError:false});
  try{
    const controller=app.get(DeclarationsController);
    assert(Reflect.getMetadata('__guards__',DeclarationsController).includes(PrivateSpatialGuard));
    assert(Reflect.getMetadata('__exceptionFilters__',DeclarationsController).includes(EvidenceExceptionFilter));
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Declaration registration control').build());
    const routes=[['prepare','prepare'],['proposal','proposal'],['review','review'],['accept','accept'],['selected-target','selected']] as const;
    for(const [path,method] of routes){
      const operation=document.paths[`/api/v1/usp/rights/declarations/${path}`]?.post;
      assert(operation,`Registered ${path}`);
      assert.equal(operation.operationId,`POST_api_v1_usp_rights_declarations_${path.replaceAll('-','_')}`);
      assert(operation.responses['200']);
      const headers=new Map<string,string>();
      const req=Object.assign(Readable.from([Buffer.from('{}')]),{headers:{}});
      const res={setHeader:(name:string,value:string)=>headers.set(name,value)};
      await assert.rejects(()=>controller[method](req as any,res as any));
      assert.equal(headers.get('Cache-Control'),'private, no-store');
    }
  }finally{await app.close();}
});
