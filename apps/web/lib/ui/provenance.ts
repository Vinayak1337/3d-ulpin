import type { MapArea, PhysicalFeature } from '@ulpin/contracts';

/** Display only a classification present in a saved record or its saved features. */
export function classificationLabel(value: unknown): string {
  switch (value) {
    case 'observed': return 'Observed';
    case 'planned': return 'Planned';
    case 'hypothetical': return 'Hypothetical';
    case 'synthetic': return 'Synthetic';
    case 'mixed': return 'Mixed';
    default: return 'Unknown';
  }
}

/** Legacy dataKind is a stored summary of area feature classifications. */
export function areaClassification(area: Pick<MapArea, 'dataKind'>): string {
  switch (area.dataKind) {
    case 'real': return classificationLabel('observed');
    case 'demonstration': return classificationLabel('synthetic');
    case 'mixed': return classificationLabel('mixed');
    case 'empty': return 'No mapped sources yet';
    default: return classificationLabel(null);
  }
}

export function featureClassification(features: readonly Pick<PhysicalFeature, 'worldStatus'>[]): string {
  const values = new Set(features.map(feature => feature.worldStatus));
  return values.size === 1 ? classificationLabel([...values][0])
    : values.size > 1 ? classificationLabel('mixed') : classificationLabel(null);
}
