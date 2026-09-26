import type { ScenePalette } from './types';

/** Scene colours come from the design-system map tokens (docs/design-system/map-and-3d.md). */
export function readPalette(element: Element = document.documentElement): ScenePalette {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    ground: token('--ui-map-ground', '#e9eeec'),
    building: token('--ui-map-building', '#d5dbd9'),
    buildingEdge: token('--ui-map-building-edge', '#a9b5b2'),
    selected: token('--ui-primary', '#235347'),
    hover: token('--ui-primary', '#235347'),
    halo: token('--ui-map-halo', '#ffffff'),
    unknownHatch: token('--ui-muted', '#5b6a72'),
  };
}
