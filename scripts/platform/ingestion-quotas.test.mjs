import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ingestionQuotas, ingestionQuotaLines, ingestionQuotaQuery } from './ingestion-quotas.mjs';

test('doctor mapping count stays identical to admission', () => {
  const source = readFileSync(new URL('../../packages/server/src/modules/usp/ingestion/chunk-mapping.ts',
    import.meta.url), 'utf8');
  const sql = source.match(/client.query\(`(SELECT count\(\*\)::int n FROM usp_chunk_mapping_imports m[\s\S]*?)`\)/)[1];
  const normalize = value => value.replace(/\s+/g, ' ').trim();
  assert.equal(normalize(ingestionQuotas[0][2]), normalize(sql));
});

test('doctor uses one read-only transaction, prints counts only, and warns at exactly 75 percent', async () => {
  const counts = Object.fromEntries(ingestionQuotas.map(([, limit], i) => [`q${i}`, Math.ceil(limit * 0.75)]));
  counts.q0 = 14;
  counts.private_row_value = 'never print this';
  let calls = 0;
  const lines = await ingestionQuotaLines(query => {
    calls++;
    assert.equal(query, ingestionQuotaQuery());
    assert.match(query, /^BEGIN READ ONLY; SET LOCAL statement_timeout='3000ms'; SELECT json_build_object\(/);
    assert.ok(query.endsWith('; ROLLBACK;'));
    assert.doesNotMatch(query, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b|SELECT \*/i);
    return JSON.stringify(counts);
  });
  assert.equal(calls, 1);
  assert.equal(lines.length, 14);
  assert.equal(lines[0], 'PASS Ingestion mapping: 14 of 128 counted');
  assert.equal(lines[2], 'WARN Ingestion streaming busiest case: 96 of 128 counted');
  assert.ok(lines.slice(1).every(line => line.startsWith('WARN')));
  assert.ok(lines.every(line => /^(PASS|WARN) Ingestion [a-z0-9 ]+: \d+ of \d+ counted$/.test(line)));
  assert.doesNotMatch(lines.join('\n'), /never print|FAIL/);
});

test('unavailable or malformed readers skip without exposing values or failing doctor', async () => {
  for (const reader of [() => { throw new Error('private row'); }, () => 'private row', () => '{"q0":"private"}']) {
    assert.deepEqual(await ingestionQuotaLines(reader), ['SKIP Ingestion quotas (aggregate reader unavailable)']);
  }
  const lines = await ingestionQuotaLines(() => JSON.stringify(
    Object.fromEntries(ingestionQuotas.map(([, limit], i) => [`q${i}`, Math.ceil(limit * 0.75) - 1]))));
  assert.ok(lines.every(line => line.startsWith('PASS')));
});
