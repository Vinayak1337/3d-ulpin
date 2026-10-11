import { expect, it } from 'vitest';
import { initialStream } from '../table/events';
import { runFrame } from './events';

it('target events refetch current facts once, independent of source, and do not trust event artefacts', () => {
  const frame = { sequence: '1', change: { kind: 'intake.target', readiness: 'carded', stage: 8 } };
  const next = runFrame(initialStream(), '1', frame, 'ingestion.change');
  expect(next.refresh).toBe(true);
  expect(runFrame(next.state, '1', frame, 'ingestion.change').refresh).toBe(false);
  expect(runFrame(next.state, '2', { sequence: '2', change: { kind: 'intake.item' } }, 'ingestion.change')
    .refresh).toBe(false);
});

it('ready refreshes, resync refreshes and reconnects from the new head, and bad sequences fail closed', () => {
  expect(runFrame(initialStream(), '7', { kind: 'ready' }, 'ready').refresh).toBe(true);
  const resync = runFrame(initialStream(), '', { kind: 'resync', headCursor: '12' }, 'resync');
  expect(resync).toMatchObject({ refresh: true, reconnect: true, state: { cursor: '12' } });
  expect(() => runFrame(initialStream(), '2', { change: { kind: 'intake.target' } }, 'ingestion.change')).toThrow();
});
