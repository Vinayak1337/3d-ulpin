import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SceneEngine } from '@ulpin/scene';
import { createViewFrames } from './viewFrames';
import { SceneLabels } from './SceneLabels';
import { ScaleAndNorth } from './ScaleAndNorth';
import nyc from '../../local/data/nyc-bronx-context.json';
import swiss from '../../local/data/swiss-floor-context.json';
import type { AreaFeature } from '../../api/queries';
import { toFootprints } from './footprints';

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
