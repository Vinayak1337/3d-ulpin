import type { ScenePalette } from './types';

/** Scene colours come from the design-system map tokens (docs/design-system/map-and-3d.md). */
export function readPalette(element: Element = document.documentElement): ScenePalette {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    ground: token('--ui-map-ground', '#e9eeec'),
    building: token('--ui-map-building', '#d5dbd9'),
    buildingEdge: token('--ui-map-building-edge', '#a9b5b2'),
    selected: token('--ui-map-selected', '#235347'),
    halo: token('--ui-map-halo', '#ffffff'),
    ink: token('--ui-ink', '#16272d'),
    unknownHatch: token('--ui-map-building-edge', '#a9b5b2'),
    readinessUnknown: token('--ui-readiness-unknown', '#b8c3c6'),
    soilTop: token('--ui-map-soil-top', '#d9c9aa'),
    soilDeep: token('--ui-map-soil-deep', '#b89f78'),
    critical: token('--ui-mark-critical', '#d03b3b'),
  };
}
