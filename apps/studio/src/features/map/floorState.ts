import type { BuildingRegister } from '../../api/queries';
import type { BuildingCanonical } from '../review/recorded/model';

/** What the map says over a building whose register holds no floor, and whether it advises adding a plan. */
export interface NoFloorsState {
  lines: string[];
  advise: boolean;
}

const ADVICE = 'No floors recorded. Add a plan.';
const NO_FLOOR_LISTED = 'The register of this building lists no floor yet.';

const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The levels of a reviewed schedule, by their literal labels. */
function scheduleLine(building: Pick<BuildingCanonical, 'levelSchedule'>): string | null {
  const schedule = building.levelSchedule;
  if (schedule?.state !== 'reviewed' || !schedule.levels.length) return null;
  const labels = schedule.levels.map((level) => level.labelLiteral).join(', ');
  return `${counted(schedule.levels.length, 'reviewed level', 'reviewed levels')} from a level schedule: ${labels}.`;
}

/** Room candidates read from the building's plans, with how many still wait for review. */
function roomsLine(building: Pick<BuildingCanonical, 'candidates'>): string | null {
  const rooms = building.candidates.filter((candidate) => candidate.kind === 'room');
  if (!rooms.length) return null;
  const waiting = rooms.filter((candidate) => candidate.state === 'candidate').length;
  return `${counted(rooms.length, 'room candidate', 'room candidates')}, ${waiting} waiting for review.`;
}

/**
 * Shown when the register read lists no floor to draw. The advice to add a plan is given only when the reads
 * the map holds say there is none: no file in the register, and a canonical read with no reviewed level and
 * no room candidate. Otherwise the card states what those reads hold, and nothing while one is unanswered.
 */
export function noFloorsState(
  register: Pick<BuildingRegister, 'sources'>,
  building: Pick<BuildingCanonical, 'levelSchedule' | 'candidates'> | undefined,
): NoFloorsState {
  const files = register.sources.length ? `${counted(register.sources.length, 'file', 'files')} added.` : null;
  const held = [files, building ? scheduleLine(building) : null, building ? roomsLine(building) : null];
  const lines = held.filter((line): line is string => line !== null);
  if (building && !lines.length) return { lines: [ADVICE], advise: true };
  return { lines: [NO_FLOOR_LISTED, ...lines], advise: false };
}
