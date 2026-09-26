import { describe, expect, it } from 'vitest';
import { readSelection, transition, writeSelection, type Selection } from './selection';

const base = readSelection(new URLSearchParams());
const at = (patch: Partial<Selection>): Selection => ({ ...base, ...patch });

describe('selection transitions (mockup interaction model)', () => {
  it('area: click selects, clicking again explores the building', () => {
    const selected = transition(base, { type: 'pickBuilding', id: 'b' });
    expect(selected).toMatchObject({ mode: 'area', buildingId: 'b' });
    expect(transition(selected, { type: 'pickBuilding', id: 'b' })).toMatchObject({ mode: 'building', buildingId: 'b' });
  });
  it('level: picking a space selects it; ground clears the space but stays on the level', () => {
    const level = at({ mode: 'level', buildingId: 'b', levelId: 'l' });
    const space = transition(level, { type: 'pickSpace', id: 's', levelId: 'l' });
    expect(space.spaceId).toBe('s');
    expect(transition(space, { type: 'pickGround' })).toMatchObject({ mode: 'level', levelId: 'l', spaceId: null });
  });
  it('Escape unwinds one step at a time', () => {
    let s = at({ mode: 'level', buildingId: 'b', levelId: 'l', spaceId: 's' });
    const steps = [];
    for (let i = 0; i < 5; i++) { s = transition(s, { type: 'escape' }); steps.push(`${s.mode}:${s.buildingId ?? '-'}:${s.levelId ?? '-'}:${s.spaceId ?? '-'}`); }
    expect(steps).toEqual(['level:b:l:-', 'building:b:-:-', 'area:b:-:-', 'area:-:-:-', 'area:-:-:-']);
  });
  it('modes need a building', () => {
    expect(transition(base, { type: 'openUnderground' })).toBe(base);
    expect(transition(at({ buildingId: 'b' }), { type: 'openFindings' })).toMatchObject({ mode: 'findings' });
  });
  it('round-trips through the URL, keeping view and render across selection changes', () => {
    const s = at({ mode: 'level', buildingId: 'b', levelId: 'l', spaceId: 's', view: '2d', render: 'volumes', colourBy: 'rights' });
    expect(readSelection(writeSelection(s))).toEqual({ ...s, panel: null, findingId: null });
    expect(transition(s, { type: 'escape' })).toMatchObject({ view: '2d', render: 'volumes', colourBy: 'rights' });
  });
  it('drops an inconsistent saved link to the nearest valid view', () => {
    expect(readSelection(new URLSearchParams('mode=level'))).toMatchObject({ mode: 'area', buildingId: null });
    expect(readSelection(new URLSearchParams('mode=level&feature=b'))).toMatchObject({ mode: 'building', levelId: null });
  });
});
