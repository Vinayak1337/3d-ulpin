import { ApiError } from '@ulpin/api-client';
import { refusalOf } from '../review/candidates/commands';
import { recordedFloors, type BuildingCanonical } from '../review/recorded/model';

/** The canonical read of the building as far as the Units tab needs it (a query result fits). */
export interface CanonicalRead {
  data?: BuildingCanonical;
  error: unknown;
  isPending: boolean;
}

/**
 * What the Units tab shows for the current selection.
 * - `pending`: the canonical read has not answered, so nothing is listed or denied yet.
 * - `register`: the register read has units of its own to list in the table.
 * - `recorded`: it has none, and the record holds floors recorded from a source label.
 * - `nothing`: neither read holds a unit or a recorded floor (`scheduled` says what the record does hold).
 * - `unread`: the register read holds none and the canonical read failed, so nothing can be said.
 */
export interface UnitsTabView<Row> {
  state: 'pending' | 'register' | 'recorded' | 'nothing' | 'unread';
  /** The register read's units for the selection, less those the record lists as recorded from a label. */
  rows: Row[];
  /** The canonical building narrowed to the selection, when it holds a recorded floor there. */
  recorded: BuildingCanonical | null;
  /** The units the tab lists, table rows and recorded units together; undefined while that is not known. */
  count: number | undefined;
  /** The labels of a reviewed level schedule's levels that no registry floor carries, in schedule order. */
  scheduled: string[];
  /** The canonical read failed, so the recorded floors and units are not known. */
  unread: boolean;
  /** The server's code for that failure, when it gave one. */
  code: string | null;
}

/**
 * The building as the recorded panel is to read it: whole with no floor selected, else only the level that
 * carries the selected registry floor. Null when it holds no floor recorded from a source label there.
 */
function recordedOn(building: BuildingCanonical, floorId: string | null): BuildingCanonical | null {
  const levels = floorId ? building.levels.filter((level) => level.registryFloorId === floorId) : building.levels;
  if (!recordedFloors(levels).length) return null;
  return floorId ? { ...building, levels } : building;
}

/** The levels a reviewed schedule states and no registry floor carries: reviewed, and not yet in the registry. */
function scheduledOnly(building: BuildingCanonical | undefined): string[] {
  const schedule = building?.levelSchedule;
  if (!building || schedule?.state !== 'reviewed') return [];
  const carried = new Set(building.levels.filter((level) => level.registryFloorId).map((level) => level.levelId));
  return schedule.levels.filter((level) => !carried.has(level.levelId))
    .sort((a, b) => a.order - b.order).map((level) => level.labelLiteral);
}

/** A read that failed for another reason than "this building has no record", and holds no earlier answer. */
function failed(read: CanonicalRead): boolean {
  const absent = read.error instanceof ApiError && read.error.status === 404;
  return !read.data && Boolean(read.error) && !absent;
}

/**
 * Decides the Units tab from the register read's units for the selection (`listed`) and the canonical read.
 * A unit recorded from a source label is never a table row: the register read knows its name only, so the
 * recorded panel states it. The table and the panel therefore never list the same unit.
 */
export function unitsTabView<Row extends { id: string }>(
  listed: Row[], read: CanonicalRead, floorId: string | null,
): UnitsTabView<Row> {
  if (read.isPending) {
    return { state: 'pending', rows: [], recorded: null, count: undefined, scheduled: [], unread: false, code: null };
  }
  if (failed(read)) {
    const state = listed.length ? 'register' : 'unread';
    const code = refusalOf(read.error).code;
    return { state, rows: listed, recorded: null, count: undefined, scheduled: [], unread: true, code };
  }
  const recorded = read.data ? recordedOn(read.data, floorId) : null;
  const units = recorded ? recordedFloors(recorded.levels).flatMap((floor) => floor.units) : [];
  const fromLabel = new Set(units.map((unit) => unit.id));
  const rows = listed.filter((row) => !fromLabel.has(row.id));
  const scheduled = scheduledOnly(read.data);
  const known = { rows, recorded, count: rows.length + units.length, scheduled, unread: false, code: null };
  if (rows.length) return { ...known, state: 'register' };
  return { ...known, state: recorded ? 'recorded' : 'nothing' };
}
