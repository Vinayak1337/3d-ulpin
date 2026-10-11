import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { destination } from './service';
import { officerQuestion } from './intake-draft-worker';
import { AppError } from '../../../infrastructure/errors';

const hash = 'a'.repeat(64);
const words = 'This file is already the source of the area “Retained publisher title”. '
  + 'Open that area; nothing new is prepared from a second copy.';
const area = { kind: 'new_area', name: 'File name', namespace: `file:${hash}` } as const;
const calls: string[] = [];
function client(found: boolean) {
  return { query: async (sql: string, args: unknown[]) => {
    calls.push(sql);
    if (sql.includes('seed_key')) {
      assert.equal(args[0], `${area.namespace}:${area.name}`);
      return { rows: found ? [{ id: 'existing-id', name: 'Retained publisher title' }] : [], rowCount: found ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  } } as unknown as PoolClient;
}

test('only this file own new-area naming scope gets the duplicate refusal and the waiting words', async () => {
  await assert.rejects(destination(client(true), area, false, hash),
    (error: AppError) => error.status === 409 && error.code === 'SOURCE_ALREADY_IN_AREA'
      && error.message === words && officerQuestion(error) === words);
  await assert.rejects(destination(client(true), area, false, 'b'.repeat(64)), {
    code: 'STALE_REVISION', message: 'This destination already exists; pin its current area and reference explicitly.',
  });
  await assert.rejects(destination(client(true), area), { code: 'STALE_REVISION' });
  await destination(client(false), area, false, hash);
});

test('executing a duplicate acquires the existing seed lock before checking, without changing the destination', async () => {
  calls.length = 0;
  await assert.rejects(destination(client(true), area, true, hash), { code: 'SOURCE_ALREADY_IN_AREA' });
  assert.match(calls[0], /pg_advisory_xact_lock/);
  assert.match(calls[1], /seed_key/);
  assert.equal(officerQuestion(new AppError(422, 'SOURCE_ALREADY_IN_AREA', words)), null);
});
