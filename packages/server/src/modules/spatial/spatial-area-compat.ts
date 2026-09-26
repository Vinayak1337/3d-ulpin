import type { WorldState } from '@ulpin/contracts';
import { areaContext } from '../areas/areas';
import { adaptAreaContext } from './legacy/area-compat-adapter';

/** Legacy spatial v1 projection. Original feature IDs, frames and source links survive. */
export async function readSpatialAreaCompatibility(areaId: string, world: WorldState) {
  return adaptAreaContext(await areaContext(areaId), world);
}
