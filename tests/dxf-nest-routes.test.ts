import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';


import {AppModule} from '../apps/api/src/app.module';
import {createApiDocument} from '../apps/api/src/openapi';
import {DXFController} from '../apps/api/src/modules/ingestion/dxf.controller';
import {PrivateSpatialGuard} from '../apps/api/src/modules/spatial/private-spatial.guard';

const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
require('reflect-metadata');
const {NestFactory}=require('@nestjs/core'),{GUARDS_METADATA,HEADERS_METADATA}=require('@nestjs/common/constants');

test('five private DXF routes have native schema metadata without a listener or generated-file write',async()=>{
  const app=await NestFactory.create(AppModule,{logger:false,bodyParser:false,abortOnError:false});
  try{
    const document=createApiDocument(app),routes=Object.entries(document.paths).filter(([path])=>/\/dxf(?:\/|$)/.test(path));
    assert.equal(routes.length,5);
    for(const [path,item] of routes){
      const operation=(item!.post??item!.get)!;assert.match(operation.operationId!,/_dxf(?:_|$)/);
      const status=path.endsWith('/dxf')?'201':path.endsWith('/retries')?'202':'200';assert.ok(operation.responses[status]);
    }
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA,DXFController),[PrivateSpatialGuard]);
    for(const method of ['retain','enqueue','status','artifact','original'] as const){
      const headers=Reflect.getMetadata(HEADERS_METADATA,DXFController.prototype[method]);
      assert.ok(headers.some((h:any)=>h.name==='Cache-Control'&&h.value==='private, no-store'));
      assert.ok(headers.some((h:any)=>h.name==='X-Content-Type-Options'&&h.value==='nosniff'));
    }
    const controller=new DXFController({} as any),request={originalUrl:'/private?localPath=outside'} as any;
    await assert.rejects(()=>controller.retain('case',request),(e:any)=>e.code==='DXF_QUERY');
    assert.throws(()=>controller.enqueue('case','source',request),(e:any)=>e.code==='DXF_QUERY');
    assert.throws(()=>controller.status('case','source','job',request),(e:any)=>e.code==='DXF_QUERY');
    await assert.rejects(()=>controller.artifact('case','source','job',request,{} as any),(e:any)=>e.code==='DXF_QUERY');
    await assert.rejects(()=>controller.original('case','source',request,{} as any),(e:any)=>e.code==='DXF_QUERY');
  }finally{await app.close();}
});
