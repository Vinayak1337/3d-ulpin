import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ingestionQuotas, retentionQuotas, ingestionQuotaLines, ingestionQuotaQuery } from './ingestion-quotas.mjs';
import { objectStoreFreeBytes } from './demo-config.mjs';

const MiB = 1024 ** 2, GiB = 1024 ** 3;
const fixture = () => Object.fromEntries([
  ...ingestionQuotas.map(([, limit], i) => [`q${i}`, Math.ceil(limit * 0.75)]),
  ...retentionQuotas.map(([, , limit, mib], i) => [`r${i}`, [limit * 0.75, String(mib * MiB * 0.75)]]),
  ['streamCase', 12], ['streamRunning', 3], ['kept', String(Math.floor(3.2 * GiB))],
]);

for (const [file, alias, index] of [
  ['chunk-mapping', 'm', 0],
  ['streamed-profile', 'p', 4],
]) {
  test(`doctor ${file} busiest case stays identical to admission`, () => {
    const source = readFileSync(new URL(`../../packages/server/src/modules/usp/ingestion/${file}.ts`,
      import.meta.url), 'utf8');
    const sql = source.match(/client.query\(`(SELECT count\(\*\)::int n FROM [\s\S]*?)`,\[caseId\]\)/)[1];
    const unscoped = sql.replace(`WHERE ${alias}.case_id=$1 AND (`, 'WHERE ').replace(/\)$/, '');
    const normalize = value => value.replace(/\s+/g, ' ').trim();
    assert.equal(normalize(ingestionQuotas[index][2]),
      normalize(`SELECT COALESCE(max(n),0) FROM (${unscoped} GROUP BY ${alias}.case_id) scoped`));
  });
}

test('doctor upload slot predicate stays identical to admission, including the v2 idle window', () => {
  const source = readFileSync(new URL('../../packages/server/src/modules/usp/ingestion/large-original.ts',
    import.meta.url), 'utf8');
  const literal = name => source.match(new RegExp(`const ${name}=\u0060([\\s\\S]*?)\u0060;`))[1];
  const held = literal('heldReceipt').replace('${resumableReceipt}', literal('resumableReceipt'))
    .replace('${partActivity}', literal('partActivity'));
  const normalize = value => value.replace(/\s+/g, '');
  for (const [index, version] of [[6, 1], [9, 2]]) {
    assert.equal(normalize(ingestionQuotas[index][2]), normalize(`SELECT count(*) FROM usp_source_uploads u WHERE
      ${held} AND COALESCE(u.body->'input'->>'profile','large-original/1')='large-original/${version}'`));
  }
});

