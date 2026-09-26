import type { Bounds2D, SceneMode, ViewMode } from './types';

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

/** Unit view directions (from target to camera) per mode, in scene axes (x east, y up, z south). */
const DIRECTIONS: Record<SceneMode, [number, number, number]> = {
  area: [-0.5, 0.62, 0.6], // high oblique from the south-west
  building: [-0.55, 0.5, 0.67],
  level: [-0.45, 0.72, 0.53], // closer, steeper, at the level's height
  findings: [-0.6, 0.45, 0.66],
  underground: [0.4, 0.34, 0.85], // low view from the street side, looking at the section
};

/**
 * Camera preset for a mode, computed from the bounds of what is shown (never fixed coordinates).
 * `focusY` is the height the view centres on (a level's base, half a building's height).
 * 2D is the same target seen from directly above at the same distance.
 */
export function presetFor(mode: SceneMode, bounds: Bounds2D, focusY: number, extentY: number, view: ViewMode, fovDeg: number): CameraPose {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = -(bounds.minY + bounds.maxY) / 2;
  const planRadius = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2;
  const minRadius = mode === 'area' ? 40 : mode === 'level' ? 8 : mode === 'underground' ? 28 : 15;
  const radius = Math.max(planRadius, extentY * 0.6, minRadius);
  const fit = mode === 'area' ? 0.85 : mode === 'level' ? 0.95 : 1.05;
  const distance = (radius / Math.sin((fovDeg * Math.PI) / 360)) * fit;
  const target: [number, number, number] = [cx, focusY, cz];
  if (view === '2d') return { position: [cx, focusY + distance, cz + 0.001], target };
  const [dx, dy, dz] = DIRECTIONS[mode];
  const length = Math.hypot(dx, dy, dz);
  return { position: [cx + (dx / length) * distance, focusY + (dy / length) * distance, cz + (dz / length) * distance], target };
}
