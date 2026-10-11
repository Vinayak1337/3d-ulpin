import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';
import { IntakeConfirmationSchema, IntakeTargetPageSchema, IntakeTargetSchema } from '@ulpin/contracts/usp';
import { IntakeRunController, intakeTargetQuery } from './intake-run.controller';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';

@Module({ controllers: [IntakeRunController], providers: [PrivateSpatialGuard] })
class IntakeRunTestModule {}

const id = '10000000-0000-4000-8000-000000000001';
const request = (body: unknown) => Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { headers: {} });

test('target filters are single, bounded and strict: duplicate cursors or ignored query fields cannot change a read', () => {
  assert.deepEqual(intakeTargetQuery('/api/v1/ingestion/cases/x/targets'), {});
  assert.deepEqual(intakeTargetQuery(`/targets?readiness=ready&cursor=${id}`),
    { readiness: 'ready', cursor: id });
  for (const query of ['readiness=ready&readiness=held', `cursor=${id}&cursor=${id}`, 'subject=other',
    'cursor=0', 'readiness=unknown']) {
    assert.throws(() => intakeTargetQuery(`/targets?${query}`));
  }
});

test('all five private routes publish the canonical response contracts and reject malformed writes before domain I/O',
  async () => {
    const app = await NestFactory.create(IntakeRunTestModule, { logger: false, abortOnError: false });
    try {
      assert(Reflect.getMetadata('__guards__', IntakeRunController).includes(PrivateSpatialGuard));
      const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('E1 intake run').build());
      const base = '/api/v1/ingestion/cases/{caseId}';
      const routes = [
        [`${base}/targets`, 'get', 200, IntakeTargetPageSchema],
        [`${base}/confirmations`, 'post', 202, IntakeConfirmationSchema],
        [`${base}/confirmations/{confirmationId}`, 'get', 200, IntakeConfirmationSchema],
        [`${base}/confirmations/{confirmationId}/retry`, 'post', 202, IntakeConfirmationSchema],
        [`${base}/targets/{targetId}/priority`, 'post', 200, IntakeTargetSchema],
      ] as const;
      for (const [path, method, status, schema] of routes) {
        const operation = doc.paths[path]![method] as any;
        assert(operation);
        assert.deepEqual(operation.responses[status].content['application/json'].schema,
          z.toJSONSchema(schema, { target: 'openapi-3.0' }));
        if (method === 'get') assert.equal(operation.requestBody, undefined);
      }
      const controller = app.get(IntakeRunController);
      await assert.rejects(controller.confirm(id, request({}) as any));
      await assert.rejects(controller.retry(id, id, request({ targets: [id] }) as any));
      await assert.rejects(controller.priority(id, id, request({ subject: 'other' }) as any));
    } finally {
      await app.close();
    }
  });
