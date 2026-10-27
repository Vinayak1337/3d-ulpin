import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import type { IntakeItem, IntakeManifest } from './batch-model';
import { IntakeItemRefresh, itemRefreshFor } from './item-refresh';

// In-memory protocol controls standing in for the manifest and one-item routes; no record is invented.
const item = (itemId: string, state: IntakeItem['state']) => ({ itemId, name: `${itemId}.csv`, wave: 1,
  sourceId: itemId, parentItemId: null, state }) as unknown as IntakeItem;

function harness(listed: IntakeItem[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const server = new Map(listed.map((entry) => [entry.itemId, entry]));
  const manifestFn = vi.fn(async () => ({ caseId: 'case', items: [...server.values()] }) as unknown as IntakeManifest);
  const observer = new QueryObserver(client, { queryKey: ['intake', 'case'], queryFn: manifestFn });
  const stop = observer.subscribe(() => {});
  const read = vi.fn(async (_caseId: string, itemId: string) => {
    const found = server.get(itemId);
    if (!found) throw new Error('Intake item not found in this case.');
    return found;
  });
  const refresh = new IntakeItemRefresh(client, 'case', read);
  const items = () => client.getQueryData<IntakeManifest>(['intake', 'case'])?.items;
  return { client, server, manifestFn, read, refresh, items, stop };
}

async function loaded(listed: IntakeItem[]) {
  const run = harness(listed);
  await vi.waitFor(() => expect(run.items()).toHaveLength(listed.length));
  run.manifestFn.mockClear();
  return run;
}

it('an item change reads that item alone and puts it in its place, with no manifest read', async () => {
  const run = await loaded([item('a', 'reading'), item('b', 'reading'), item('c', 'reading')]);
  run.server.set('b', item('b', 'read'));
  run.refresh.changed('b');
  await vi.waitFor(() => expect(run.items()?.map((entry) => entry.state)).toEqual(['reading', 'read', 'reading']));
  expect(run.read).toHaveBeenCalledExactlyOnceWith('case', 'b');
  expect(run.manifestFn).not.toHaveBeenCalled();
  run.stop();
});

it('a new item reads the manifest once', async () => {
  const run = await loaded([item('a', 'read')]);
  run.server.set('n', item('n', 'probed'));
  run.refresh.changed('n');
  await vi.waitFor(() => expect(run.items()).toHaveLength(2));
  expect(run.manifestFn).toHaveBeenCalledOnce();
  expect(run.read).not.toHaveBeenCalled();
  run.stop();
});

it('two changes to one item in quick succession give one item read', async () => {
  const run = await loaded([item('a', 'reading')]);
  run.server.set('a', item('a', 'read'));
  run.refresh.changed('a');
  run.refresh.changed('a');
  await vi.waitFor(() => expect(run.items()?.[0]?.state).toBe('read'));
  expect(run.read).toHaveBeenCalledOnce();
  expect(run.manifestFn).not.toHaveBeenCalled();
  run.stop();
});

it('a failed item read, or an item whose place would move, falls back to the manifest read', async () => {
  const run = await loaded([item('a', 'reading'), item('b', 'reading')]);
  run.server.delete('a');
  run.refresh.changed('a');
  await vi.waitFor(() => expect(run.items()?.map((entry) => entry.itemId)).toEqual(['b']));
  expect(run.manifestFn).toHaveBeenCalledOnce();
  run.server.set('b', { ...item('b', 'read'), wave: 2 });
  run.refresh.changed('b');
  await vi.waitFor(() => expect(run.manifestFn).toHaveBeenCalledTimes(2));
  expect(run.read).toHaveBeenCalledTimes(2);
  run.stop();
});

it('an item change waits for the manifest read in flight, and an item it left out is not put back', async () => {
  const run = await loaded([item('a', 'reading'), item('m', 'reading')]);
  let answer = () => {};
  run.manifestFn.mockImplementationOnce(() => new Promise((resolve) => {
    answer = () => resolve({ caseId: 'case', items: [item('a', 'reading')] } as unknown as IntakeManifest);
  }));
  void run.client.invalidateQueries({ queryKey: ['intake', 'case'] });
  run.refresh.changed('m');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(run.read).not.toHaveBeenCalled();
  answer();
  await vi.waitFor(() => expect(run.read).toHaveBeenCalledOnce());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(run.items()?.map((entry) => entry.itemId)).toEqual(['a']);
  expect(run.manifestFn).toHaveBeenCalledOnce();
  run.stop();
});

it('SL1: one client and batch share one refresh; another batch or client has its own', () => {
  const client = new QueryClient();
  const shared = itemRefreshFor(client, 'case');
  expect(itemRefreshFor(client, 'case')).toBe(shared);
  expect(itemRefreshFor(client, 'other')).not.toBe(shared);
  expect(itemRefreshFor(new QueryClient(), 'case')).not.toBe(shared);
});

it('SL1: changes without an item in one turn (two consumers of one notification) give one manifest read', async () => {
  const run = await loaded([item('a', 'read')]);
  run.refresh.changed();
  run.refresh.changed();
  await vi.waitFor(() => expect(run.manifestFn).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(run.client.isFetching()).toBe(0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(run.manifestFn).toHaveBeenCalledOnce();
  // A change in a later turn, while that read is in flight, still asks for one more read after it (ZP2).
  let answer = () => {};
  run.manifestFn.mockImplementationOnce(() => new Promise((resolve) => {
    answer = () => resolve({ caseId: 'case', items: [item('a', 'read')] } as unknown as IntakeManifest);
  }));
  run.refresh.changed();
  await new Promise((resolve) => setTimeout(resolve, 0));
  run.refresh.changed();
  answer();
  await vi.waitFor(() => expect(run.manifestFn).toHaveBeenCalledTimes(3));
  await vi.waitFor(() => expect(run.client.isFetching()).toBe(0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(run.manifestFn).toHaveBeenCalledTimes(3);
  run.stop();
});
