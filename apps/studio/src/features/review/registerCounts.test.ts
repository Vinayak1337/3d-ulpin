import { describe, expect, it } from 'vitest';
import { registerCounts } from './registerCounts';

const level = { id: 'floor' } as never;
const space = (name: string, use: string | null) => ({ name, use });

describe('registerCounts', () => {
  it('counts a space that states no use apart: it is neither a unit nor a shared space', () => {
    // Tower 3 on the demo: one registry floor and UNIT-3B, whose use the register read does not state.
    expect(registerCounts({ levels: [level], spaces: [space('UNIT-3B', null)] })).toEqual([
      { count: 0, of: 'units' }, { count: 1, of: 'level' }, { count: 0, of: 'shared spaces' },
      { count: 1, of: 'space, use not stated' },
    ]);
  });

  it('counts apartments as units and other stated uses as shared spaces, one per name', () => {
    const lobby = space('Lobby', 'lobby');
    const spaces = [space('A-101', 'apartment'), lobby, lobby, space('Lift', 'lift')];
    expect(registerCounts({ levels: [level, level], spaces })).toEqual([
      { count: 1, of: 'unit' }, { count: 2, of: 'levels' }, { count: 2, of: 'shared spaces' },
    ]);
  });

  it('holds zeros, and no line for unstated use, when the register read lists nothing', () => {
    expect(registerCounts({ levels: [], spaces: [] })).toEqual([
      { count: 0, of: 'units' }, { count: 0, of: 'levels' }, { count: 0, of: 'shared spaces' },
    ]);
  });
});
