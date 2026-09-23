import { expect, type Locator } from '@playwright/test';

const tolerances = { longitude: 1e-10, latitude: 1e-10, height: 1e-4, heading: 1e-7, pitch: 1e-7, roll: 1e-7 };
type Camera = Record<keyof typeof tolerances, number>;

export async function readCamera(scene: Locator): Promise<Camera> {
  const value = await scene.getAttribute('data-camera');
  expect(value).toBeTruthy();
  const camera = JSON.parse(value!) as Camera;
  for (const key of Object.keys(tolerances) as (keyof Camera)[]) expect(Number.isFinite(camera[key])).toBe(true);
  return camera;
}

/** Ignore sub-millimetre / sub-arcsecond numerical drift, never visible movement. */
export function cameraDelta(before: Camera, after: Camera): number {
  return Math.max(...(Object.keys(tolerances) as (keyof Camera)[]).map(key => {
    const difference = after[key] - before[key];
    return Math.abs(key === 'height' || key === 'latitude' ? difference : Math.atan2(Math.sin(difference), Math.cos(difference))) / tolerances[key];
  }));
}
