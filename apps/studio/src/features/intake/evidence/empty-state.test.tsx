import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IntakeItem } from '../batch-model';
import captured from '../../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { intakeKey } from '../batch-queries';
import { tableKey } from '../table/queries';
import { expectDisabledReasons } from './disabled-reasons.test-support';

const state = vi.hoisted(() => ({ packages: [] as unknown[] }));
vi.mock('../batch-queries', async original => ({ ...await original<typeof import('../batch-queries')>(),
  useBatchPackages: () => ({ data: { packages: state.packages, items: [] } }) }));
vi.mock('./api', async (original) => ({ ...await original<typeof import('./api')>(),
  useReadTables: () => ({}), useEvidencePage: () => ({ isPending: true }) }));

const { DeclareLink, EvidenceByKey } = await import('./EvidenceByKey');
const map = { itemId: '04000000-0000-4000-8000-000000000002', family: 'vector', name: 'plots.geojson' } as IntakeItem;
const render = () => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>
  <EvidenceByKey caseId="case" items={[map]} />
</QueryClientProvider>);

it('describes undrafted Declare before its only action, and removes the line once drafted', () => {
  const anchor = captured.manifest.items[0] as unknown as IntakeItem;
  // test_only table using the captured map's column names, not an operational link.
  const table = { ...anchor, itemId: 'table', sourceId: 'table', family: 'table', format: 'csv' } as IntakeItem;
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(intakeKey('case'), { items: [anchor, table] });
  client.setQueryData([...tableKey('case', anchor.sourceId!), 'profile'], captured.profile);
  client.setQueryData([...tableKey('case', 'table'), 'profile'], {});
  const show = () => renderToStaticMarkup(<QueryClientProvider client={client}>
    <DeclareLink caseId="case" link={{ fromItemId: anchor.itemId, itemId: table.itemId, by: 'key', basis: 'rule',
      fields: { here: '/features/*/properties/bin', there: 'bin' }, words: 'test_only' }} onDeclare={vi.fn()} />
  </QueryClientProvider>);
  state.packages = [];
  const blocked = show();
  expect(expectDisabledReasons(blocked)).toBe(1);
  expect(blocked.indexOf('Available once')).toBeLessThan(blocked.indexOf('>Declare</button>'));
  state.packages = [{ anchorItemId: anchor.itemId, counts: { ready: 1 } }];
  expect(expectDisabledReasons(show())).toBe(0);
  expect(show()).not.toContain('var(--ui-ink-soft)');
  client.clear();
});

it('S7.3: Evidence by key shows only once a map item of the batch has drafted buildings', () => {
  const counts = { ready: 0, held: 0 };
  state.packages = [{ anchorItemId: map.itemId, counts }];
  expect(render()).toBe('');
  state.packages = [{ anchorItemId: map.itemId, counts: { ...counts, ready: 3 } }];
  expect(render()).toContain('Evidence by key');
  // S7.23a: it starts closed; its count waits for the evidence read.
  expect(render()).toContain('aria-expanded="false"');
  expect(render()).not.toContain('Link a register by a key');
});
