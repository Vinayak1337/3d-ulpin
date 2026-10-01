import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { PacketPlansController } from './packet-plans.controller';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';
import { EvidenceExceptionFilter } from './evidence.http';

// Leaf registration control only; the lead owns production EvidenceModule registration.
@Module({ controllers: [PacketPlansController] })
class PacketPlanControlModule {}
test('private plan leaf exposes bounded strict contracts and denies invalid bodies before domain I/O', async () => {
  const app = await NestFactory.create(PacketPlanControlModule, { logger: false, abortOnError: false });
  try {
    const controller = app.get(PacketPlansController);
    assert(Reflect.getMetadata('__guards__', PacketPlansController).includes(PrivateSpatialGuard));
    assert(Reflect.getMetadata('__exceptionFilters__', PacketPlansController).includes(EvidenceExceptionFilter));
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Packet plan leaf control').build());
    for (const method of ['create', 'read', 'revise', 'confirm', 'execute'] as const) {
      assert.equal(doc.paths[`/api/v1/usp/packets/plans/${method}`]?.post?.operationId, `POST_api_v1_usp_packets_plans_${method}`);
      const headers = new Map<string, string>();
      const req = Object.assign(Readable.from([Buffer.from('{}')]), { headers: {} });
      await assert.rejects(() => controller[method](req as any, { setHeader: (k: string, v: string) => headers.set(k, v) } as any));
      assert.equal(headers.get('Cache-Control'), 'private, no-store');
    }
  } finally { await app.close(); }
});
