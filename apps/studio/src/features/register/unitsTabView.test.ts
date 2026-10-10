import { describe, expect, it } from 'vitest';
import { ApiError } from '@ulpin/api-client';
import controls from '../../../../../docs/evidence/gf1/ui/f3a/responses.json';
import type { BuildingCanonical } from '../review/recorded/model';
import { unitsTabView, type CanonicalRead } from './unitsTabView';

// The canonical read of the building that holds one floor and one unit recorded from a source label.
const tower = controls.withCode as BuildingCanonical;
const floorId = tower.levels[0]!.registryFloorId!;
const unitId = tower.levels[0]!.spaces[0]!.spaceId;
const bare: BuildingCanonical = { ...tower, levels: [] };

type Schedule = NonNullable<BuildingCanonical['levelSchedule']>;
// A level schedule in the shape of the read, on the tower's own: Magnolia's is reviewed, with no registry floor.
const schedule = (state: Schedule['state'], levelIds: string[], labels: string[] = []): Schedule => ({
  ...tower.levelSchedule!,
  state,
  levels: levelIds.map((levelId, order) => ({
    levelId, order, labelLiteral: labels[order] ?? levelId, kind: 'floor', lowerM: null, upperM: null,
    heightSource: 'unknown', verticalReference: null, citations: [],
  })),
});
const scheduleOnly: BuildingCanonical = {
  ...bare, levelSchedule: schedule('reviewed', ['g', 'f'], ['GROUND FLOOR PLAN', 'FIRST FLOOR PLAN']),
};

const answered = (data: BuildingCanonical): CanonicalRead => ({ data, error: null, isPending: false });
const failed = (status: number, code?: string): CanonicalRead => ({
  error: new ApiError(status, '/api/v1/buildings/b/canonical', { error: { code, message: 'Never shown.' } }),
  isPending: false,
});
const row = (id: string) => ({ id });

describe('unitsTabView', () => {
  it('waits for the canonical read: nothing is listed, counted or denied', () => {
    const view = unitsTabView([row('a')], { error: null, isPending: true }, null);
    expect(view).toEqual({
      state: 'pending', rows: [], recorded: null, count: undefined, scheduled: [], unread: false, code: null,
    });
  });

  it('lists the register read\'s own units in the table when the record holds no recorded floor', () => {
    const view = unitsTabView([row('a'), row('b')], answered(bare), null);
    expect(view).toMatchObject({ state: 'register', recorded: null, count: 2 });
    expect(view.rows).toEqual([row('a'), row('b')]);
  });

  it('gives the recorded floors and units to the panel when the register read lists none', () => {
    const view = unitsTabView([], answered(tower), null);
    expect(view).toMatchObject({ state: 'recorded', rows: [], count: 1 });
    expect(view.recorded).toBe(tower);
  });

  it('says nothing is recorded only when neither read holds a unit or a recorded floor', () => {
    expect(unitsTabView([], answered(bare), null)).toMatchObject({ state: 'nothing', recorded: null, count: 0 });
    expect(unitsTabView([], failed(404, 'NOT_FOUND'), null)).toMatchObject({ state: 'nothing', count: 0 });
  });

  it('names the levels of a reviewed schedule that no registry floor carries, in schedule order', () => {
    const view = unitsTabView([], answered(scheduleOnly), null);
    expect(view).toMatchObject({ state: 'nothing', count: 0, scheduled: ['GROUND FLOOR PLAN', 'FIRST FLOOR PLAN'] });
  });

  it('names no scheduled level that a registry floor carries, and none of a conflicting schedule', () => {
    const carried: BuildingCanonical = { ...tower, levelSchedule: schedule('reviewed', [tower.levels[0]!.levelId]) };
    expect(unitsTabView([], answered(carried), null)).toMatchObject({ state: 'recorded', scheduled: [] });
    const conflicting: BuildingCanonical = { ...bare, levelSchedule: schedule('conflicting', ['a']) };
    expect(unitsTabView([], answered(conflicting), null)).toMatchObject({ state: 'nothing', scheduled: [] });
    expect(unitsTabView([], answered(bare), null).scheduled).toEqual([]);
  });

  it('never makes a table row of a unit recorded from a source label', () => {
    const view = unitsTabView([row(unitId)], answered(tower), floorId);
    expect(view).toMatchObject({ state: 'recorded', rows: [], count: 1 });
  });

  it('counts table rows and recorded units together when a building has both', () => {
    const view = unitsTabView([row('a'), row(unitId)], answered(tower), null);
    expect(view).toMatchObject({ state: 'register', count: 2 });
    expect(view.rows).toEqual([row('a')]);
    expect(view.recorded).toBe(tower);
  });

  it('narrows the recorded floors to the floor selected on the rail, and counts only its units', () => {
    const other = { ...structuredClone(tower.levels[0]!), levelId: 'schedule-row', registryFloorId: 'another-floor' };
    other.spaces = other.spaces.map((space) => ({ ...space, spaceId: `${space.spaceId}-other` }));
    const both: BuildingCanonical = { ...tower, levels: [...tower.levels, other] };
    expect(unitsTabView([], answered(both), null)).toMatchObject({ state: 'recorded', count: 2 });
    const view = unitsTabView([], answered(both), 'another-floor');
    expect(view).toMatchObject({ state: 'recorded', count: 1 });
    expect(view.recorded!.levels).toEqual([other]);
    expect(view.recorded!.buildingId).toBe(tower.buildingId);
  });

  it('holds nothing for a selected floor that has no recorded unit and no register unit', () => {
    expect(unitsTabView([], answered(tower), 'a-floor-without-a-record')).toMatchObject({
      state: 'nothing', rows: [], recorded: null, count: 0,
    });
  });

  it('does not say "nothing recorded" when the canonical read failed: it gives the server code, no count', () => {
    expect(unitsTabView([], failed(500, 'INTERNAL'), null)).toMatchObject({
      state: 'unread', recorded: null, count: undefined, unread: true, code: 'INTERNAL',
    });
    expect(unitsTabView([], failed(503), null)).toMatchObject({ state: 'unread', unread: true, code: null });
  });

  it('still lists the register read\'s units when the canonical read failed, without a count', () => {
    expect(unitsTabView([row('a')], failed(500, 'INTERNAL'), null)).toMatchObject({
      state: 'register', rows: [row('a')], recorded: null, count: undefined, unread: true, code: 'INTERNAL',
    });
  });

  it('keeps an earlier answer of the canonical read when a later one fails', () => {
    const stale: CanonicalRead = { ...failed(500, 'INTERNAL'), data: tower };
    expect(unitsTabView([], stale, null)).toMatchObject({ state: 'recorded', count: 1, unread: false, code: null });
  });
});
