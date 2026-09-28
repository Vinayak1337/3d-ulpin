import type { Bounds2D, SceneMode } from './types';

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

/** View directions (target → camera) per mode, in scene axes (x east, y up, z south). */
const DIRECTIONS: Record<SceneMode, [number, number, number]> = {
  area: [112, 88, 134], // high oblique from the south-east
  building: [52, 28, 62],
  level: [24, 31, 36], // closer and steeper, at the level's height
  findings: [-22, 8.6, 26], // low, close to the finding
  underground: [48, 28, -52], // from the street side, looking at the section
  deviation: [60, 31, 78],
};

/** How much of the shown bounds' radius the view frames, per mode. */
const FIT: Record<SceneMode, { scale: number; min: number }> = {
  area: { scale: 0.47, min: 40 },
  building: { scale: 1.9, min: 15 },
  level: { scale: 1.25, min: 8 },
  findings: { scale: 1.1, min: 8 },
  underground: { scale: 2.4, min: 40 },
  deviation: { scale: 2.4, min: 20 },
};

/**
 * Camera preset for a mode, computed from the bounds of what is shown (never fixed coordinates).
 * `focusY` is the height the view centres on (a level's base, a third of a building's height).
 */
export function presetFor(mode: SceneMode, bounds: Bounds2D, focusY: number, extentY: number, fovDeg: number): CameraPose {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = -(bounds.minY + bounds.maxY) / 2;
  const planRadius = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2;
  const { scale, min } = FIT[mode];
  const radius = Math.max(planRadius * scale, mode === 'area' ? 0 : extentY * 0.6 * scale, min);
  const distance = radius / Math.sin((fovDeg * Math.PI) / 360);
  const target: [number, number, number] = [cx, focusY, cz];
  const [dx, dy, dz] = DIRECTIONS[mode];
  const length = Math.hypot(dx, dy, dz);
  return { position: [cx + (dx / length) * distance, focusY + (dy / length) * distance, cz + (dz / length) * distance], target };
}
