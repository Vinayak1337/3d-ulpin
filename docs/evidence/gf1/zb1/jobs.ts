import { setTimeout as delay } from 'node:timers/promises';
import { query } from '../../../../packages/server/src/infrastructure/db';
import { dispatchTick } from '../../../../packages/server/src/modules/cases/processing';
import { intakeRunSteps } from '../../../../packages/server/src/modules/usp/ingestion/intake-run-worker';

export const reviews: Record<string, unknown>[] = [];
let timer: ReturnType<typeof setInterval>;
let dispatching: Promise<unknown> | undefined;

/** Observe the real review command without changing its inputs, result or refusal. */
export function startDispatcher() {
  const review = intakeRunSteps.review;
  intakeRunSteps.review = async (id, revision) => {
    const startedAt = new Date().toISOString();
    try {
      const pkg = await review(id, revision);
      reviews.push({ packageId: id, revision, startedAt, endedAt: new Date().toISOString(), passed: true });
      return pkg;
    } catch (error: any) {
      reviews.push({ packageId: id, revision, startedAt, endedAt: new Date().toISOString(), passed: false,
        code: error.code, message: error.message, stack: error.stack?.split('\n') });
      throw error;
    }
  };
  timer = setInterval(() => {
    if (dispatching) return;
    dispatching = dispatchTick().finally(() => { dispatching = undefined; });
  }, 250);
}

export async function stopDispatcher() {
  clearInterval(timer);
  await dispatching;
}

/** Bounded observation of public reads, while the ordinary dispatcher timer runs independently. */
export async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, boundMs = 180000) {
  const deadline = Date.now() + boundMs;
  let value: T;
  do {
    value = await read();
    if (done(value)) return value;
    await delay(500);
  } while (Date.now() < deadline);
  throw new Error('Read-back observation bound exceeded: ' + JSON.stringify(value));
}

export async function idle(caseId: string) {
  return waitFor(async () => (await query(`SELECT id,operation,status,error FROM jobs
    WHERE case_id=$1 AND status IN ('queued','running') ORDER BY created_at,id`, [caseId])).rows,
  rows => rows.length === 0);
}

export async function prepareJobs(caseId: string) {
  return (await query(`SELECT j.id,j.payload->>'packageId' AS "packageId",j.status,j.attempts,j.error,
    j.created_at,j.completed_at,m.logical_state,m.result_ref,
    (SELECT jsonb_agg(jsonb_build_object('number',a.number,'state',a.state,'createdAt',a.created_at)
      ORDER BY a.number) FROM usp_job_attempts a WHERE a.job_id=j.id) AS authority_attempts
    FROM jobs j LEFT JOIN usp_job_metadata m ON m.job_id=j.id
    WHERE j.case_id=$1 AND j.operation='intake-run' AND j.payload->>'phase'='prepare'
    ORDER BY j.created_at,j.id`, [caseId])).rows;
}
