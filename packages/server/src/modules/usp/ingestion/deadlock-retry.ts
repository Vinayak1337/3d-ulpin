import { setTimeout as delay } from 'node:timers/promises';

/** PostgreSQL rolled the whole transaction back: a deadlock victim or a serialization failure. */
const ROLLED_BACK = new Set(['40P01', '40001']);
export const DEADLOCK_RETRIES = 2;

function rolledBack(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && ROLLED_BACK.has(code);
}

function shortRandomDelay() {
  return delay(20 + Math.floor(Math.random() * 80));
}

/**
 * S9.6r. Run a transaction again, at most twice more, when PostgreSQL rolled it back for 40P01 or 40001. Only for a
 * callback whose every effect (rows, request keys, outbox events) is inside that transaction; any other error, and
 * the third rollback, is thrown unchanged.
 */
export async function retryRolledBack<T>(run: () => Promise<T>, wait: () => Promise<unknown> = shortRandomDelay) {
  for (let retry = 0; ; retry++) {
    try {
      return await run();
    } catch (error) {
      if (retry >= DEADLOCK_RETRIES || !rolledBack(error)) throw error;
      await wait();
    }
  }
}
