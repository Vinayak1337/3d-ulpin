import type { MultiPolygon } from '@ulpin/scene';
import type { BuildingRegister, RegisterRecord } from '../api/queries';

/** A level of one building, in the register's source order (the rail lists it top to bottom). */
export interface LevelModel {
  id: string;
  label: string;
  order: number;
  lower: number | null;
  upper: number | null;
  estimated: boolean;
  belowGround: boolean;
  record: RegisterRecord;
}

/** A space: a unit (group of rooms, no own footprint) or a drawable space with a footprint. */
export interface SpaceModel {
  id: string;
  name: string;
  shortName: string;
  levelId: string | null;
  /** Parent space (a room within a unit). */
  parentId: string | null;
  use: string | null;
  polygons: MultiPolygon;
  lower: number | null;
  upper: number | null;
  record: RegisterRecord;
}

export interface BuildingModel {
  levels: LevelModel[];
  spaces: SpaceModel[];
  spaceById: Map<string, SpaceModel>;
  /** Units: spaces other spaces sit within. */
  children: Map<string, SpaceModel[]>;
}

const BELOW = /^(B\d*|LG|basement)/i;

/** Register records → levels and spaces. Shape comes only from the records; nothing is assumed. */
export function buildingModel(register: BuildingRegister): BuildingModel {
  const floors = register.register.filter((r) => r.kind === 'floor');
  const levels: LevelModel[] = floors.map((record, order) => {
    const geometry = record.geometry;
    return {
      id: record.id,
      label: record.name,
      order,
      lower: geometry?.lower ?? null,
      upper: geometry?.upper ?? null,
      estimated: Boolean(geometry && (geometry.lower !== null && !geometry.lowerVerified)),
      belowGround: BELOW.test(record.name),
      record,
    };
  });
  const spaces: SpaceModel[] = register.register.filter((r) => r.kind === 'space').map((record) => {
    const floorLink = record.links.find((link) => link.type === 'floor');
    const within = record.links.find((link) => link.type === 'within' && link.targetId !== register.property.id);
    const ring = record.footprint.length >= 4 ? record.footprint : record.geometry?.footprint ?? [];
    return {
      id: record.id,
      name: record.name,
      shortName: record.geometry?.name ?? record.name,
      levelId: floorLink?.targetId ?? null,
      parentId: within && register.register.some((r) => r.id === within.targetId && r.kind === 'space') ? within.targetId : null,
      use: record.use ?? null,
      polygons: ring.length >= 4 ? [[ring.map(([x, y]) => [x!, y!] as [number, number])]] : [],
      lower: record.geometry?.lower ?? null,
      upper: record.geometry?.upper ?? null,
      record,
    };
  });
  const children = new Map<string, SpaceModel[]>();
  for (const space of spaces) if (space.parentId) children.set(space.parentId, [...(children.get(space.parentId) ?? []), space]);
  return { levels, spaces, spaceById: new Map(spaces.map((s) => [s.id, s])), children };
}

/** Spaces listed for a level: top-level spaces (units) with their rooms, in register order. */
export function spacesOnLevel(model: BuildingModel, levelId: string): SpaceModel[] {
  return model.spaces.filter((space) => space.levelId === levelId && !space.parentId);
}
