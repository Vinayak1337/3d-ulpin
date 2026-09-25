import type { PhysicalFeature } from '@ulpin/contracts';
import { geometryParts } from '../register/model';

/** A footprint preview of recorded geometry; missing height adds no inferred façade. */
export default function BuildingPreview({ feature }: { feature: PhysicalFeature }) {
  const rings = geometryParts(feature.geometry).polygons.flat();
  const points = rings.flat();
  if (!points.length) return <p className="building-preview">Footprint unavailable</p>;
  const bounds = points.reduce((box, point) => ({
    west: Math.min(box.west, point[0]), east: Math.max(box.east, point[0]),
    south: Math.min(box.south, point[1]), north: Math.max(box.north, point[1]),
  }), {west: Infinity, east: -Infinity, south: Infinity, north: -Infinity});
  const {west, east, south, north} = bounds;
  if (west === east || south === north) return <p className="building-preview">Footprint unavailable</p>;
  const scale = Math.min(278 / (east - west), 148 / (north - south));
  const xOffset = (310 - (east - west) * scale) / 2;
  const yOffset = (180 - (north - south) * scale) / 2;
  const path = rings.map(ring => ring.map((point, index) => `${index ? 'L' : 'M'}${xOffset + (point[0] - west) * scale},${yOffset + (north - point[1]) * scale}`).join('') + 'Z').join('');
  return <svg viewBox="0 0 310 180" className="building-preview" role="img" aria-label={`${feature.name}: recorded footprint preview`}>
    <rect width="310" height="180" fill="var(--ui-surface-subtle)"/>
    <path d={path} fill="var(--ui-map-building)" fillRule="evenodd" stroke="var(--ui-map-building-edge)" strokeWidth="2"/>
  </svg>;
}
