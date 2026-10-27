import { button, container, elements, propsOf } from '../intake/fake-dom';
import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import nyc from '../../local/data/nyc-bronx-context.json';
import swiss from '../../local/data/swiss-floor-context.json';
import swissRegister from '../../local/data/swiss-floor-register.json';
import { queryKeys, type AreaContext, type AreaFeature } from '../../api/queries';
import { MapWorkspace } from './MapWorkspace';
import { MapSidebar } from './MapSidebar';

vi.mock('./MapSidebar', async (original) => ({
  ...await original<typeof import('./MapSidebar')>(), MapSidebar: vi.fn(() => null),
}));
vi.mock('@ulpin/scene/react', () => ({ SceneView: () => null }));
const { MapSidebar: Sidebar } = await vi.importActual<typeof import('./MapSidebar')>('./MapSidebar');
type SidebarProps = ComponentProps<typeof Sidebar>;
const withoutBuildings = (nyc.features as unknown as AreaFeature[]).filter((f) => f.kind !== 'building');

function workspace(data: typeof nyc | typeof swiss, features = data.features as unknown as AreaFeature[],
  client = new QueryClient()) {
  const context = { ...data, displayFeatures: features } as unknown as AreaContext;
  const markup = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter>
    <MapWorkspace context={context} />
  </MemoryRouter></QueryClientProvider>);
  const props = vi.mocked(MapSidebar).mock.lastCall![0] as SidebarProps;
  return { markup, props };
}

it('Bronx without buildings has only Area and None, and no building search', () => {
  const { props, markup } = workspace(nyc, withoutBuildings);
  expect(props.views.map((v) => v.label)).toEqual(['Area']);
  expect(props.colourOptions.map((o) => o.label)).toEqual(['None']);
  expect(markup).not.toContain('Find building');
});

it('Bronx footprints keep building tools but do not invent levels or utilities', () => {
  const { props, markup } = workspace(nyc);
  expect(props.views.map((v) => v.label)).toEqual(['Area', 'Building', 'Findings']);
  expect(props.colourOptions.map((o) => o.label)).toEqual(['None', 'Height', 'Link']);
  expect(props.views.find((v) => v.key === 'building')!.disabled).toBe(true);
  expect(markup).toContain('Find building');
});

it('all tools remain listed with loaded levels and utilities even with no selected building', () => {
  const client = new QueryClient();
  client.setQueryData(queryKeys.register(swissRegister.property.id), swissRegister);
  // Synthetic test-only utility presence: no geometry, measurement or rights are asserted.
  const utility = { id: 'test-only:utility', kind: 'utility', geometry: null } as unknown as AreaFeature;
  const { props } = workspace(swiss, [...swiss.features as unknown as AreaFeature[], utility], client);
  expect(props.views.map((v) => v.label)).toEqual(['Area', 'Building', 'Floors', 'Findings', 'Underground']);
  expect(props.colourOptions.map((o) => o.label)).toEqual(['None', 'Rights', 'Utilities', 'Height', 'Link']);
  expect(props.views.filter((v) => v.key !== 'area').every((v) => v.disabled)).toBe(true);
  expect(props.colourOptions.find((o) => o.value === 'rights')!.disabled).toBe(true);
  expect(workspace(nyc, undefined, client).props.views.some((v) => v.key === 'level')).toBe(false);
  expect(workspace(swiss, undefined, client).props.views.map((v) => v.key)).not.toContain('underground');
  client.clear();
});

it('layers open first; a counted row discloses its hint only on About and keeps its switch working', async () => {
  const { props } = workspace(nyc, withoutBuildings);
  const onLayer = vi.fn();
  const root = container();
  const view = createRoot(root as never);
  const layer = { key: 'test-only:buildings', label: 'Buildings', count: nyc.features.length,
    hint: nyc.area.name, checked: false };
  try {
    await act(async () => view.render(<Sidebar {...props} layers={[layer]} onLayer={onLayer} />));
    expect(button(root, 'Layers').getAttribute('aria-pressed')).toBe('true');
    expect(root.textContent).not.toContain(layer.hint);
    expect(root.textContent).toContain(String(layer.count));
    const about = elements(root).find((n) => n.getAttribute('aria-label') === 'About Buildings')!;
    expect(about.getAttribute('aria-expanded')).toBe('false');
    await act(async () => { propsOf(about).onClick!(); });
    expect(root.textContent).toContain(layer.hint);
    expect(about.getAttribute('aria-expanded')).toBe('true');
    const toggle = elements(root).find((n) => n.getAttribute('role') === 'switch')!;
    await act(async () => {
      propsOf(toggle).onClick!();
      propsOf(about).onClick!();
    });
    expect(onLayer).toHaveBeenCalledWith(layer.key, true);
    expect(root.textContent).not.toContain(layer.hint);
    await act(async () => { propsOf(button(root, 'View')).onClick!(); });
    expect(elements(root).filter((n) => n.getAttribute('aria-current') === 'page').map((n) => n.textContent))
      .toEqual(['Area']);
    expect(root.textContent).not.toContain('Building');
    await act(async () => { propsOf(button(root, 'Colour')).onClick!(); });
    expect(elements(root).filter((n) => n.getAttribute('role') === 'radio').map((n) => n.textContent))
      .toEqual(['None']);
  } finally {
    await act(async () => view.unmount());
  }
});

it('a layer failure stays under its row without pressing About', () => {
  const { props } = workspace(nyc, withoutBuildings);
  const warning = '2 of 3 listed pictures did not load';
  const markup = renderToStaticMarkup(<Sidebar {...props} onLayer={vi.fn()}
    layers={[{ key: 'overlay:imagery', label: 'Imagery', checked: true, warning }]} />);
  expect(markup).toContain(warning);
  expect(markup).not.toContain('About Imagery');
});
