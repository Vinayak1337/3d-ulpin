import type { StatusWord } from '@ulpin/ui';
import { recordedFloors, type BuildingCanonical, type RecordedUnit } from '../../review/recorded/model';

/** The unit the canonical record of the building holds for a space, when a source label recorded one. */
export function recordedUnit(building: BuildingCanonical | undefined, spaceId: string): RecordedUnit | null {
  const units = building ? recordedFloors(building.levels).flatMap((floor) => floor.units) : [];
  return units.find((unit) => unit.id === spaceId) ?? null;
}

/** The status of a space as the registry states it: the recorded code, else the ledger's review status. */
export function registryStatus(unit: RecordedUnit | null, reviewed: string | undefined): StatusWord {
  if (unit?.code) return 'Assigned';
  if (reviewed === 'needs_review') return 'Needs review';
  return reviewed === 'reviewed' ? 'Reviewed' : 'Draft';
}

/** Where the registry flows of a recorded unit are: its block on the record page of the building. */
export function recordedUnitPath(buildingId: string, unitId: string): string {
  return `/studio/properties/${buildingId}/candidates#unit-${unitId}`;
}
