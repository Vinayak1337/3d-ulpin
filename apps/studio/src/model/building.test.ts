import { describe, expect, it } from 'vitest';
import swiss from '../local/data/swiss-floor-register.json';
import type { BuildingRegister } from '../api/queries';
import { buildingModel, spacesOnLevel } from './building';

describe('buildingModel on the derived Swiss Dwellings register', () => {
  const model = buildingModel(swiss as unknown as BuildingRegister);
  it('reads levels and spaces from the records, not from assumptions', () => {
    expect(model.levels.map((l) => l.label)).toEqual(['Source floor 717']);
    expect(model.levels[0]).toMatchObject({ lower: null, upper: null, belowGround: false });
  });
  it('groups rooms within their units', () => {
    const units = spacesOnLevel(model, model.levels[0]!.id);
    expect(units.map((u) => u.name)).toEqual(['Unit 23024', 'Unit 23025']);
    for (const unit of units) {
      expect(unit.polygons).toEqual([]);
      expect(model.children.get(unit.id)?.map((r) => r.shortName).sort()).toEqual(['Bathroom', 'Kitchen', 'Living Dining']);
    }
  });
  it('keeps every room drawable with its unknown limits', () => {
    const rooms = model.spaces.filter((s) => s.parentId);
    expect(rooms).toHaveLength(6);
    for (const room of rooms) {
      expect(room.polygons[0]![0]!.length).toBeGreaterThanOrEqual(4);
      expect(room.lower).toBeNull();
    }
  });
});
