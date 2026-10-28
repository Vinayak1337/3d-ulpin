import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Pool } from 'pg';
import { LARGE_ORIGINAL_V2_LIMITS } from '@ulpin/contracts/usp';
import { LargeOriginalService } from './large-original';
import { AppError } from '../../../infrastructure/errors';
import { memoryPool, memoryStorage, withPool } from './large-original-memory.test-fixture';

// Execute the production quota SQL, translating only PostgreSQL types/time syntax for in-memory SQLite.
const reader = String.raw`
import datetime, json, sqlite3, sys
sql, params, uploads, parts, now = json.load(sys.stdin)
def epoch(value):
    return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() if value else None
db = sqlite3.connect(':memory:')
db.create_function('now', 0, lambda: now)
db.create_function('epoch', 1, epoch)
db.create_function('GREATEST', -1, lambda *v: max(x for x in v if x is not None))
db.create_function('LEAST', -1, lambda *v: min(x for x in v if x is not None))
db.executescript('''CREATE TABLE usp_source_uploads(id,case_id,operator_subject,state,original_bytes,
expires_at,lease_expires_at,created_at,body,finalize_attempts);
CREATE TABLE usp_source_upload_parts(upload_id,bytes);''')
for row in uploads:
    db.execute('INSERT INTO usp_source_uploads VALUES(?,?,?,?,?,?,?,?,?,?)',
        (row['id'],row['case_id'],row['operator_subject'],row['state'],int(row['original_bytes']),
         epoch(row['expires_at']),epoch(row.get('lease_expires_at')),epoch(row['created_at']),
         json.dumps(row['body']),row['finalize_attempts']))
for part in parts:
    db.execute('INSERT INTO usp_source_upload_parts VALUES(?,?)', (part['upload_id'],part['bytes']))
db.row_factory = sqlite3.Row
print(json.dumps(dict(db.execute(sql, params).fetchone())))
`;
function sqlRows(sql: string, params: unknown[], db: ReturnType<typeof memoryPool>['db']) {
  const compatible = sql.replace(/\(u\.body->>'partActivityAt'\)::timestamptz/g,
    "epoch(u.body->>'partActivityAt')").replaceAll("interval '10 minutes'", '600')
    .replace(/::(int|bigint|boolean|uuid)\b/g, '').replace(/\$(\d+)/g, '?$1');
  const row = JSON.parse(execFileSync('python', ['-c', reader], {
    input: JSON.stringify([compatible, params, db.uploads, db.parts, Date.now() / 1000]), encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  }));
  for (const key of ['frees_at', 'case_frees_at', 'operator_frees_at']) {
    if (typeof row[key] === 'number') row[key] = new Date(row[key] * 1000).toISOString();
  }
  return row;
}
function quotaPool(caseId: string) {
  const { db, pool } = memoryPool(caseId);
  const connect = pool.connect.bind(pool);
  const wrapped = { connect: async () => {
    const client = await connect();
    return { release: () => client.release(), query: async (sql: string, values: any[] = []) => {
      if (sql.includes('count(*) FILTER')) return { rows: [sqlRows(sql, values, db)], rowCount: 1 };
      const result = await client.query(sql, values);
      if (sql.startsWith('INSERT INTO usp_source_uploads')) db.uploads.at(-1)!.created_at = new Date();
      return result;
    } };
  } } as unknown as Pool;
  return { db, pool: wrapped };
}

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'upload-quota-test';
const doctor = readFileSync('scripts/platform/ingestion-quotas.mjs', 'utf8').match(/const held = `([\s\S]*?)`;/)![1];
const bytes = Buffer.from('x');
const partHash = createHash('sha256').update(bytes).digest('hex');
const input = () => ({ requestKey: randomUUID(), expectedCaseRevision: 0, profile: 'large-original/2',
  filename: 'transport-control.bin', mediaType: 'application/octet-stream', bytes: 1, sha256: partHash,
  provenance: { origin: 'not_stated', acquiredAt: '2026-10-24T00:00:00.000Z' } });

