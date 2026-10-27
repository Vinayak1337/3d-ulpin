import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import bronx from '../local/data/nyc-bronx-areas.json';
import { queryKeys, type Area } from '../api/queries';
import { container, elements, propsOf, type FakeElement } from '../features/intake/fake-dom';
import { Frame } from './Frame';

// Two areas that share one name, built from the Bronx area record.
const original = bronx[0] as unknown as Area;
const first: Area = { ...original, id: '11111111-aaaa-4bbb-8ccc-000000000001', name: 'buildings original' };
const second: Area = {
  ...original, id: '22222222-aaaa-4bbb-8ccc-000000000002', name: 'buildings original', revision: 3,
};

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => { await unmount?.(); unmount = undefined; });

async function mount(path: string, areas: Area[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.areas, areas);
  const root = container();
  const view = createRoot(root as never);
  await act(async () => view.render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}><Frame /></MemoryRouter>
    </QueryClientProvider>,
  ));
  unmount = () => act(async () => { view.unmount(); client.clear(); });
  return root;
}

const attributes = (node: FakeElement) => propsOf(node) as Record<string, unknown>;
const areaButton = (root: FakeElement) =>
  elements(root).find((node) => node.tagName === 'BUTTON' && attributes(node)['aria-haspopup'])!;
const options = (root: FakeElement) =>
  elements(root).filter((node) => node.tagName === 'LI' && attributes(node).role === 'option');

describe('area switcher', () => {
  it('names no area away from an area page', async () => {
    const root = await mount('/studio/work/cases/x/intake', [first, second]);

    expect(areaButton(root).textContent).toBe('Choose an area');
  });

  it('says No areas and stays closed when there are none', async () => {
    const root = await mount('/studio/work', []);

    expect(areaButton(root).textContent).toBe('No areas');
    expect(attributes(areaButton(root)).disabled).toBe(true);
  });

  it('names the area of the page and tells two areas of one name apart', async () => {
    const root = await mount(`/studio/areas/${second.id}`, [first, second]);
    const button = areaButton(root);

    expect(button.textContent).toBe(`buildings originalRevision 3 · 22222222 · ${second.featureCount} features`);
    await act(async () => { await propsOf(button).onClick?.({}); });
    const [one, two] = options(root).map((option) => option.textContent);
    expect(one).toContain('11111111');
    expect(two).toContain('22222222');
    expect(one).not.toBe(two);
  });

  it('shows a count of 0 and leaves out a missing count', async () => {
    const none = { ...first, featureCount: undefined } as unknown as Area;
    const root = await mount(`/studio/areas/${first.id}`, [{ ...first, featureCount: 0 }, none]);
    await act(async () => { await propsOf(areaButton(root)).onClick?.({}); });
    const [zero, missing] = options(root).map((option) => option.textContent);

    expect(zero).toContain('0 features');
    expect(missing).not.toContain('features');
  });
});
