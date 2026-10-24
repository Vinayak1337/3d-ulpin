import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IntakeItem } from '../batch-model';

const state = vi.hoisted(() => ({ packages: [] as unknown[] }));
vi.mock('../batch-queries', () => ({ useBatchPackages: () => ({ data: { packages: state.packages, items: [] } }) }));
vi.mock('./api', async (original) => ({ ...await original<typeof import('./api')>(),
  useReadTables: () => ({}), useEvidencePage: () => ({ isPending: true }) }));

const { EvidenceByKey } = await import('./EvidenceByKey');
const map = { itemId: '04000000-0000-4000-8000-000000000002', family: 'vector', name: 'plots.geojson' } as IntakeItem;
const render = () => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>
  <EvidenceByKey caseId="case" items={[map]} />
</QueryClientProvider>);

it('S7.3: Evidence by key shows only once a map item of the batch has drafted buildings', () => {
  const counts = { ready: 0, held: 0 };
  state.packages = [{ anchorItemId: map.itemId, counts }];
  expect(render()).toBe('');
  state.packages = [{ anchorItemId: map.itemId, counts: { ...counts, ready: 3 } }];
  expect(render()).toContain('Evidence by key');
  expect(render()).toContain('Link a register by a key');
});