test('v1 idle receipts release slots at ten minutes and parts and finish reserve them again', async t => {
  const now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const caseId = randomUUID(), { db, pool } = quotaPool(caseId);
  await withPool(pool, async () => {
    const service = new LargeOriginalService(memoryStorage().storage);
    const create = () => service.create(caseId, { ...input(), profile: 'large-original/1' });
    const first = await create();
    const row = db.uploads[0]!;
    row.created_at = new Date(Date.now() - 599_000);
    await create();
    await assert.rejects(create(), error => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'UPLOAD_QUOTA');
      assert.equal((error.details as { freesAt: string }).freesAt, new Date(now + 1000).toISOString());
      assert.match(error.message, /slot reservation ends/);
      return true;
    });
    row.created_at = new Date(Date.now() - 600_000);
    const third = await create();
    assert.equal((await service.read(caseId, first.id)).state, 'receiving');
    const part = { requestKey: randomUUID(), expectedRevision: first.revision,
      expectedCaseRevision: 0, partNumber: 1, sha256: partHash };
    await assert.rejects(service.claimPart(caseId, first.id, part), { code: 'UPLOAD_QUOTA' });
    assert.equal(db.parts.length, 0);
    db.uploads[2]!.state = 'retained';
    const claim = await service.claimPart(caseId, first.id, part);
    assert.ok(row.body.partActivityAt);
    await assert.rejects(create(), { code: 'UPLOAD_QUOTA' });
    const received = await service.receivePart(claim, bytes);
    row.created_at = new Date(Date.now() - 660_000);
    row.body.partActivityAt = new Date(Date.now() - 660_000).toISOString();
    const fourth = await create();
    assert.notEqual(fourth.id, third.id);
    const finish = { requestKey: randomUUID(), expectedRevision: received.revision,
      expectedCaseRevision: received.currentCaseRevision, sha256: partHash };
    await assert.rejects(service.finalize(caseId, first.id, finish), { code: 'UPLOAD_QUOTA' });
    assert.equal(row.state, 'receiving');
    db.uploads[3]!.state = 'retained';
    assert.equal((await service.finalize(caseId, first.id, finish))!.state, 'retained');
  });
});

for (const activity of ['idle', 'created', 'claimed', 'received'] as const) {
  test(`v2 ${activity} receipt: admission and doctor agree; idle stays resumable`, async () => {
    const capacity = process.env.ULPIN_LARGE_ORIGINAL_V2_CAPACITY_BYTES;
    process.env.ULPIN_LARGE_ORIGINAL_V2_CAPACITY_BYTES =
      String(LARGE_ORIGINAL_V2_LIMITS.maxStoredBytesIncludingTemporaryCopies);
    const caseId = randomUUID(), { db, pool } = quotaPool(caseId);
    try {
      await withPool(pool, async () => {
        const storage = memoryStorage().storage;
        const put = storage.putPartObject;
        let storageMs: number | undefined;
        storage.putPartObject = async (...args) => { storageMs = args[4]; return put(...args); };
        const service = new LargeOriginalService(storage);
        const first = await service.create(caseId, input());
        const row = db.uploads[0]!;
        row.created_at = new Date(Date.now() - (activity === 'created' ? 60_000 : 660_000));
        if (activity === 'claimed' || activity === 'received') {
          const claim = await service.claimPart(caseId, first.id, { requestKey: randomUUID(),
            expectedRevision: first.revision, expectedCaseRevision: 0, partNumber: 1, sha256: partHash });
          assert.ok(row.body.partActivityAt);
          if (activity === 'received') {
            row.body.partActivityAt = new Date(Date.now() - 660_000).toISOString();
            await service.receivePart(claim, bytes);
            assert.equal(storageMs, 60_000, 'v2 uses its published storage budget, not the v1 30 seconds');
          }
        }
        const counted = sqlRows(`SELECT count(*) n FROM usp_source_uploads u WHERE ${doctor}`, [], db).n;
        assert.equal(counted, activity === 'idle' ? 0 : 1);
        if (activity !== 'idle') {
          await assert.rejects(service.create(caseId, input()), { code: 'UPLOAD_QUOTA' });
          return;
        }
        const second = await service.create(caseId, input());
        assert.notEqual(first.id, second.id);
        assert.equal((await service.read(caseId, first.id)).state, 'receiving');
        await assert.rejects(service.claimPart(caseId, first.id, { requestKey: randomUUID(),
          expectedRevision: first.revision, expectedCaseRevision: 0, partNumber: 1, sha256: partHash }),
        { code: 'UPLOAD_QUOTA' });
        assert.equal(db.parts.length, 0, 'a refused resume claims and writes nothing');
        db.uploads[1]!.state = 'retained';
        await service.claimPart(caseId, first.id, { requestKey: randomUUID(), expectedRevision: first.revision,
          expectedCaseRevision: 0, partNumber: 1, sha256: partHash });
        assert.ok(row.body.partActivityAt, 'resume reclaims its slot when free');
      });
    } finally {
      if (capacity === undefined) delete process.env.ULPIN_LARGE_ORIGINAL_V2_CAPACITY_BYTES;
      else process.env.ULPIN_LARGE_ORIGINAL_V2_CAPACITY_BYTES = capacity;
    }
  });
}