test('doctor uses one read-only transaction, prints counts only, and warns at exactly 75 percent', async () => {
  const counts = fixture();
  counts.q0 = 14;
  counts.private_row_value = 'never print this';
  let calls = 0;
  const lines = await ingestionQuotaLines(query => {
    calls++;
    assert.equal(query, ingestionQuotaQuery());
    assert.match(query, /^BEGIN READ ONLY; SET LOCAL statement_timeout='3000ms'; SELECT json_build_object\(/);
    assert.ok(query.endsWith('; ROLLBACK;'));
    assert.doesNotMatch(query, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b|SELECT \*/i);
    assert.equal((query.match(/BEGIN READ ONLY/g) || []).length, 1);
    for (const [profile, , limit, mib] of retentionQuotas) {
      assert.ok(query.includes(`WHERE profile='${profile}' GROUP BY case_id`));
      assert.ok(query.includes(`greatest(n::numeric/${limit},b::numeric/${mib * MiB}) DESC,n DESC,b DESC LIMIT 1`));
    }
    assert.ok(query.includes("'kept',(SELECT coalesce(sum(bytes),0)::text FROM sources)"));
    return JSON.stringify(counts);
  }, () => 410.5 * GiB);
  assert.equal(calls, 1);
  assert.equal(lines.length, 23);
  assert.equal(lines[0], 'PASS Ingestion mapping busiest case: 14 of 128 counted');
  assert.equal(lines[2], 'WARN Ingestion streaming busiest case: 96 of 128 counted');
  assert.ok(lines.slice(1, -1).every(line => line.startsWith('WARN')));
  assert.equal(lines.at(-1), 'PASS Storage originals: 3.2 GiB kept, 410.5 GiB free');
  assert.equal(lines.filter(line => line.includes('busiest case:') && line.includes(' sources, ')).length, 10);
  retentionQuotas.forEach(([, name, limit, mib], i) => {
    assert.equal(lines[12 + i], `WARN Ingestion ${name} busiest case: 48 of ${limit} sources, `
      + `${(mib * 0.75).toFixed(1)} of ${mib} MiB`);
  });
  assert.doesNotMatch(lines.join('\n'), /Ingestion (raster|point) sources:/);
  assert.doesNotMatch(lines.join('\n'), /never print|FAIL/);
});

test('streaming reports separate queue and dispatcher bounds, warning at each 75 percent edge', async () => {
  const source = readFileSync(new URL('../../packages/server/src/modules/usp/ingestion/streaming-vector.ts',
    import.meta.url), 'utf8');
  assert.ok(source.includes('perCase: 16, service: 64'));
  assert.equal(ingestionQuotas[3][1], 64);
  const queueSql = ingestionQuotas[3][2];
  assert.ok(queueSql.includes("i.state='queued' AND j.status='queued'"));
  assert.ok(ingestionQuotaQuery().includes("operation='streaming-vector' AND status='running'"));
  for (const key of ['q3', 'streamCase', 'streamRunning']) {
    const counts = { ...fixture(), q3: 47, streamCase: 11, streamRunning: 2 };
    for (const atEdge of [false, true]) {
      if (atEdge) counts[key]++;
      const lines = await ingestionQuotaLines(() => JSON.stringify(counts), () => 21 * GiB);
      assert.equal(lines[3], `${atEdge ? 'WARN' : 'PASS'} Ingestion streaming: ${counts.q3} of 64 queued, `
        + `${counts.streamCase} of 16 queued in busiest case, ${counts.streamRunning} of 4 running`);
    }
  }
});

test('unavailable or malformed readers skip without exposing values or failing doctor', async () => {
  for (const reader of [() => { throw new Error('private row'); }, () => 'private row', () => '{"q0":"private"}']) {
    assert.deepEqual(await ingestionQuotaLines(reader), ['SKIP Ingestion quotas (aggregate reader unavailable)',
      'SKIP Storage originals (aggregate reader unavailable)']);
  }
});

test('format profiles, labels and budgets stay identical to retention helper and contracts', () => {
  const source = readFileSync(new URL('../../packages/server/src/modules/usp/ingestion/retention-budget.ts',
    import.meta.url), 'utf8');
  assert.ok(source.includes('SELECT count(*)::int sources,coalesce(sum(bytes),0)::text bytes '));
  assert.ok(source.includes('FROM sources WHERE case_id=$1 AND profile=$2'));
  const formats = [...source.matchAll(/\w+: \['([^']+)', '([^']+)'\]/g)].map(match => match.slice(1));
  assert.deepEqual(retentionQuotas.map(quota => quota.slice(0, 2)), formats);
  const limits = readFileSync(new URL('../../packages/contracts/src/reader-limits.ts', import.meta.url), 'utf8');
  for (const [profile, , limit, mib] of retentionQuotas) {
    const file = { 'geotiff-raster-v1': 'raster-window', 'laz-point-v1': 'point-batch' }[profile]
      || profile.replace('-native-v1', '-ingestion');
    const moved = limits.split(`// usp/${file}.ts`)[1]?.split(/\r?\n\r?\n/)[0];
    const contract = (moved ?? readFileSync(new URL(`../../packages/contracts/src/usp/${file}.ts`, import.meta.url),
      'utf8')).replace(/\s+/g, '');
    assert.equal(Number(contract.match(/retainedSources:(\d+)/)[1]), limit);
    assert.equal(Number(contract.match(/retainedBytes:(\d+)\*1024\*1024/)[1]), mib);
  }
});

test('each format warns independently at the exact count or byte edge, not one below', async () => {
  for (const edge of ['below', 'count', 'bytes']) {
    const counts = fixture();
    ingestionQuotas.forEach(([, limit], i) => { counts[`q${i}`] = Math.ceil(limit * 0.75) - 1; });
    counts.streamCase = 11;
    counts.streamRunning = 2;
    retentionQuotas.forEach(([, , limit, mib], i) => {
      counts[`r${i}`] = [limit * 0.75 - (edge === 'count' ? 0 : 1),
        String(mib * MiB * 0.75 - (edge === 'bytes' ? 0 : 1))];
    });
    const lines = await ingestionQuotaLines(() => JSON.stringify(counts), () => 21 * GiB);
    assert.ok(lines.slice(0, 12).every(line => line.startsWith('PASS')));
    assert.ok(lines.slice(12, -1).every(line => line.startsWith(edge === 'below' ? 'PASS' : 'WARN')));
  }
});

test('storage warns strictly below the greater of 20 GiB and kept bytes, including exact byte edges', async () => {
  for (const kept of [0, 19 * GiB, 20 * GiB, 21 * GiB]) {
    const required = Math.max(20 * GiB, kept);
    for (const delta of [-1, 0, 1]) {
      const counts = { ...fixture(), kept: String(kept) };
      const lines = await ingestionQuotaLines(() => JSON.stringify(counts), () => BigInt(required + delta));
      assert.ok(lines.at(-1).startsWith(delta < 0 ? 'WARN Storage' : 'PASS Storage'));
    }
  }
});

test('only storage skips for missing or wrong volume bindings or invalid free-byte probes', async () => {
  const minio = { id: 'object-store', mounts: [
    { Type: 'volume', Destination: '/data', Name: 'test-project_minio-data' },
  ] };
  const runtime = { docker: (...args) => {
    assert.deepEqual(args, ['exec', minio.id, 'stat', '-f', '-c', '%a %S', '/data']);
    return `${21 * GiB / 4096} 4096`;
  } };
  assert.equal(objectStoreFreeBytes('test-project', runtime, minio), BigInt(21 * GiB));
  for (const probe of [
    undefined,
    () => objectStoreFreeBytes('test-project', runtime, null),
    () => objectStoreFreeBytes('test-project', runtime, { ...minio, mounts: [] }),
    () => objectStoreFreeBytes('wrong-project', runtime, minio),
    () => objectStoreFreeBytes('test-project', { docker: () => 'private probe output' }, minio),
  ]) {
    const lines = await ingestionQuotaLines(() => JSON.stringify(fixture()), probe);
    assert.equal(lines.length, 23);
    assert.ok(lines.slice(0, -1).every(line => line.startsWith('WARN')));
    assert.equal(lines.at(-1), 'SKIP Storage originals (object-storage free bytes unavailable)');
  }
});
