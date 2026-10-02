import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { PropertyCardController } from './property-card.controller';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';
import { EvidenceExceptionFilter } from './evidence.http';

// Test-only registration. Shared EvidenceModule/publication remains lead-owned.
@Module({ controllers: [PropertyCardController], providers: [PrivateSpatialGuard] })
class CardControlModule {}
test('private card boundary publishes strict schemas and rejects invalid body/exact revision before domain I/O', async () => {
  const app = await NestFactory.create(CardControlModule, { logger: false, abortOnError: false });
  try {
    const controller = app.get(PropertyCardController);
    assert(Reflect.getMetadata('__guards__', PropertyCardController).includes(PrivateSpatialGuard));
    assert(Reflect.getMetadata('__exceptionFilters__', PropertyCardController).includes(EvidenceExceptionFilter));
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('CARD-01 leaf').build());
    assert.equal(doc.paths['/api/v1/usp/property-cards/generate']?.post?.operationId, 'POST_api_v1_usp_property_cards_generate');
    assert.equal(doc.paths['/api/v1/usp/property-cards/read']?.post?.operationId, 'POST_api_v1_usp_property_cards_read');
    assert(doc.paths['/api/v1/usp/property-cards/{cardId}/revisions/{revision}']?.get);
    const headers = new Map<string, string>(), res = { setHeader: (k: string, v: string) => headers.set(k, v) };
    for (const method of ['generate', 'read'] as const) {
      const req = Object.assign(Readable.from([Buffer.from('{}')]), { headers: {} });
      await assert.rejects(() => controller[method](req as any, res as any));
    }
    for (const revision of ['0', '1e0', '1/2', '2147483648'])
      await assert.rejects(() => controller.resolve({ headers: {} } as any, res as any, '00000000-0000-4000-8000-000000000001', revision));
    assert.equal(headers.get('Cache-Control'), 'private, no-store');
  } finally { await app.close(); }
});
