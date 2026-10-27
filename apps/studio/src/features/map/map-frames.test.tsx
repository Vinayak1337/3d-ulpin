import { container } from '../intake/fake-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SceneEngine } from '@ulpin/scene';
import { createViewFrames } from './viewFrames';
import { SceneLabels } from './SceneLabels';
import { ScaleAndNorth } from './ScaleAndNorth';
import nyc from '../../local/data/nyc-bronx-context.json';
import swiss from '../../local/data/swiss-floor-context.json';
import { queryKeys, type AreaContext, type AreaFeature } from '../../api/queries';
import { PackageDrawingLine } from './MapWorkspace';
import { toFootprints } from './footprints';

it.each([
  ['nyc-bronx-context.json', nyc, swiss.features[0]!],
  ['swiss-floor-context.json', swiss, nyc.features[0]!],
] as const)('S7.9: %s drawing counts stop only on its first drawn footprint', async (name, data, other) => {
  const packageId = 'test-only:drawing-package';
  const features = data.features.map(f => ({ ...f, proposalPackageId: packageId }));
  const context = { ...data,
    displayFeatures: [...features, { ...other, proposalPackageId: 'test-only:other' }],
  } as unknown as AreaContext;
  const frames = createViewFrames();
  const drawn = new Set<string>();
  const engine = { drawnBuildings: () => ({ has: (id: string) => drawn.has(id) }) } as SceneEngine;
  const client = new QueryClient();
  client.setQueryData(queryKeys.importPackage(packageId), { name: data.area.name,
    sourceMetadata: [{ filename: name }], features: [] });
  const root = container();
  const view = createRoot(root as never);
  const show = (value: AreaContext) => act(async () => view.render(<QueryClientProvider client={client}>
    <PackageDrawingLine packageId={packageId} context={value} engine={engine} frames={frames} />
  </QueryClientProvider>));
  try {
    await show({ ...context, displayFeatures: features.slice(0, 1) } as unknown as AreaContext);
    expect(root.textContent).toBe(`Drawing ${name}: 1 features so far`);
    await show(context);
    const line = `Drawing ${name}: ${features.length.toLocaleString('en-IN')} features so far`;
    expect(root.textContent).toBe(line);
    await act(async () => { drawn.add(other.id); frames.emit(); });
    expect(root.textContent).toBe(line);
    await act(async () => { drawn.add(features[0]!.id); frames.emit(); });
    expect(root.textContent).toBe('');
  } finally {
    await act(async () => view.unmount());
    client.clear();
  }
});

it('passes the nullable area extent to the engine when context or engine changes, not on frames', () => {
  const source = readFileSync(new URL('./MapWorkspace.tsx', import.meta.url), 'utf8');
  expect(source).toContain(
    'useEffect(() => { engine?.setAreaExtent(context.area.extent); }, [engine, context.area.extent]);',
  );
  expect(source.match(/\.setAreaExtent\(/g)).toHaveLength(1);
});

it('publishes every frame to leaf subscribers, with no workspace state dispatcher', () => {
  const frames = createViewFrames();
  const labels = vi.fn();
  const scale = vi.fn();
  const stopLabels = frames.subscribe(labels);
  const stopScale = frames.subscribe(scale);
  for (let frame = 0; frame < 60; frame++) frames.emit();
  expect(frames.snapshot()).toBe(60);
  expect(labels).toHaveBeenCalledTimes(60);
  expect(scale).toHaveBeenCalledTimes(60);
  stopLabels();
  frames.emit();
  expect(labels).toHaveBeenCalledTimes(60);
  expect(scale).toHaveBeenCalledTimes(61);
  stopScale();
  frames.emit();
  expect(scale).toHaveBeenCalledTimes(61);
});

it('keeps labels and the scale at the engine values before and after a frame', () => {
  const frames = createViewFrames();
  // Synthetic test-only camera poses; no records, coordinates or measurements enter the product.
  const project = vi.fn().mockReturnValue({ x: 100, y: 200, visible: true });
  const engine = {
    project, anchorPixelSize: () => 60, metresPerPixel: () => 1, headingDeg: () => 30,
  } as unknown as SceneEngine;
  const labels = [{ id: 'synthetic:selection', text: 'Synthetic test label', kind: 'selected' as const }];
  const markup = () => renderToStaticMarkup(<>
    <SceneLabels engine={engine} labels={labels} frames={frames} />
    <ScaleAndNorth engine={engine} frames={frames} title="Synthetic test frame" prefix="Test fixture" />
  </>);
  const before = markup();
  expect(before).toContain('translate(100px, 200px)');
  expect(before).toContain('Synthetic test label');
  expect(before).toContain('100 m');
  expect(before).toContain('view heading 30°');
  project.mockReturnValue({ x: 120, y: 210, visible: true });
  frames.emit();
  const after = markup();
  expect(after).toContain('translate(120px, 210px)');
  expect(after).toContain('100 m');
  project.mockReturnValue({ visible: false });
  frames.emit();
  expect(markup()).not.toContain('Synthetic test label');
});

it('keeps the real NYC labels and the unplaced Swiss source with unknown height through frame updates', () => {
  // Foreign test_only source derivatives already kept in the repository; not Indian operational records.
  for (const context of [nyc, swiss]) {
    const buildings = context.features.filter((feature) => feature.kind === 'building');
    const frames = createViewFrames();
    const labels = buildings.map(({ id, name }) => ({ id, text: name, kind: 'selected' as const }));
    // Synthetic camera projection only: the source's text, geometry and height are never changed.
    const engine = { project: () => ({ x: 100, y: 200, visible: true }) } as unknown as SceneEngine;
    const markup = () => renderToStaticMarkup(<SceneLabels engine={engine} labels={labels} frames={frames} />);
    const before = markup();
    for (const label of labels) expect(before).toContain(label.text);
    frames.emit();
    expect(markup()).toBe(before);
    expect(toFootprints(buildings as unknown as AreaFeature[])).toHaveLength(buildings.length);
  }
  const difficult = toFootprints(swiss.features as unknown as AreaFeature[]);
  expect(swiss.area.reference).toBeNull();
  expect(difficult[0]!.heightM).toBeNull();
  expect(difficult[0]!.heightState).toBe('unknown');
});
