import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';
import { IntakeEvidenceConfirmationSchema, IntakeEvidencePageSchema, IntakeKeyProfileSchema }
  from '@ulpin/contracts/usp';
import { ManualIngestionService } from '@ulpin/server/modules/usp/ingestion/service';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { IngestionController } from './ingestion.controller';
import { IntakeRunController } from './intake-run.controller';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';

@Module({ controllers: [IngestionController, IntakeRunController],
  providers: [PrivateSpatialGuard, { provide: ManualIngestionService, useValue: {} }] })
class IntakeEvidenceTestModule {}

const id = '10000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);
const body = (value: unknown) => Object.assign(Readable.from([Buffer.from(JSON.stringify(value))]), { headers: {} });
const notBuilt = (error: unknown) => error instanceof AppError && error.status === 501
  && error.code === 'INTAKE_EVIDENCE_NOT_BUILT' && /Nothing was stored or read/.test(error.message);
const profile = { requestKey: id, version: 'exact-key/1', namespace: 'Survey building number', kind: 'text',
  map: { anchorItemId: id, sourcePath: '/features/*/properties/BIN' },
  tables: [{ itemId: id, selection: { format: 'csv', sheet: 'csv', table: null, headerRows: [1] }, columnIndex: 0 }],
  documents: [] };
const confirm = { requestKey: id, acknowledgement: 'I checked each row against its building.', profileId: id,
  profileSha256: hash, excluded: [], additions: { kind: 'no_additions' },
  included: [{ itemId: id, sourceId: id, sourceRevision: 1, sourceSha256: hash, bytes: 10, jobId: id,
    resultSha256: hash, coverage: { state: 'closed', read: 2, eligible: 2, keyless: 0, unread: 0, failed: 0 } }],
  targets: [{ targetId: id, packageId: id, packageRevision: 1, reviewFingerprint: hash }] };

test('the three batch-evidence routes publish their contracts and a 501, and check input before refusing',
  async () => {
    const app = await NestFactory.create(IntakeEvidenceTestModule, { logger: false, abortOnError: false });
    try {
      const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('AU4-B1 evidence').build());
      const base = '/api/v1/ingestion/cases/{caseId}/intake/evidence';
      const routes = [
        [base, 'get', 200, IntakeEvidencePageSchema],
        [`${base}/key-profiles`, 'post', 201, IntakeKeyProfileSchema],
        [`${base}/confirmations`, 'post', 202, IntakeEvidenceConfirmationSchema],
      ] as const;
      for (const [path, method, status, schema] of routes) {
        const operation = doc.paths[path]![method] as any;
        assert.deepEqual(operation.responses[status].content['application/json'].schema,
          z.toJSONSchema(schema, { target: 'openapi-3.0' }));
        assert(operation.responses[501], `${path} names its 501 refusal`);
      }
      const ingestion = app.get(IngestionController);
      const run = app.get(IntakeRunController);
      const url = `/api/v1/ingestion/cases/${id}/intake/evidence`;
      assert.throws(() => ingestion.intakeEvidence(id, { originalUrl: `${url}?outcome=matched` } as any), notBuilt);
      for (const query of ['outcome=matched&outcome=no_match', 'subject=other', 'outcome=absent', 'cursor=0']) {
        assert.throws(() => ingestion.intakeEvidence(id, { originalUrl: `${url}?${query}` } as any),
          error => !notBuilt(error));
      }
      await assert.rejects(ingestion.keyProfile(id, body(profile) as any), notBuilt);
      await assert.rejects(run.confirmEvidence(id, body(confirm) as any), notBuilt);
      for (const [call, value] of [
        [ingestion.keyProfile.bind(ingestion), { ...profile, kind: 'number' }],
        [ingestion.keyProfile.bind(ingestion), { ...profile, rights: 'owner' }],
        [run.confirmEvidence.bind(run), { ...confirm, targets: [] }],
        [run.confirmEvidence.bind(run), { ...confirm, rights: 'owner' }],
      ] as const) await assert.rejects(call(id, body(value) as any), error => !notBuilt(error));
      await assert.rejects(ingestion.keyProfile('not-a-case', body(profile) as any), error => !notBuilt(error));
    } finally {
      await app.close();
    }
  });
