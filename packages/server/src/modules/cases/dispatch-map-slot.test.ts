import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Client } from 'pg';
import { closePool, migrate } from '../../infrastructure/db';
import { DispatchReservations } from './dispatch-lanes';
import { dispatchTick } from './processing';

// S9.5f. The real claim query on a throwaway PostgreSQL that `migrate()` built from database/sql in runtime order.
const url = process.env.ULPIN_PG_TEST_URL;

/** The claim query and its parameters, captured from one tick on a pool that holds no jobs. */
async function claimQuery(): Promise<{ sql: string; values: unknown[] }> {
  const globals = globalThis as typeof globalThis & { ulpinPool?: unknown };
  const sent: { sql: string; values: unknown[] }[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    sent.push({ sql, values });
    return { rows: [], rowCount: 0 };
  };
  globals.ulpinPool = { query, connect: async () => ({ query, release: () => {} }) };
  try {
    await dispatchTick();
  } finally {
    delete globals.ulpinPool;
  }
  return sent.find(statement => statement.sql.includes('AS file_rank'))!;
}

type Fixture = { client: Client; caseId: string; files: Map<string, { source: string; item: string }> };

/** A test_only source and its top-level intake item; no original bytes exist behind it. */
async function addFile({ client, caseId, files }: Fixture, name: string, family: string, published = false) {
  const source = randomUUID(), item = randomUUID();
  await client.query(`INSERT INTO sources(id,case_id,family_id,revision,name,profile,mime_type,bytes,sha256,object_key,
    status) VALUES($1,$2,$1,1,$3,'test_only','application/octet-stream',1,repeat('0',64),$4,'retained')`,
  [source, caseId, name, `test_only/${source}`]);
  await client.query(`INSERT INTO usp_intake_items(item_id,source_id,case_id,family,size_bytes,size_class,wave,
    created_at) VALUES($1,$2,$3,$4,1,'S',1,clock_timestamp())`, [item, source, caseId, family]);
  if (published) await client.query(`INSERT INTO usp_intake_parts(item_id,part_index,locator,state)
    VALUES($1,0,'{}','published')`, [item]);
  files.set(name, { source, item });
}

/** One queued chunk mapping per name, its source the named file's (or none). Returns name to job id. */
async function addMappings({ client, caseId, files }: Fixture, names: string[], jobs: Map<string, string>) {
  for (const name of names) {
    const id = randomUUID();
    await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,input_fingerprint,payload,created_at)
      VALUES($1,$2,$3,'chunk-mapping','test_only','{}',clock_timestamp())`,
    [id, caseId, files.get(name)?.source ?? null]);
    jobs.set(name, id);
  }
}

/** A mapping that ends: its job succeeds and its slot is released. */
async function finish(client: Client, reservations: DispatchReservations, jobId: string) {
  await client.query("UPDATE jobs SET status='succeeded',completed_at=clock_timestamp() WHERE id=$1", [jobId]);
  reservations.release(jobId);
}

/** One tick's claim: the real query under this process's holdings, then admission in its order. */
async function claim(client: Client, { sql, values }: { sql: string; values: unknown[] },
  reservations: DispatchReservations) {
  const parameters = [...values];
  parameters[2] = reservations.heldJobIds();
  parameters[4] = reservations.unavailableLanes([]);
  parameters[7] = reservations.refusedJobIds();
  const rows = (await client.query(sql, parameters)).rows;
  reservations.keepTableLaneWaiting(Boolean(rows[0]?.map_waiting), Boolean(rows[0]?.table_waiting));
  const admitted = rows.filter(row => reservations.admit({ id: row.id, operation: row.operation,
    created_at: row.created_at, payload: row.payload, mapMapping: row.map_mapping }, 100000, [], Date.now()));
  return { rows, admitted: admitted.map(row => row.id as string) };
}

test('on PostgreSQL a map file\'s first mapping takes the next table slot from two running table mappings',
  { skip: !url }, async () => {
    assert.equal(new URL(url!).hostname, '127.0.0.1');
    process.env.DATABASE_URL = url;
    try {
      await migrate();
    } finally {
      await closePool();
    }
    const query = await claimQuery();
    const client = new Client({ connectionString: url });
    await client.connect();
    const fixture: Fixture = { client, caseId: randomUUID(), files: new Map() };
    const jobs = new Map<string, string>(), name = (id: string) => [...jobs].find(([, job]) => job === id)![0];
    const reservations = new DispatchReservations();
    try {
      // Every row stays inside this transaction; the claim reads it on the same connection.
      await client.query('BEGIN');
      await client.query(`INSERT INTO cases(id,name,frame) VALUES($1,'test_only S9.5f','{}')`, [fixture.caseId]);
      for (const table of ['table-1', 'table-2', 'table-3']) await addFile(fixture, table, 'table');
      await addFile(fixture, 'layer', 'vector');
      await addFile(fixture, 'mapped-layer', 'vector', true);
      await addMappings(fixture, ['table-1', 'table-2'], jobs);
      assert.deepEqual((await claim(client, query, reservations)).admitted.map(name), ['table-1', 'table-2']);
      await addMappings(fixture, ['table-3', 'mapped-layer', 'old-job', 'layer'], jobs);
      assert.deepEqual((await claim(client, query, reservations)).admitted, [], 'the table lane is full');
      await finish(client, reservations, jobs.get('table-1')!);
      const freed = await claim(client, query, reservations);
      assert.deepEqual(freed.rows.map(row => [name(row.id), row.map_mapping]), [['layer', true],
        ['table-3', false], ['mapped-layer', false], ['old-job', false]]);
      assert.ok(freed.rows.every(row => row.map_waiting && row.table_waiting));
      assert.deepEqual(freed.admitted.map(name), ['layer']);
      await finish(client, reservations, jobs.get('table-2')!);
      const next = await claim(client, query, reservations);
      assert.ok(next.rows.every(row => !row.map_waiting && row.table_waiting));
      assert.deepEqual(next.admitted.map(name), ['table-3']);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
