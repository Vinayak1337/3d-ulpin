import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {request as httpRequest} from 'node:http';
import type {AddressInfo} from 'node:net';
import {Readable} from 'node:stream';
import type {Request,Response,NextFunction} from 'express';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';
import {PacketRegionController} from './packet-region.controller';
import {PacketRegionService} from '@ulpin/server/modules/usp/packets/region-extract';
import {PrivateSpatialGuard} from '../spatial/private-spatial.guard';
import {JSON_BODY_LIMIT} from '../../common/body';
import {ApiExceptionFilter} from '../../common/api-exception.filter';
import {guardLocalRequest} from '../../common/request-context';
import {PacketRegionRequestSchema} from '../../../../../packages/contracts/src/packet-region';
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
    const raw=()=>Object.assign(Readable.from([Buffer.from('{}')]),{headers:{}}) as unknown as Request;
    await controller.region('174da4ed-bb83-4726-bd2d-d3f53578de11','1',raw(),response as any);
    assert.equal(status,200);assert.equal(headers.get('Cache-Control'),'private, no-store');
    assert.equal(headers.get('Content-Disposition'),'inline; filename="region.png"');assert(ended);
    await assert.rejects(controller.region('174da4ed-bb83-4726-bd2d-d3f53578de11','01',raw(),response as any));
  }finally{await app.close();}
});

test('region POST reads bounded raw JSON with bodyParser false and keeps private request guards',async()=>{
  // Retained D01 Haryana caption request fields; source authority and native
  // output remain controlled. This exercises actual Nest/raw HTTP binding.
  const sourceId='a124fb03-6ee4-4ced-8450-c67eb68dc950';
  const body={revision:'1',sha256:'2aadce88509b437bfa8ff104e7f7d51f62e05bc8fc904e26e41a43e8263b1bd1',
    purpose:'private_source_preview',selection:{frame:{kind:'pdf_display_page_top_left_points',rotation:0,width:2586,height:1694},
      mediaBox:[0,0,2586,1694],cropBox:[0,0,2586,1694],boxConvention:'pymupdf_page_rectangles/1',
      coordinates:'displayed_cropbox_normalized_top_left/1',
      region:[1820/2586,750/1694,2130/2586,825/1694],selectionAcknowledged:true}};
  const app=await NestFactory.create(RegionLeafControlModule,{logger:false,abortOnError:false,bodyParser:false});
  let port=0,calls=0;
  app.use((req:Request,res:Response,next:NextFunction)=>{
    assert.equal(req.body,undefined);guardLocalRequest(req,res,next,port,[]);
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.get(PacketRegionService).extract=async(id,page,raw)=>{
    calls++;PacketRegionRequestSchema.parse(raw);
    assert.equal(id,sourceId);assert.equal(page,1);assert.deepEqual(raw,body);
    return {bytes:Buffer.from('controlled region bytes'),provenance:{output:{sha256:'a'.repeat(64)}}} as any;
  };
  try{
    await app.listen(0,'127.0.0.1');port=(app.getHttpServer().address() as AddressInfo).port;
    const post=(bytes:Buffer,extra:Record<string,string>={})=>new Promise<{status:number;headers:Record<string,unknown>;bytes:Buffer}>((yes,no)=>{
      // No Content-Length: exercise the received-byte cap on chunked bodies.
      const req=httpRequest({hostname:'127.0.0.1',port,method:'POST',
        path:`/api/v1/usp/packets/sources/${sourceId}/pages/1/region`,
        headers:{'Content-Type':'application/json',Origin:`http://127.0.0.1:${port}`,...extra}},res=>{
        const chunks:Buffer[]=[];res.on('data',v=>chunks.push(Buffer.from(v)));
        res.once('error',no);res.once('end',()=>yes({status:res.statusCode!,headers:res.headers,bytes:Buffer.concat(chunks)}));
      });
      req.setTimeout(5000,()=>req.destroy(new Error('Raw region control timed out')));req.once('error',no);
      req.write(bytes);req.end();
    });
    const valid=await post(Buffer.from(JSON.stringify(body)));
    assert.equal(valid.status,200);assert.equal(calls,1);assert.equal(valid.headers['content-type'],'image/png');
    assert.equal(valid.headers['cache-control'],'private, no-store');assert.equal(valid.headers['x-content-type-options'],'nosniff');
    assert.equal(valid.headers['x-region-sha256'],'a'.repeat(64));assert.equal(valid.bytes.toString(),'controlled region bytes');
    for(const [bytes,status,code] of [[Buffer.from('{'),400,'INVALID_JSON'],[Buffer.alloc(0),400,'INVALID_JSON'],
      [Buffer.alloc(JSON_BODY_LIMIT+1,32),413,'FILE_SIZE']] as const){
      const refused=await post(bytes);assert.equal(refused.status,status);assert.equal(JSON.parse(refused.bytes.toString()).error.code,code);
      assert.equal(refused.headers['cache-control'],'no-store');assert.equal(calls,1);
    }
    for(const [headers,code] of [[{'sec-fetch-site':'cross-site'},'CROSS_ORIGIN_READ'],
      [{Origin:'https://unrelated.invalid'},'ORIGIN_DENIED']] as const){
      const refused=await post(Buffer.from(JSON.stringify(body)),headers);assert.equal(refused.status,403);
      assert.equal(JSON.parse(refused.bytes.toString()).error.code,code);assert.equal(calls,1);
    }
  }finally{await app.close();}
});
