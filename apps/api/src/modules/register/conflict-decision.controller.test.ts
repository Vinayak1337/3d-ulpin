import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  BuildingConflictDecisionRequestSchema, BuildingConflictDecisionSchema, NormalizedBuildingSchema,
  type BuildingConflictDecision, type BuildingConflictDecisionRequest, type PhysicalFeature,
} from '@ulpin/contracts';
import {
  recordConflictFeatureRevisionTx, reviewedConflictDecision,
} from '@ulpin/server/modules/officer/canonical-conflict-decisions';
import { applyConflictDecisions, finishBuilding } from '@ulpin/server/modules/registry/canonical-building';
import { setRuntimeLoopbackPort } from '@ulpin/server/infrastructure/loopback-host';
import { OfficerController } from './officer.controller';
import { OfficerService } from './officer.service';
import { ApiExceptionFilter } from '../../common/api-exception.filter';
import { guardLocalRequest } from '../../common/request-context';

type SelectedRequest = Extract<BuildingConflictDecisionRequest, { outcome: 'selected' }>;
const retained = NormalizedBuildingSchema.parse(JSON.parse(readFileSync(
  'docs/evidence/gf-backend/k2/tower3-canonical.json', 'utf8',
)));
const reason = 'checked against site-plan page 1; contract test only, not an officer action on the live record';

function selectedRequest(): SelectedRequest {
  return BuildingConflictDecisionRequestSchema.options[0].parse({
    requestKey: randomUUID(), expectedCanonicalRevision: retained.revisionId,
    property: retained.conflicts[0].property, outcome: 'selected',
    chosenValue: retained.conflicts[0].alternatives[0].value,
    citation: retained.conflicts[0].alternatives[0].citations[0], reason,
  });
}

function checkProjection(input: SelectedRequest, decision: BuildingConflictDecision): void {
  const selected = structuredClone(retained);
  applyConflictDecisions(selected, [decision]);
  assert.equal(finishBuilding(selected).storeyLabel.state, 'reviewed');
  assert.equal(selected.storeyLabel.value, input.chosenValue);
  assert.equal(selected.conflicts.length, 0);
  assert.deepEqual(selected.resolvedConflicts![0].alternatives.map(value => value.value), ['G+41', 'G+42']);
  assert.equal(selected.storeyCount.value, null);
  const { chosenValue: _chosen, ...common } = input;
  const unresolvedInput = BuildingConflictDecisionRequestSchema.parse({ ...common, outcome: 'unresolved' });
  const unresolved = reviewedConflictDecision(retained, unresolvedInput, decision.actor, decision.time, 2);
  const unchanged = structuredClone(retained);
  applyConflictDecisions(unchanged, [unresolved]);
  assert.equal(finishBuilding(unchanged).storeyLabel.state, 'conflicting');
  assert.equal(unchanged.conflicts.length, 1);
  assert.equal(unchanged.conflictDecisions![0].outcome, 'unresolved');
}

function checkRefusals(input: SelectedRequest, decision: BuildingConflictDecision): void {
  assert.throws(() => reviewedConflictDecision(retained, {
    ...input, expectedCanonicalRevision: '0'.repeat(64),
  }, decision.actor, decision.time, 2), /Refresh/);
  assert.throws(() => reviewedConflictDecision(retained, {
    ...input, citation: { ...input.citation, locator: { kind: 'page', page: 2 } },
  }, decision.actor, decision.time, 2), /checked page/);
}

test('officer physical revisions retain the non-null original import package lineage', async () => {
  const pkg = JSON.parse(readFileSync('docs/evidence/gf-backend/k2/tower3-source-commit.json', 'utf8'));
  const feature: PhysicalFeature = pkg.features[0];
  const decision = reviewedConflictDecision(retained, selectedRequest(), 'contract-test-operator',
    '2026-10-10T00:00:00.000Z', 2);
  let inserted = false;
  const client = { query: async (sql: string, values: unknown[]) => {
    if (sql.startsWith('SELECT package_id')) return { rows: [{ package_id: pkg.id }] };
    if (sql.startsWith('INSERT INTO physical_feature_revisions')) {
      assert(sql.includes('package_id'));
      assert.equal(values[3], pkg.id);
      inserted = true;
    }
    return { rows: [] };
  } } as unknown as PoolClient;
  await recordConflictFeatureRevisionTx(client, {
    id: feature.id, area_id: pkg.areaId, revision: 1, body: feature,
  }, decision, 3);
  assert(inserted);
});

@Module({
  controllers: [OfficerController],
  providers: [{ provide: OfficerService, useValue: {
    conflictDecision: async (_id: string, raw: unknown) => reviewedConflictDecision(
      retained, BuildingConflictDecisionRequestSchema.parse(raw), 'contract-test-operator',
      '2026-10-10T00:00:00.000Z', 2,
    ),
  } }],
})
class TestModule {}

test('checked-page decision preserves alternatives for both selection and unresolved outcomes', async () => {
  const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'contract-test-operator';
  const app = await NestFactory.create(TestModule, { logger: false, bodyParser: false });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.use(guardLocalRequest);
  try {
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    setRuntimeLoopbackPort(address.port);
    const url = `http://127.0.0.1:${address.port}/api/v1/buildings/${retained.buildingId}/conflict-decisions`;
    const input = selectedRequest();
    const response = await fetch(url, { method: 'POST', headers: {
      'content-type': 'application/json', 'idempotency-key': input.requestKey,
    },
      body: JSON.stringify(input) });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const decision = BuildingConflictDecisionSchema.parse(await response.json());
    checkProjection(input, decision);
    checkRefusals(input, decision);
    const denied = await fetch(url, { method: 'POST', headers: {
      'content-type': 'application/json', 'sec-fetch-site': 'cross-site',
    }, body: JSON.stringify(input) });
    assert.equal(denied.status, 403);
  } finally {
    await app.close();
    setRuntimeLoopbackPort(undefined);
    if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
  }
});
