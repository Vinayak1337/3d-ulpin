import { describe, expect, it } from 'vitest';
import { effectiveColour, readSelection, transition, writeSelection, type Selection } from './selection';

const base = readSelection(new URLSearchParams());
const at = (patch: Partial<Selection>): Selection => ({ ...base, ...patch });

describe('selection transitions (mockup interaction model)', () => {
  it('area: click selects, clicking again explores the building', () => {
    const selected = transition(base, { type: 'pickBuilding', id: 'b' });
    expect(selected).toMatchObject({ mode: 'area', buildingId: 'b' });
    expect(transition(selected, { type: 'pickBuilding', id: 'b' })).toMatchObject({ mode: 'building', buildingId: 'b' });
  });
  it('building: clicking one of its storeys opens that floor', () => {
    const building = at({ mode: 'building', buildingId: 'b' });
    expect(transition(building, { type: 'pickBuilding', id: 'b', levelId: 'f7' })).toMatchObject({ mode: 'level', levelId: 'f7' });
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
  it('round-trips through the URL, keeping the panel and Colour by across selection changes', () => {
    const s = at({ mode: 'level', buildingId: 'b', levelId: 'l', spaceId: 's', colourBy: 'rights', panel: 'checks' });
    expect(readSelection(writeSelection(s))).toEqual({ ...s, findingId: null });
    expect(transition(s, { type: 'escape' })).toMatchObject({ colourBy: 'rights', panel: 'checks' });
  });
  it('opens old links that still carry view and render', () => {
    expect(readSelection(new URLSearchParams('feature=b&mode=building&view=2d&render=volumes'))).toMatchObject({ mode: 'building', buildingId: 'b' });
  });
  it('Colour by auto follows the mode', () => {
    expect(effectiveColour(at({ mode: 'level', buildingId: 'b', levelId: 'l' }))).toBe('rights');
    expect(effectiveColour(at({ mode: 'underground', buildingId: 'b' }))).toBe('utilities');
    expect(effectiveColour(at({ mode: 'level', buildingId: 'b', levelId: 'l', colourBy: 'none' }))).toBe('none');
  });
  it('drops an inconsistent saved link to the nearest valid view', () => {
    expect(readSelection(new URLSearchParams('mode=level'))).toMatchObject({ mode: 'area', buildingId: null });
    expect(readSelection(new URLSearchParams('mode=level&feature=b'))).toMatchObject({ mode: 'building', levelId: null });
  });
});
