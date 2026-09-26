import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CityJsonEvidenceController, DecisionEvidenceController, OriginalEvidenceController,
  PacketEvidenceController, SnapshotEvidenceController } from './evidence.controllers';
import { EvidenceModule } from './evidence.module';
import { CityJsonEvidenceService, DecisionEvidenceService, OriginalEvidenceService,
  PacketEvidenceService, SnapshotEvidenceService } from './evidence.services';

test('native evidence controllers receive their canonical Nest provider instances', async () => {
  // Exercise the real module and decorator transform without a listener or domain calls.
  const app = await NestFactory.createApplicationContext(EvidenceModule, { logger: false, abortOnError: false });
  try {
    const pairs: readonly [Type<unknown>, Type<unknown>][] = [
      [SnapshotEvidenceController, SnapshotEvidenceService],
      [OriginalEvidenceController, OriginalEvidenceService],
      [DecisionEvidenceController, DecisionEvidenceService],
      [CityJsonEvidenceController, CityJsonEvidenceService],
      [PacketEvidenceController, PacketEvidenceService],
    ];
    for (const [controllerType, serviceType] of pairs) {
      const controller = app.get(controllerType) as { service: unknown };
      assert.equal(controller.service, app.get(serviceType), `${controllerType.name} injection`);
    }
  } finally {
    await app.close();
  }
});
