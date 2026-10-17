import { describe, expect, it } from 'vitest';
import controls from '../../../../../../docs/evidence/gf1/ui/f3a/responses.json';
import type { RegisterRecord } from '../../../api/queries';
import { evidenceRef, floorIdentifier, recordedFloors, sourceLabelGaps, type BuildingCanonical } from './model';

const withoutCode = controls.withoutCode as BuildingCanonical;
const withCode = controls.withCode as BuildingCanonical;
const unknown = { text: 'Unknown', known: false };
type Space = BuildingCanonical['levels'][number]['spaces'][number];

/** The recorded unit of the control building after `change` is applied to a copy of its space. */
function unitWith(change: (space: Space) => void) {
  const level = structuredClone(withoutCode.levels[0]!);
  change(level.spaces[0]!);
  return recordedFloors([level])[0]!.units[0]!;
}

describe('recorded floors and units', () => {
  it('shows a recorded floor by its literal, with unknown heights and no number from the label', () => {
    const [floor] = recordedFloors(withoutCode.levels);
    expect(recordedFloors(withoutCode.levels)).toHaveLength(1);
    expect(floor).toMatchObject({ label: '2ND FLOOR PLAN', reviewed: true, lower: unknown, upper: unknown,
      origin: 'Recorded from a source label · geometry not recorded' });
    expect(Object.values(floor!).filter((value) => typeof value === 'number')).toEqual([]);
    const cited = withoutCode.levels[0]!.label.citations[0]!;
    expect(floor!.citations).toEqual([{ key: `${cited.sourceId}:0`, sourceId: cited.sourceId, source: '5293cd72',
      locator: 'p.1 · x 850.0, y 875.0 · 170.0 × 35.0 pt', place: cited.locator, sha256: cited.sourceSha256,
      revision: cited.sourceRevision }]);
  });

  it('keeps a unit unknown where the record is, and only shows a reviewed code', () => {
    const unit = recordedFloors(withoutCode.levels)[0]!.units[0]!;
    expect(unit).toMatchObject({ label: 'UNIT-3B', kind: unknown, area: unknown, code: null });
    expect(unit.citations[0]!.locator).toBe('p.1 · x 206.9, y 254.3 · 1034.4 × 305.1 pt');
    const assigned = withCode.levels[0]!.spaces[0]!.proposedCode;
    expect(assigned.state).toBe('reviewed');
    expect(recordedFloors(withCode.levels)[0]!.units[0]!.code).toBe(assigned.value);
  });

  it.each([
    ['absent', 'Not recorded'], ['unknown', 'Unknown'], ['withheld', 'Withheld'], ['conflicting', 'Conflicting'],
  ] as const)('prints a kind and an area the record states as %s in words, never as a zero', (state, text) => {
    const unit = unitWith((space) => {
      space.kind = { ...space.kind, value: null, state };
      space.areaM2 = { ...space.areaM2!, value: null, state };
    });
    expect(unit.kind).toEqual({ text, known: false });
    expect(unit.area).toEqual({ text, known: false });
    expect(`${unit.kind.text} ${unit.area.text}`).not.toMatch(/\d/);
  });

  it('prints a recorded kind and area as the record gives them, and says when the read omits the area', () => {
    const recorded = unitWith((space) => {
      space.kind = { ...space.kind, value: 'unit', state: 'reviewed' };
      space.areaM2 = { ...space.areaM2!, value: 71.5, state: 'reviewed' };
    });
    expect(recorded.kind).toEqual({ text: 'unit', known: true });
    expect(recorded.area).toEqual({ text: '71.50 m²', known: true });
    const said = unitWith((space) => { space.kind = { ...space.kind, value: 'unknown', state: 'reviewed' }; });
    expect(said.kind).toEqual(unknown);
    const omitted = unitWith((space) => { delete space.areaM2; });
    expect(omitted.area).toEqual({ text: 'Not reported', known: false });
  });

  it('prints a floor identifier only as the register read states it, and says in words when it states none', () => {
    const [floor] = recordedFloors(withoutCode.levels);
    const entry = { id: floor!.registerId, identifier: 'READ-STATED:F001' } as RegisterRecord;
    const other = { id: 'another-record', identifier: 'READ-STATED:F002' } as RegisterRecord;
    expect(floor!.registerId).toBe(withoutCode.levels[0]!.registryFloorId);
    expect(floorIdentifier({ records: [other, entry], failed: false }, floor!.registerId))
      .toEqual({ text: 'READ-STATED:F001', known: true });
    expect(floorIdentifier({ records: [other], failed: false }, floor!.registerId))
      .toEqual({ text: 'The register read states no identifier for this floor.', known: false });
    expect(floorIdentifier({ records: undefined, failed: false }, floor!.registerId))
      .toEqual({ text: 'Reading the register…', known: false });
    expect(floorIdentifier({ records: undefined, failed: true }, floor!.registerId))
      .toEqual({ text: 'The register could not be read, so no identifier is shown.', known: false });
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

  it('opens the evidence viewer at the cited page and region, in the citation’s own units, pinned', () => {
    const unit = recordedFloors(withoutCode.levels)[0]!.units[0]!;
    const cited = withoutCode.levels[0]!.spaces[0]!.label!.citations[0]!;
    const ref = evidenceRef(unit.label, unit.citations[0]!);
    expect(ref).toMatchObject({ sourceId: cited.sourceId, label: 'UNIT-3B', locator: { kind: 'region', page: 1,
      region: { x: 206.88, y: 254.25, width: 1034.4, height: 305.1, unit: 'pt' }, text: unit.citations[0]!.locator },
      pin: { revision: cited.sourceRevision, sha256: cited.sourceSha256 } });
  });

  it('carries no pin when the citation names no revision, and a page as a page', () => {
    const [citation] = recordedFloors(withoutCode.levels)[0]!.citations;
    const unpinned = evidenceRef('Floor', { ...citation!, revision: null });
    expect(unpinned.pin).toBeUndefined();
    const page = evidenceRef('Floor', { ...citation!, place: { kind: 'page', page: 3 } });
    expect(page.locator).toMatchObject({ kind: 'page', page: 3 });
    const row = evidenceRef('Floor', { ...citation!, place: { kind: 'row', row: 2 } });
    expect(row.locator.kind).toBe('text');
  });
});
