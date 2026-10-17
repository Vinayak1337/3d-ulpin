import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  proposeMapping, mappingContextFromColumnProfile, manualTeacherPlan,
} from '../../packages/server/src/modules/usp/ingestion/mapping-teacher';
import { rememberMapping } from '../../packages/server/src/modules/usp/ingestion/mapping-memory';
import type { MappingPlanV2 } from '../../packages/contracts/src/index';
import type { TableInventory } from './t1-profiles';
import { requestContext } from './control-runtime';

const tables: TableInventory[] = JSON.parse(
  readFileSync('E:/BhuAayam-data/task-data/t1/verifier/inventory.json', 'utf8'));
const table = tables[0];
const options = { context: requestContext,
  dataPolicy: { dataClass: 'public' as const, split: 'development' as const }, authorize: async () => {} };
const memoryPath = () => `E:/BhuAayam-data/task-data/a4/memory/routing-test-${randomUUID()}.jsonl`;

function labelledPlan(): MappingPlanV2 {
  const receipt = JSON.parse(readFileSync('docs/evidence/gf-agent/t1/verify.json', 'utf8'));
  const normalized = readFileSync(`${receipt.outputDirectory}/normalized-labels.jsonl`, 'utf8').split('\n')[0];
  return JSON.parse(normalized).plan;
}

test('accepted exact memory plan avoids both local student and teacher calls', async () => {
  const path = memoryPath();
  const plan = labelledPlan();
  rememberMapping(plan, mappingContextFromColumnProfile(table.profile), {
    source: 'teacher', method: plan.method, labelFileSha256: 'b'.repeat(64),
  }, path);
  const result = await proposeMapping(table.profile, { ...options, memoryPath: path,
    teacher: async () => { throw new Error('Teacher must not be called on an exact memory hit.'); } });
  assert.equal(result.attempts, 0);
  assert(result.fieldSources.every(field => field.source === 'memory'));
});

test('held-out policy never dispatches a teacher and records honest missing student version', async () => {
  let calls = 0;
  const result = await proposeMapping(table.profile, { ...options, memoryPath: memoryPath(),
    dataPolicy: { dataClass: 'public', split: 'held_out' }, teacher: async profile => {
      calls++;
      return manualTeacherPlan(profile, 'TEACHER_UNAVAILABLE');
    } });
  assert.equal(calls, 0);
  assert.equal(result.state, 'needs_input');
  assert.equal(result.activeLearnerVersion, null);
  assert(result.issues.some(issue => issue.code === 'TEACHER_DATA_DENIED'));
});

test('actual local NPZ student is invoked before dev replay teacher', async () => {
  let calls = 0;
  const result = await proposeMapping(table.profile, { ...options, memoryPath: memoryPath(),
    learnerModelPath: 'E:/BhuAayam-data/task-data/a4/learner/v43', teacher: async profile => {
      calls++;
      return manualTeacherPlan(profile, 'TEACHER_REPLAY_UNAVAILABLE');
    } });
  assert.equal(result.activeLearnerVersion, 'v43');
  assert.equal(result.studentReasonCode, null);
  assert(calls <= 1);
  assert.equal(result.plan.fields.length, table.profile.columns.length);
});
