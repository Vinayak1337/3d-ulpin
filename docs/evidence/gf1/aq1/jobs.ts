import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { settings } from '../../../../packages/server/src/infrastructure/config';
import { pool, query } from '../../../../packages/server/src/infrastructure/db';
import { dispatchTick } from '../../../../packages/server/src/modules/cases/processing';

let notify: ((jobId: string) => void) | undefined;
type Job = { id: string; operation: string; status: string; error: unknown; payload: unknown };

/** Observe terminal commits, not a competing scheduling order or a new domain command. */
export function observeJobs() {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  globals.ulpinPool = new Pool({ connectionString: settings.databaseUrl, max: 8, connectionTimeoutMillis: 10000 });
  pool().on('connect', client => {
    const original = client.query.bind(client);
    const committing = new Set<string>();
    client.query = ((...args: any[]) => {
      if (typeof args.at(-1) === 'function') return (original as any)(...args);
      const [text, values = []] = args;
      return (original as any)(...args).then((result: unknown) => {
        const terminal = text.startsWith('UPDATE jobs SET status=')
          && (text.includes("'succeeded'") || text.includes("'failed'")
            || ['failed', 'stale'].includes(values[1]));
        if (terminal) committing.add(String(values[0]));
        if (text === 'COMMIT') {
          for (const jobId of committing) notify?.(jobId);
          committing.clear();
        }
        if (text === 'ROLLBACK') committing.clear();
        return result;
      });
    }) as typeof client.query;
  });
}

async function nextCompletion() {
  await new Promise<void>(resolve => setImmediate(resolve));
  let timer: ReturnType<typeof setTimeout>;
  const completion = new Promise<string>((resolve, reject) => {
    notify = resolve;
    timer = setTimeout(async () => {
      const jobs = (await query('SELECT id,operation,status,error FROM jobs ORDER BY created_at,id')).rows;
      reject(new Error('Dispatcher exceeded its 90-second observation bound: ' + JSON.stringify(jobs)));
    }, 90000);
  });
  try {
    await dispatchTick();
    const id = await completion;
    const job = (await query<Job>('SELECT id,operation,status,error,payload FROM jobs WHERE id=$1', [id])).rows[0];
    assert.equal(job.status, 'succeeded', JSON.stringify(job));
  } finally {
    clearTimeout(timer!);
    notify = undefined;
  }
}

export async function drainJobs() {
  for (let index = 0; index < 30; index++) {
    const pending = (await query("SELECT id FROM jobs WHERE status IN ('queued','running') LIMIT 1")).rows[0];
    if (!pending) return;
    await nextCompletion();
  }
  throw new Error('Dispatcher exceeded the 30-job bounded walk.');
}

export async function itemJobs(itemId: string) {
  return (await query<{ id: string; status: string; recipeRevision: number }>(
    `SELECT id,status,(payload->>'recipeRevision')::int AS "recipeRevision" FROM jobs
    WHERE operation='intake-draft' AND payload->>'itemId'=$1 ORDER BY created_at,id`, [itemId])).rows;
}
