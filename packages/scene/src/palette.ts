import type { ScenePalette } from './types';

/** Scene colours come from the design-system map tokens (docs/design-system/map-and-3d.md). */
export function readPalette(element: Element = document.documentElement): ScenePalette {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    ground: token('--ui-map-ground', '#e9eeec'),
    road: token('--ui-map-road', '#dce2e2'),
    publicLand: token('--ui-map-public-land', '#dde8e0'),
    water: token('--ui-map-water', '#cfe1ec'),
    parcelLine: token('--ui-map-parcel-line', '#8c9c9a'),
    building: token('--ui-map-building', '#d5dbd9'),
    buildingEdge: token('--ui-map-building-edge', '#a9b5b2'),
    selected: token('--ui-map-selected', '#235347'),
    halo: token('--ui-map-halo', '#ffffff'),
    ink: token('--ui-ink', '#16272d'),
    readinessUnknown: token('--ui-readiness-unknown', '#b8c3c6'),
    soilTop: token('--ui-map-soil-top', '#d9c9aa'),
    soilDeep: token('--ui-map-soil-deep', '#b89f78'),
    critical: token('--ui-mark-critical', '#d03b3b'),
    utilities: {
      water: token('--ui-utility-water', '#1f6fd1'),
      sewer: token('--ui-utility-sewer', '#2e8b3a'),
      gas: token('--ui-utility-gas', '#f2c200'),
      electric: token('--ui-utility-electric', '#d7262e'),
      telecom: token('--ui-utility-telecom', '#f28c00'),
      metro: token('--ui-rights-public', '#eb6834'),
    },
  };
}
