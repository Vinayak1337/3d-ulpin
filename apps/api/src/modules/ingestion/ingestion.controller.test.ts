import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';
import type { Pool } from 'pg';
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

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'intake-evidence-controller-protocol';
const id = '10000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);
const body = (value: unknown) => Object.assign(Readable.from([Buffer.from(JSON.stringify(value))]), { headers: {} });
const profile = { requestKey: id, version: 'exact-key/1', namespace: 'Survey building number', kind: 'text',
  map: { anchorItemId: id, sourcePath: '/features/*/properties/BIN' },
  tables: [{ itemId: id, selection: { format: 'csv', sheet: 'csv', table: null, headerRows: [1] }, columnIndex: 0 }],
  documents: [] };
const confirm = { requestKey: id, acknowledgement: 'I checked each row against its building.', profileId: id,
  profileSha256: hash, excluded: [], additions: { kind: 'no_additions' },
  included: [{ itemId: id, sourceId: id, sourceRevision: 1, sourceSha256: hash, bytes: 10, jobId: id,
    resultSha256: hash, coverage: { state: 'closed', read: 2, eligible: 2, keyless: 0, unread: 0, failed: 0 } }],
  targets: [{ targetId: id, packageId: id, packageRevision: 1, reviewFingerprint: hash }] };

// Each refusal here comes before any store is opened: no database runs in this test.
const refused = (error: unknown) => error instanceof z.ZodError
  || error instanceof AppError && [422].includes(error.status);

test('the three batch-evidence routes publish their contracts and refuse bad input before reading or storing',
  async () => {
    const app = await NestFactory.create(IntakeEvidenceTestModule, { logger: false, abortOnError: false });
    try {
      const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('AU4-B2 evidence').build());
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
        assert.equal(operation.responses[501], undefined, `${path} no longer answers 501`);
      }
      assert.match(doc.paths[`${base}/confirmations`]!.post!.summary!, /nothing is written to the registry/);
      const featureParam = doc.paths[base]!.get!.parameters!.find((param: any) => param.name === 'featureId');
      assert.deepEqual((featureParam as any).schema, { type: 'string', format: 'uuid' });
      const ingestion = app.get(IngestionController);
      const run = app.get(IntakeRunController);
      const url = `/api/v1/ingestion/cases/${id}/intake/evidence`;
      for (const query of ['outcome=matched&outcome=no_match', 'subject=other', 'outcome=absent', 'cursor=0',
        'featureId=not-a-uuid', `featureId=${id}&featureId=${id}`]) {
        assert.throws(() => ingestion.intakeEvidence(id, { originalUrl: `${url}?${query}` } as any), refused);
      }
      await assert.rejects(ingestion.intakeEvidence('not-a-case', { originalUrl: url } as any), refused);
      const globals = globalThis as unknown as { ulpinPool?: Pool }, saved = globals.ulpinPool;
      const seen: unknown[][] = [];
      const query = async (sql: string, args: unknown[] = []) => {
        if (sql.includes('SELECT candidate FROM')) seen.push(args);
        const rows = sql.includes('SELECT id,revision,archived FROM cases')
          ? [{ id, revision: 1, archived: false }] : [];
        return { rows, rowCount: rows.length };
      };
      try {
        globals.ulpinPool = { query, connect: async () => ({ query, release() {} }) } as never;
        await ingestion.intakeEvidence(id, { originalUrl: `${url}?featureId=${id}` } as any);
        assert.equal(seen.length, 1);
        assert.equal(seen[0][5], id, 'featureId reaches the candidate SQL through readIntakeEvidence');
      } finally {
        globals.ulpinPool = saved;
      }
      for (const [call, value] of [
        [ingestion.keyProfile.bind(ingestion), { ...profile, kind: 'number' }],
        [ingestion.keyProfile.bind(ingestion), { ...profile, rights: 'owner' }],
        [ingestion.keyProfile.bind(ingestion), { ...profile, map: { ...profile.map, sourcePath: '/features/*/id' } }],
        [run.confirmEvidence.bind(run), { ...confirm, targets: [] }],
        [run.confirmEvidence.bind(run), { ...confirm, rights: 'owner' }],
      ] as const) await assert.rejects(call(id, body(value) as any), refused);
      await assert.rejects(ingestion.keyProfile('not-a-case', body(profile) as any), refused);
      await assert.rejects(run.confirmEvidence('not-a-case', body(confirm) as any), refused);
    } finally {
      await app.close();
    }
  });
