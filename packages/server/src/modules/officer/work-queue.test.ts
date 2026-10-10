import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { WorkQueueTableSourcesSchema } from '../../../../contracts/src/work-queue';
import { caseTableSourceIdsSql } from './work-queue';

test('case table SQL binds retained sources to the case and table profile, newest first with no chosen winner', () => {
  const sql = caseTableSourceIdsSql.replace(/\s+/g, ' ').trim();
  assert.equal(sql, 'coalesce((SELECT jsonb_agg(s.id ORDER BY s.created_at DESC,s.id DESC) '
    + "FROM sources s WHERE s.case_id=c.id AND s.profile='tabular-manual-v1'),'[]'::jsonb)");
  assert(!sql.includes('LIMIT'));
  assert(!sql.includes('status'));
  const producer = readFileSync('packages/server/src/modules/officer/work-queue.ts', 'utf8');
  assert(producer.includes('${caseTableSourceIdsSql} "tableSourceIds"'));
  const branches = producer.split('UNION ALL');
  assert.equal(branches.length, 3);
  assert(branches[1].includes("NULL::jsonb,'[]'::jsonb"));
  assert(branches[2].includes("NULL::jsonb,'[]'::jsonb"));
});

test('table-source contract preserves the demo one-table and five-table lists, and accepts no table', () => {
  // Expected aggregation from GET /cases/{id} source metadata, not a PostgreSQL execution of changed SQL.
  const one = ['d6dffbcc-7ee0-4467-9ddf-4952bd23c33c'];
  const many = [
    '333d5cdd-9778-4fb0-a89a-61794a532497',
    'ac36d0c4-74ca-4173-a954-4431e81d299d',
    '39d29b89-1b90-46d8-91cb-3339fc6bd773',
    'ab997af8-c280-41f5-a30a-a2d6a64e8843',
    '9354378d-1cf2-4ffd-aec6-1d87ce233b28',
  ];
  for (const tableSourceIds of [one, many, []]) {
    assert.deepEqual(WorkQueueTableSourcesSchema.parse({ tableSourceIds }), { tableSourceIds });
  }
  assert(WorkQueueTableSourcesSchema.safeParse({}).success); // Older stored queue rows keep reading.
  assert(!WorkQueueTableSourcesSchema.safeParse({ tableSourceIds: null }).success);
});
