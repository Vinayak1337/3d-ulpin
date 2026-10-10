import { describe, expect, it } from 'vitest';
import controls from '../../../../../../docs/evidence/gf1/ui/f3a/responses.json';
import { evidenceRef, recordedFloors, sourceLabelGaps, type BuildingCanonical } from './model';

const withoutCode = controls.withoutCode as BuildingCanonical;
const withCode = controls.withCode as BuildingCanonical;
const unknown = { text: 'Unknown', known: false };

describe('recorded floors and units', () => {
  it('shows a recorded floor by its literal, with unknown heights and no number from the label', () => {
    const [floor] = recordedFloors(withoutCode.levels);
    expect(recordedFloors(withoutCode.levels)).toHaveLength(1);
    expect(floor).toMatchObject({ label: '2ND FLOOR PLAN', reviewed: true, lower: unknown, upper: unknown,
      origin: 'Recorded from a source label · geometry not recorded' });
    expect(Object.values(floor!).filter((value) => typeof value === 'number')).toEqual([]);
    expect(floor!.citations).toEqual([{ key: `${floor!.citations[0]!.sourceId}:0`,
      sourceId: withoutCode.levels[0]!.label.citations[0]!.sourceId, source: '5293cd72',
      locator: 'p.1 · x 850.0, y 875.0 · 170.0 × 35.0 pt' }]);
  });

  it('keeps a unit unknown where the record is, and only shows a reviewed code', () => {
    const unit = recordedFloors(withoutCode.levels)[0]!.units[0]!;
    expect(unit).toMatchObject({ label: 'UNIT-3B', kind: unknown, area: unknown, code: null });
    expect(unit.citations[0]!.locator).toBe('p.1 · x 206.9, y 254.3 · 1034.4 × 305.1 pt');
    const assigned = withCode.levels[0]!.spaces[0]!.proposedCode;
    expect(assigned.state).toBe('reviewed');
    expect(recordedFloors(withCode.levels)[0]!.units[0]!.code).toBe(assigned.value);
  });

  it('lists a floor linked to a schedule row once, under that row, with only its recorded units', () => {
    const level = structuredClone(withoutCode.levels[0]!);
    const plain = { ...structuredClone(level.spaces[0]!), spaceId: 'not-from-a-source-label' };
    delete plain.recordState;
    delete plain.label;
    const linked = { ...level, levelId: 'schedule-row', recordState: undefined, polygons: undefined,
      spaces: [plain, ...level.spaces] };
    const unlinked = { ...structuredClone(level), levelId: 'schedule-row-without-floor', registryFloorId: undefined };
    const floors = recordedFloors([linked, unlinked]);
    expect(floors).toHaveLength(1);
    expect(floors[0]).toMatchObject({ id: 'schedule-row', reviewed: false,
      origin: 'Level schedule row · a floor recorded from a source label is linked to it' });
    expect(floors[0]!.units.map((unit) => unit.label)).toEqual(['UNIT-3B']);
  });

  it('is empty for a building without recorded floors, and finds the gap sentence only when returned', () => {
    expect(recordedFloors([])).toEqual([]);
    expect(sourceLabelGaps(['Measured base elevation unknown; scene uses building-relative bases.'])).toEqual([]);
    const gaps = sourceLabelGaps(withoutCode.gaps);
    expect(gaps).toHaveLength(1);
    expect(withoutCode.gaps).toContain(gaps[0]);
  });

  it('opens the evidence viewer on the cited source with the page and region as the locator', () => {
    const unit = recordedFloors(withoutCode.levels)[0]!.units[0]!;
    const ref = evidenceRef(unit.label, unit.citations[0]!);
    expect(ref).toMatchObject({ sourceId: unit.citations[0]!.sourceId, label: 'UNIT-3B',
      locator: { kind: 'text', text: unit.citations[0]!.locator } });
  });
});
