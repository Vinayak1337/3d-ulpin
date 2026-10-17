import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
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
