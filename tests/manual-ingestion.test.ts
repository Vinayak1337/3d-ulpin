import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { MappingOperationSchema } from '../packages/contracts/src/usp/ingestion';

test('manual operation contract rejects literals and expressions at the executable boundary', () => {
  const operation={target:'building.sourceKey',sourcePath:'/features/*/properties/doitt_id',conversionId:'literal_identifier@1'};
  assert.ok(MappingOperationSchema.safeParse(operation).success);
  for(const extra of [{factor:0.3048},{sourceCrs:'EPSG:4326'},{coordinates:[0,0]},{entityId:'invented'},{tool:'execute'}])
    assert.equal(MappingOperationSchema.safeParse({...operation,...extra}).success,false);
  for(const sourcePath of ['353927','EPSG:4326','$.features.map(x => x.id)','/features/0/geometry'])
    assert.equal(MappingOperationSchema.safeParse({...operation,sourcePath}).success,false);
  assert.equal(MappingOperationSchema.safeParse({...operation,conversionId:'eval@1'}).success,false);
});

test('native metadata retains all baseline operations and admits only declared ingestion additions',async()=>{
  const requireApi=createRequire(new URL('../apps/api/package.json',import.meta.url));requireApi('reflect-metadata');
  const {NestFactory}=requireApi('@nestjs/core');
  const {AppModule}=await import('../apps/api/src/app.module');
  const {createApiDocument}=await import('../apps/api/src/openapi');
  const app=await NestFactory.create(AppModule,{logger:false,bodyParser:false,abortOnError:false});
  try{
    const document=createApiDocument(app);
    const baseline=JSON.parse(await readFile(new URL('../docs/orchestration/nestjs-operation-ledger.json',import.meta.url),'utf8'));
    const accepted=JSON.parse(await readFile(new URL('../docs/api/openapi.json',import.meta.url),'utf8'));
    const additions=JSON.parse(await readFile(new URL('../apps/api/src/modules/ingestion/operation-manifest.json',import.meta.url),'utf8'));
    for(const operation of baseline.operations){
      const actual=document.paths[operation.path]?.[operation.method.toLowerCase()] as any;
      assert.equal(actual?.operationId,operation.operationId);
      assert.equal(actual['x-disposition'],accepted.paths[operation.path][operation.method.toLowerCase()]['x-disposition']);
    }
    for(const operation of additions.operations){
      const actual=document.paths[operation.path]?.[operation.method.toLowerCase()] as any;
      assert.equal(actual?.operationId,operation.operationId);assert.equal(actual['x-disposition'],'added');
      assert.equal(actual['x-operation-manifest'],'apps/api/src/modules/ingestion/operation-manifest.json');
      const published=accepted.paths[operation.path]?.[operation.method.toLowerCase()];
      assert.equal(actual['x-runtime-verified'],published?.['x-runtime-verified']??false);
      assert.equal(actual['x-batch'],operation.batch??additions.batch);
    }
    const operations=Object.values(document.paths).flatMap(item=>Object.values(item||{})).filter((item:any)=>item?.operationId);
    assert.equal(operations.length,baseline.operations.length+additions.operations.length);
  }finally{await app.close();}
});
