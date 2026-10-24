import type { BuildingModel } from '../../model/building';

/** One number of the register read and what it is a number of. */
export interface RegisterCount {
  count: number;
  of: string;
}

type Counted = Pick<BuildingModel, 'levels'> & { spaces: { name: string; use: string | null }[] };

function worded(count: number, one: string, many: string): RegisterCount {
  return { count, of: count === 1 ? one : many };
}

/**
 * What the register read holds for a building, counted by what each record states about itself: a space is a
 * unit only when its use says apartment, shared when it states another use (one per name), and counted apart
 * when it states no use. A space of unstated use is never made a unit or a shared space.
 */
export function registerCounts(model: Counted): RegisterCount[] {
  const stated = model.spaces.filter((space) => space.use !== null);
  const units = stated.filter((space) => space.use === 'apartment').length;
  const shared = new Set(stated.filter((space) => space.use !== 'apartment').map((space) => space.name)).size;
  const unstated = model.spaces.length - stated.length;
  const counts = [
    worded(units, 'unit', 'units'),
    worded(model.levels.length, 'level', 'levels'),
    worded(shared, 'shared space', 'shared spaces'),
  ];
  if (unstated) counts.push(worded(unstated, 'space, use not stated', 'spaces, use not stated'));
  return counts;
}
