import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';
import { IntakePlanOfferSchema, IntakePlanReceiptSchema, IntakePlanRequestSchema } from '@ulpin/contracts/usp';
import { IngestionController } from './ingestion.controller';
import { ManualIngestionService } from '@ulpin/server/modules/usp/ingestion/service';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';

@Module({ controllers: [IngestionController], providers: [PrivateSpatialGuard,
  { provide: ManualIngestionService, useValue: {} }] })
class PlanContractModule {}

const id = '10000000-0000-4000-8000-000000000001';
const request = (body: unknown) => Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { headers: {} });

test('the private plan routes publish the candidate contracts and refuse malformed writes before I/O', async () => {
  const app = await NestFactory.create(PlanContractModule, { logger: false, abortOnError: false });
  try {
    assert(Reflect.getMetadata('__guards__', IngestionController).includes(PrivateSpatialGuard));
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Plan contract').build());
    const base = '/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}';
    const offer = document.paths[`${base}/plan-reader`]!.get as any;
    const press = document.paths[`${base}/plan-readings`]!.post as any;
    assert.deepEqual(offer.responses[200].content['application/json'].schema,
      z.toJSONSchema(IntakePlanOfferSchema, { target: 'openapi-3.0' }));
    assert.deepEqual(press.responses[202].content['application/json'].schema,
      z.toJSONSchema(IntakePlanReceiptSchema, { target: 'openapi-3.0' }));
    assert.deepEqual(press.requestBody.content['application/json'].schema,
      z.toJSONSchema(IntakePlanRequestSchema, { target: 'openapi-3.0' }));
    const published = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
    for (const [route, method] of [[`${base}/plan-reader`, 'get'], [`${base}/plan-readings`, 'post']]) {
      assert.equal(published.paths[route][method]['x-runtime-verified'], false);
      const status = method === 'get' ? '200' : '202';
      const ref = published.paths[route][method].responses[status].content['application/json'].schema.$ref;
      assert.equal(published.components.schemas[ref.split('/').at(-1)].type, 'object');
    }
    const controller = app.get(IngestionController);
    await assert.rejects(controller.readPlan(id, id, request({ page: 1 }) as any));
    await assert.rejects(controller.readPlan(id, id, request({ requestKey: id, page: 9 }) as any));
    await assert.rejects(controller.planOffer('not-a-case', id));
  } finally {
    await app.close();
  }
});
